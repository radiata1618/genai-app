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
    target_input = st.text_area("収集対象のURL (複数可: 改行区切り)", placeholder="https://example.com/report1.pdf\nhttps://example.com/report2.pdf", height=150)
else:
    uploaded_files = st.file_uploader("PDFファイルをアップロード (複数可)", type=["pdf"], accept_multiple_files=True)

# Run Button
if st.button("実行 (Collect)", type="primary"):
    if input_type.startswith("URL") and not target_input.strip():
        st.warning("URLを入力してください。")
    elif input_type.startswith("ローカル") and not uploaded_files:
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
            
            # 1. Prepare Input Sources
            input_sources = [] # List of (name, bytes)
            
            if input_type.startswith("ローカル"):
                for f in uploaded_files:
                    input_sources.append((f.name, f.read()))
            else:
                urls = [u.strip() for u in target_input.split('\n') if u.strip()]
                for i, url in enumerate(urls):
                    gui_log(f"[*] URLから親PDFを取得中 ({i+1}/{len(urls)}): {url}")
                    try:
                        res = requests.get(url, headers=local_collector.HEADERS, timeout=60)
                        res.raise_for_status()
                        input_sources.append((url, res.content))
                    except Exception as e:
                        gui_log(f"[エラー] URL取得失敗 ({url}): {e}")

            if not input_sources:
                 gui_log("[!] 処理対象が見つかりませんでした。")
                 st.stop()
            
            # 2. Iterate Sources
            all_targets = []
            
            for idx, (source_name, content_bytes) in enumerate(input_sources):
                gui_log(f"--- 親PDF処理 ({idx+1}/{len(input_sources)}): {source_name} ---")
                
                # Streams for this source
                pdf_stream_ai = io.BytesIO(content_bytes)
                pdf_stream_links = io.BytesIO(content_bytes)
                
                # Analysis
                gui_log(f"[*] AI解析を実行中...")
                gemini_metadata = local_collector.scan_pdf_with_gemini(pdf_stream_ai, log_func=gui_log)
                
                gui_log(f"[*] リンク抽出を実行中...")
                raw_links = local_collector.extract_pdf_links(pdf_stream_links, log_func=gui_log)
                
                gui_log(f"[*] 抽出リンク数: {len(raw_links)}")
                
                # Merge
                source_targets = []
                for link in raw_links:
                    suggested = None
                    for meta_url, meta_name in gemini_metadata.items():
                        if meta_url in link or link in meta_url:
                            suggested = meta_name
                            break
                    source_targets.append((link, suggested))
                
                all_targets.extend(source_targets)
                gui_log(f"[+] {len(source_targets)} 件をダウンロードリストに追加しました。")

            gui_log(f"==========================================")
            gui_log(f"[*] 解析完了。合計 {len(all_targets)} 件のファイルを処理します。")
            
            if not all_targets:
                gui_log("[*] ダウンロード対象がありませんでした。")
            else:
                 # 3. Batch Download
                targets = all_targets # already merged

                
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
