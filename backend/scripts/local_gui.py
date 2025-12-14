import streamlit as st
import os
import requests
import requests
import io
import time
import queue
import asyncio
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed, wait

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

# Import logic from local_collector (in same directory)
import local_collector
from dotenv import load_dotenv
import sys

# Add backend directory to path to allow importing crawlers
script_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(script_dir, '..'))
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

try:
    from crawlers import McKinseyCrawler, BCGCrawler
except ImportError:
    st.error("Crawler module check failed. Make sure 'playwright' is installed and 'backend/crawlers' exists.")


# Page Config
st.set_page_config(page_title="PDF Collector GUI", layout="wide")

# Title
st.title("📚 PDF Collection Tool (Local App)")
st.markdown("ローカル環境から直接インターネットにアクセスし、PDFを収集してGCSに保存します。")

# --- Setup Environment & Auth (reusing logic) ---
# Load .env.local
script_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(script_dir, '../../.env.local')
load_dotenv(env_path)

# Auth fix
key_path = os.path.abspath(os.path.join(script_dir, '../../key.json'))
if os.path.exists(key_path):
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path

bucket_name = os.environ.get("GCS_BUCKET_NAME_FOR_CONSUL_DOC")

if not bucket_name:
    st.error("エラー: 環境変数 `GCS_BUCKET_NAME_FOR_CONSUL_DOC` が見つかりません。`.env.local`を確認してください。")
    st.stop()

# --- UI Components ---

# Input Type
input_type = st.radio("入力ソースを選択", ["URL (リンク集PDF)", "ローカルファイル (PDFアップロード)", "Google Search (Web)", "Site Crawler (Direct)"])

target_input = None
uploaded_file = None

if input_type.startswith("URL"):
    target_input = st.text_area("収集対象のURL (複数可: 改行区切り)", placeholder="https://example.com/report1.pdf\nhttps://example.com/report2.pdf", height=150)
elif input_type.startswith("ローカル"):
    uploaded_files = st.file_uploader("PDFファイルをアップロード (複数可)", type=["pdf"], accept_multiple_files=True)

# Google Search Config UI
CONSULTING_DOMAINS = {
    "McKinsey": "mckinsey.com",
    "BCG": "bcg.com",
    "Bain": "bain.com",
    "Deloitte": "deloitte.com",
    "PwC": "pwc.com",
    "EY": "ey.com",
    "Accenture": "accenture.com",
}
target_keywords = ""
target_domains = []
if input_type == "Google Search (Web)":
    st.info("Google検索を利用してPDFを収集します。キーワードと対象ファームを指定してください。")
    col1, col2 = st.columns([1, 1])
    with col1:
        target_keywords = st.text_input("検索キーワード (例: AI, DX, サステナビリティ)", placeholder="AI, DX")
    with col2:
        selected_firms = st.multiselect("対象ファーム (ドメイン)", list(CONSULTING_DOMAINS.keys()), default=["McKinsey", "BCG", "Bain"])
        target_domains = [CONSULTING_DOMAINS[f] for f in selected_firms]

# Crawler Config UI
crawler_target_firms = []
crawler_limit = 10
crawler_regions = []
if input_type == "Site Crawler (Direct)":
    st.info("各社のサイトを直接巡回してPDFを収集します。処理に時間がかかりますが、網羅性が高いです。")
    col1, col2, col3 = st.columns([1, 1, 1])
    with col1:
       crawler_target_firms = st.multiselect("巡回対象", ["McKinsey", "BCG"], default=["McKinsey"])
    with col2:
       crawler_regions = st.multiselect("対象リージョン", ["Global (EN)", "Japan (JP)"], default=["Global (EN)"])
    with col3:
       crawler_limit = st.number_input("1社/地域あたりの最大数", min_value=1, max_value=500, value=10)

# Run Button
if st.button("実行 (Collect)", type="primary"):
    if input_type.startswith("URL") and not target_input.strip():
        st.warning("URLを入力してください。")
    elif input_type.startswith("ローカル") and not uploaded_files:
        st.warning("ファイルをアップロードしてください。")
    elif input_type == "Google Search (Web)" and (not target_keywords or not target_domains):
        st.warning("キーワードと対象ファームを選択してください。")
    elif input_type == "Site Crawler (Direct)" and (not crawler_target_firms or not crawler_regions):
         st.warning("巡回対象とリージョンを選択してください。")
    else:
        # --- Execution Logic ---
        st.divider()
        st.subheader("実行ログ")
        
        # Log container
        log_container = st.container()
        logs = []
        log_placeholder = log_container.empty()

        def gui_log(msg):
            ts = time.strftime("%H:%M:%S")
            logs.append(f"[{ts}] {msg}")
            log_placeholder.code("\n".join(logs))

        try:
            # 1. Prepare Targets
            all_targets = [] # List of (url, suggested_name)
            
            # --- LOCAL FILE MODE ---
            if input_type.startswith("ローカル"):
                input_sources = []
                for f in uploaded_files:
                    input_sources.append((f.name, f.read()))
                
                # Analyze each local file
                for idx, (source_name, content_bytes) in enumerate(input_sources):
                    gui_log(f"--- 親PDF処理 ({idx+1}/{len(input_sources)}): {source_name} ---")
                    pdf_stream_ai = io.BytesIO(content_bytes)
                    pdf_stream_links = io.BytesIO(content_bytes)
                    
                    gui_log(f"[*] AI解析を実行中...")
                    gemini_metadata = local_collector.scan_pdf_with_gemini(pdf_stream_ai, log_func=gui_log)
                    gui_log(f"[*] リンク抽出を実行中...")
                    raw_links = local_collector.extract_pdf_links(pdf_stream_links, log_func=gui_log)
                    
                    # Merge
                    for link in raw_links:
                        suggested = None
                        for meta_url, meta_name in gemini_metadata.items():
                            if meta_url in link or link in meta_url:
                                suggested = meta_name
                                break
                        all_targets.append((link, suggested))
                    gui_log(f"[+] {len(raw_links)} 件をリストに追加しました。")

            # --- URL LIST MODE ---
            elif input_type.startswith("URL"):
                urls = [u.strip() for u in target_input.split('\n') if u.strip()]
                for i, url in enumerate(urls):
                    gui_log(f"[*] URLから親PDFを取得中 ({i+1}/{len(urls)}): {url}")
                    try:
                        res = requests.get(url, headers=local_collector.HEADERS, timeout=60)
                        res.raise_for_status()
                        content_bytes = res.content
                        
                        # Same logic as Local File
                        pdf_stream_ai = io.BytesIO(content_bytes)
                        pdf_stream_links = io.BytesIO(content_bytes)
                        gemini_metadata = local_collector.scan_pdf_with_gemini(pdf_stream_ai, log_func=gui_log)
                        raw_links = local_collector.extract_pdf_links(pdf_stream_links, log_func=gui_log)
                        
                        for link in raw_links:
                             suggested = None
                             for meta_url, meta_name in gemini_metadata.items():
                                 if meta_url in link or link in meta_url:
                                     suggested = meta_name
                                     break
                             all_targets.append((link, suggested))
                             
                    except Exception as e:
                        gui_log(f"[エラー] URL取得失敗 ({url}): {e}")

            # --- GOOGLE SEARCH MODE ---
            elif input_type == "Google Search (Web)":
                api_key = os.environ.get("GOOGLE_SEARCH_API_KEY") or os.environ.get("GOOGLE_CLOUD_API_KEY")
                cx = os.environ.get("GOOGLE_SEARCH_CX")
                
                if not api_key or not cx:
                    st.error("エラー: APIキー設定が見つかりません。")
                    st.stop()

                gui_log(f"[*] Google検索を開始します... キーワード: {target_keywords}")
                site_query = " OR ".join([f"site:{d}" for d in target_domains])
                full_query = f"{target_keywords} filetype:pdf ({site_query})"
                
                results = local_collector.search_pdfs_via_google(api_key, cx, full_query, num_results=20, log_func=gui_log)
                for res in results:
                    title_clean = local_collector.clean_text(res['title'])
                    all_targets.append((res['link'], title_clean))
            
            # --- CRAWLER MODE ---
            elif input_type == "Site Crawler (Direct)":
                gui_log(f"[*] クローラーを開始します。対象: {crawler_target_firms}, Limit: {crawler_limit}")
                
                # Map UI selection to locale codes
                target_locales = []
                if "Global (EN)" in crawler_regions: target_locales.append("en")
                if "Japan (JP)" in crawler_regions: target_locales.append("jp")

                for firm in crawler_target_firms:
                    for locale in target_locales:
                        locale_label = "Global" if locale == "en" else "Japan"
                        gui_log(f"--- Crawling {firm} ({locale_label}) ---")
                        try:
                            crawler = None
                            if firm == "McKinsey":
                                crawler = McKinseyCrawler(log_func=gui_log)
                            elif firm == "BCG":
                                crawler = BCGCrawler(log_func=gui_log)
                            
                            if crawler:
                                results = crawler.crawl(limit=crawler_limit, locale=locale)
                                for res in results:
                                    title_clean = local_collector.clean_text(res['title'])
                                    # Append locale to title for clarity
                                    if locale == "jp":
                                        title_clean = f"[JP] {title_clean}"
                                    all_targets.append((res['url'], title_clean))
                        except Exception as e:
                            gui_log(f"[Error] {firm} ({locale}) crawler failed: {e}")


            # 2. Results Processing
            # Remove duplicates based on URL
            unique_targets = {}
            for t in all_targets:
                if t[0] not in unique_targets:
                    unique_targets[t[0]] = t
            all_targets = list(unique_targets.values())

            gui_log(f"==========================================")
            gui_log(f"[*] 解析完了。合計 {len(all_targets)} 件のファイルを処理します。")
            
            if not all_targets:
                gui_log("[*] ダウンロード対象がありませんでした。")
            else:
                 # 3. Batch Download
                targets = all_targets
                gui_log(f"[*] 一括ダウンロード＆アップロードを開始します (並列数: 5)")
                
                progress_bar = st.progress(0)
                total_links = len(targets)
                log_queue = queue.Queue()
                def queue_logger(msg):
                    log_queue.put(msg)

                with ThreadPoolExecutor(max_workers=5) as ex:
                    futures = []
                    for t in targets:
                        futures.append(ex.submit(local_collector.download_and_upload, t[0], bucket_name, t[1], log_func=queue_logger))
                    
                    completed_count = 0
                    while True:
                        while not log_queue.empty():
                             gui_log(log_queue.get())
                        dones = sum(1 for f in futures if f.done())
                        if total_links > 0:
                            progress_bar.progress(min(dones / total_links, 1.0))
                        if dones == total_links:
                            break
                        time.sleep(0.5)
                    while not log_queue.empty():
                         gui_log(log_queue.get())

                gui_log("[*] 全ての処理が完了しました。")
                st.success("完了しました！")

        except Exception as e:
            st.error(f"予期せぬエラーが発生しました: {type(e).__name__}: {e}")
            gui_log(f"[EXCEPTION] {repr(e)}")
            import traceback
            traceback.print_exc()
