import os
import io
import argparse
import requests
import re
import traceback
import json
import base64
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor, as_completed
from google.cloud import storage
from pypdf import PdfReader, PdfWriter
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Try to load .env.local from project root

# Try to load .env.local from project root
# Script is in backend/scripts/ -> root is ../../
script_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(script_dir, '../../.env.local')
load_dotenv(env_path)

# Windowsローカル実行用に認証パスを強制書き換え
# .envには /app/key.json が書かれていることが多いが、ローカルでは ../../key.json にあるはず
key_path = os.path.abspath(os.path.join(script_dir, '../../key.json'))
current_creds = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

if os.path.exists(key_path):
    # key.jsonがローカルに存在すれば、強制的にそれを使う
    print(f"[*] 認証キーをローカルパスに設定: {key_path}")
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path
elif current_creds == "/app/key.json":
    # キーがないのにパスだけDocker用になっている場合の警告
    print("[警告] ローカルに key.json が見つかりませんが、環境変数は /app/key.json を指しています。")
    print(f"       {key_path} にファイルを配置してください。")

# 偽装ヘッダー (Chrome)
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
}

def upload_to_gcs(bucket_name, blob_name, data, content_type="application/pdf", log_func=print):
    """GCSにデータをアップロードする"""
    try:
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        blob.upload_from_string(data, content_type=content_type)
        return True
    except Exception as e:
        log_func(f"[GCSエラー] {blob_name} のアップロード失敗: {e}")
        return False

# --- AI Parsing Logic ---

def get_gemini_client():
    api_key = os.getenv("GOOGLE_CLOUD_API_KEY", "").strip()
    if not api_key:
        return None
        
    # Match car_quiz.py: vertexai=True, api_key, v1beta1 (No project/location in init)
    return genai.Client(
        vertexai=True,
        api_key=api_key,
        http_options={'api_version': 'v1beta1'}
    )

def clean_text(text):
    if not text: return ""
    return "".join(c for c in text if c.isalnum() or c in "._- ")

def analyze_page_with_gemini(page_bytes, log_func=print):
    """Sends a single PDF page to Gemini to extract metadata."""
    client = get_gemini_client()
    if not client:
        log_func("[警告] GOOGLE_CLOUD_API_KEYが設定されていないため、AI解析をスキップします。")
        return []

    prompt = """
    You are a data extraction assistant.
    Analyze this PDF page (which contains a table of reports).
    Extract the following information for each row that contains a report link:
    1. Report Name (委託調査報告書名 or similar)
    2. Contractor Name (委託事業者名 or similar)
    3. Fiscal Year/Date (掲載日 or FY in title). If date is 07.08.15, interpret as FY or Date. Prefer FY format like '2023FY' if obvious, else use the date string.
    4. The URL (HPアドレス).

    Return a JSON list of objects. Each object must have:
    - "url": The exact link found in the row.
    - "report_name": The report name.
    - "contractor": The contractor name.
    - "fy": The fiscal year or date string.

    Example Output:
    [
        {"url": "https://...", "report_name": "AI Trend Survey", "contractor": "XYZ Corp", "fy": "2024FY"}
    ]
    RETURN ONLY JSON.
    """

    try:
        response = client.models.generate_content(
            model="gemini-3-pro-preview", 
            contents=[
                types.Part.from_text(text=prompt),
                types.Part.from_bytes(data=page_bytes, mime_type="application/pdf")
            ]
        )
        
        # Parse JSON
        text = response.text
        # Cleanup markdown
        if text.startswith("```json"):
            text = text.replace("```json", "").replace("```", "")
        
        data = json.loads(text)
        return data
    except Exception as e:
        log_func(f"[AI解析エラー] {e}")
        return []

def scan_pdf_with_gemini(file_stream, log_func=print):
    """Splits PDF and parses each page with Gemini."""
    reader = PdfReader(file_stream)
    log_func(f"[*] AI解析開始: 全{len(reader.pages)}ページをGeminiで解析します...")
    
    metadata_map = {} # URL -> Filename
    
    for i, page in enumerate(reader.pages):
        log_func(f"[*] ページ {i+1}/{len(reader.pages)} を解析中...")
        try:
            # Extract page to bytes
            writer = PdfWriter()
            writer.add_page(page)
            with io.BytesIO() as output_stream:
                writer.write(output_stream)
                page_bytes = output_stream.getvalue()
            
            # Call Gemini
            results = analyze_page_with_gemini(page_bytes, log_func)
            
            for item in results:
                url = item.get("url")
                if not url: continue
                
                # Construct Filename: FY_ReportName_Contractor.pdf
                fy = clean_text(item.get("fy", "")).replace(" ", "")
                rname = clean_text(item.get("report_name", "")).replace(" ", "_").strip("_")
                cname = clean_text(item.get("contractor", "")).replace(" ", "_").strip("_")
                
                # Limit length to avoid OS limits
                if len(rname) > 50: rname = rname[:50]
                if len(cname) > 30: cname = cname[:30]
                
                filename = f"{fy}_{rname}_{cname}.pdf"
                
                # Normalize URL for matching later
                metadata_map[url.strip()] = filename
                
        except Exception as e:
            log_func(f"[ページ解析エラー] P{i+1}: {e}")
            
    log_func(f"[*] AI解析完了: {len(metadata_map)}件のメタデータを取得しました。")
    return metadata_map

def get_unique_gcs_filename(bucket, base_name):
    """Checks if file exists in GCS and appends suffix if needed."""
    name, ext = os.path.splitext(base_name)
    counter = 0
    candidate = base_name
    
    while True:
        blob = bucket.blob(f"consulting_raw/{candidate}")
        if not blob.exists():
            return candidate
        
        counter += 1
        candidate = f"{name}_{counter}{ext}"

def download_and_upload(url, bucket_name, suggested_name=None, log_func=print):
    """URLからダウンロードしてGCSへアップロード (名前指定あり)"""
    try:
        # 名前決定ロジック
        final_filename = ""
        if suggested_name:
            final_filename = suggested_name
        else:
            # Fallback
            filename = url.split("/")[-1]
            filename = "".join(c for c in filename if c.isalnum() or c in "._-")
            if not filename.lower().endswith(".pdf"): filename += ".pdf"
            final_filename = filename

        log_func(f"[-] ダウンロード開始: {url}")
        res = requests.get(url, headers=HEADERS, timeout=60)
        
        if res.status_code == 200:
            # Check GCS and make unique
            client = storage.Client()
            bucket = client.bucket(bucket_name)
            
            unique_name = get_unique_gcs_filename(bucket, final_filename)
            blob_path = f"consulting_raw/{unique_name}"
            
            log_func(f"[↑] GCSへアップロード中: {unique_name} ...")
            
            blob = bucket.blob(blob_path)
            blob.upload_from_string(res.content, content_type="application/pdf")
            log_func(f"[OK] 完了: {unique_name}")
            return True
        else:
            log_func(f"[エラー] ダウンロード失敗 {url}: Status {res.status_code}")
            return False
            
    except Exception as e:
        log_func(f"[例外] 処理エラー {url}: {type(e).__name__} - {e}")
        # traceback.print_exc()
        return False

# extract_pdf_links is still used to find the actual clickable links
# We will match them with Gemini's metadata


def extract_pdf_links(file_stream, log_func=print):
    """PDFストリームからリンクを抽出する"""
    links = set()
    try:
        reader = PdfReader(file_stream)
        # 暗号化チェック
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except:
                log_func("[警告] 暗号化されたPDFです。読み取れない可能性があります。")

        log_func(f"[*] ページ数: {len(reader.pages)} ページをスキャン中...")
        for i, page in enumerate(reader.pages):
            # 1. Annotation Links (Clickable)
            if "/Annots" in page:
                for annot in page["/Annots"]:
                    obj = annot.get_object()
                    if "/A" in obj and "/URI" in obj["/A"]:
                        uri = obj["/A"]["/URI"]
                        if uri.lower().endswith(".pdf"):
                            links.add(uri)
            
            # 2. Text Links (Plain text URL)
            try:
                text = page.extract_text()
                if text:
                    # Simple regex for URLs ending in .pdf (or generally http/https)
                    # The user specifically wants IDs, usually these are direct links.
                    # We capture generic http(s) links and filter for .pdf later if needed, 
                    # but the requirement is "links to download".
                    found_urls = re.findall(r'(https?://[^\s<>"]+)', text)
                    for url in found_urls:
                        # Sometimes extraction includes trailing punctuation, try to clean
                        url = url.strip(".,;:)")
                        if url.lower().endswith(".pdf"):
                            links.add(url)
            except Exception as e:
                # Text extraction might fail on some pages
                pass
                
    except Exception as e:
        log_func(f"[エラー] PDF解析失敗: {e}")
    return list(links)

def main():
    parser = argparse.ArgumentParser(description="ローカルPDF収集＆GCSアップロードツール")
    parser.add_argument("input", help="入力対象: リンク集PDFのURL または ローカルPDFファイルのパス")
    # bucket arg removed
    args = parser.parse_args()

    # 環境変数からバケット名取得
    bucket_name = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")
    if not bucket_name:
        print("[エラー] 環境変数 GCS_BUCKET_NAME_FOR_CONSUL_DOC が見つかりません。")
        print("          .env.local ファイルを確認するか、環境変数を設定してください。")
        return

    print(f"[*] 保存先バケット: {bucket_name}")

    pdf_stream = None
    
    # 1. 入力 (親PDF) の読み込み
    if args.input.startswith("http://") or args.input.startswith("https://"):
        print(f"[*] リンク集PDFをダウンロード中: {args.input}")
        try:
            res = requests.get(args.input, headers=HEADERS, timeout=30)
            res.raise_for_status()
            pdf_stream = io.BytesIO(res.content)
        except Exception as e:
            print(f"[致命的エラー] 入力PDFの取得に失敗: {e}")
            return
    else:
        # ローカルファイルを読み込む
        if not os.path.exists(args.input):
            print(f"[エラー] ファイルが見つかりません: {args.input}")
            return
        print(f"[*] ローカルのリンク集PDFを読み込み中: {args.input}")
        with open(args.input, "rb") as f:
            pdf_stream = io.BytesIO(f.read())

    # 2. リンク抽出 
    log_func("[*] PDF内のリンクを解析しています...")
    
    # Run Gemini Analysis First
    gemini_metadata = scan_pdf_with_gemini(pdf_stream, log_func)
    
    # Reset stream for simple link extraction
    pdf_stream.seek(0)
    raw_links = extract_pdf_links(pdf_stream, log_func)
    
    log_func(f"[*] 抽出されたリンク数(Raw): {len(raw_links)} 件")

    if not raw_links and not gemini_metadata:
        log_func("[*] ダウンロードすべきリンクが見つかりませんでした。終了します。")
        return

    # 3. Merge Lists
    # Prefer Gemini metadata, but ensure we use raw links if logic permits
    # Strategy: Iterate raw_links. See if there is a fuzzy match in gemini_metadata for the URL.
    
    targets = []
    
    # Optimization: Create a normalized map for matching
    # Since extracted URLs might vary slightly (http vs https, trailing slash), we do simple contains check
    
    for link in raw_links:
        # Default name
        suggested = None
        
        # Try to find match in Gemini results
        # link is the "Real" URL found by pypdf
        for meta_url, meta_name in gemini_metadata.items():
            # If the Gemini text URL looks part of the real URL or vice versa
            if meta_url in link or link in meta_url:
                suggested = meta_name
                break
        
        targets.append((link, suggested))
    
    # Also add any Gemini links that weren't in raw_links (if any Text-only URLs were missed by extract_pdf_links fallback)
    # (Optional, but let's stick to raw_links as primary truth for now to avoid hallucinated URLs)

    # 3. ダウンロード & アップロード
    log_func("[*] 一括ダウンロード＆アップロードを開始します (並列数: 5)")
    with ThreadPoolExecutor(max_workers=5) as ex:
        futures = [ex.submit(download_and_upload, t[0], bucket_name, t[1], log_func) for t in targets]
        for f in as_completed(futures):
             # 処理結果の出力は各スレッド内で行われるためここでは待機のみ
             pass

    log_func("[*] 全ての処理が完了しました。")

if __name__ == "__main__":
    main()
