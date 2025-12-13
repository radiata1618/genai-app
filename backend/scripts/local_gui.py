import streamlit as st
import os
import requests
import requests
import io
import time
import queue
from concurrent.futures import ThreadPoolExecutor, as_completed, wait
# Import logic from local_collector (in same directory)
import local_collector
from dotenv import load_dotenv

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
input_type = st.radio("入力ソースを選択", ["URL (リンク集PDF)", "ローカルファイル (PDFアップロード)"])

target_input = None
uploaded_file = None

if input_type.startswith("URL"):
    target_input = st.text_input("収集対象のURL (PDFまたはページ)", placeholder="https://example.com/report_list.pdf")
else:
    uploaded_file = st.file_uploader("PDFファイルをアップロード", type=["pdf"])

# Run Button
if st.button("実行 (Collect)", type="primary"):
    if input_type.startswith("URL") and not target_input:
        st.warning("URLを入力してください。")
    elif input_type.startswith("ローカル") and not uploaded_file:
        st.warning("ファイルをアップロードしてください。")
    else:
        # --- Execution Logic ---
        st.divider()
        st.subheader("実行ログ")
        
        # Log container
        log_container = st.container()
        logs = []
        log_placeholder = log_container.empty()

        def gui_log(msg):
            # Timestamp
            ts = time.strftime("%H:%M:%S")
            logs.append(f"[{ts}] {msg}")
            # Update UI
            # Show last 10 logs or all in a scrollable area? 
            # Streamlit re-renders string. Let's show all joined by newline.
            log_placeholder.code("\n".join(logs))

        try:
            pdf_stream = None
            
            # 1. Get Input
            if uploaded_file:
                gui_log(f"[*] アップロードされたファイルを読み込み中: {uploaded_file.name}")
                pdf_stream = uploaded_file
            else:
                gui_log(f"[*] URLから親PDFを取得中: {target_input}")
                try:
                    res = requests.get(target_input, headers=local_collector.HEADERS, timeout=30)
                    res.raise_for_status()
                    pdf_stream = io.BytesIO(res.content)
                except Exception as e:
                    gui_log(f"[致命的エラー] 入力URLの取得に失敗: {e}")
                    st.stop()

            # 2. AI Analysis & Link Extraction
            gui_log("[*] PDFを解析中 (AI Metadata + Link Extraction)...")
            
            # Run AI Analysis (Gemini)
            # Need to clone stream because it's read twice
            pdf_bytes = pdf_stream.read()
            pdf_stream_ai = io.BytesIO(pdf_bytes)
            pdf_stream_links = io.BytesIO(pdf_bytes)
            
            gemini_metadata = local_collector.scan_pdf_with_gemini(pdf_stream_ai, log_func=gui_log)
            raw_links = local_collector.extract_pdf_links(pdf_stream_links, log_func=gui_log)
            
            gui_log(f"[*] 抽出されたリンク数(Raw): {len(raw_links)} 件")
            
            if not raw_links and not gemini_metadata:
                gui_log("[*] ダウンロードすべきリンクが見つかりませんでした。終了します。")
            else:
                 # 3. Merge Logic (Same as local_collector)
                targets = []
                for link in raw_links:
                    suggested = None
                    for meta_url, meta_name in gemini_metadata.items():
                        if meta_url in link or link in meta_url:
                            suggested = meta_name
                            break
                    targets.append((link, suggested))
                
                # 4. Download & Upload
                gui_log(f"[*] 一括ダウンロード＆アップロードを開始します (並列数: 5)")
                
                # Progress Bar
                progress_bar = st.progress(0)
                total_links = len(targets)
                
                # Use Queue for thread-safe logging
                log_queue = queue.Queue()
                def queue_logger(msg):
                    log_queue.put(msg)

                with ThreadPoolExecutor(max_workers=5) as ex:
                    futures = []
                    for t in targets:
                        # t is (url, suggested_name)
                        futures.append(ex.submit(local_collector.download_and_upload, t[0], bucket_name, t[1], log_func=queue_logger))
                    
                    # Polling loop to update logs and progress
                    completed_count = 0
                    while True:
                        while not log_queue.empty():
                            msg = log_queue.get()
                            gui_log(msg)
                        
                        dones = sum(1 for f in futures if f.done())
                        if total_links > 0:
                            progress_bar.progress(min(dones / total_links, 1.0))

                        if dones == total_links:
                            break
                        
                        time.sleep(0.5)
                    
                    while not log_queue.empty():
                        msg = log_queue.get()
                        gui_log(msg)

                gui_log("[*] 全ての処理が完了しました。")
                st.success("完了しました！")

        except Exception as e:
            st.error(f"予期せぬエラーが発生しました: {e}")
            gui_log(f"[EXCEPTION] {e}")
