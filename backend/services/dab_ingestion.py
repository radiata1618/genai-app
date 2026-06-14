import os
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
import json
import hashlib
from typing import List, Dict, Any
from pathlib import Path
from dotenv import load_dotenv
import email.utils

# Windows環境での文字化け・UnicodeEncodeError対策
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# 環境変数の読み込み (.env.local)
env_path = Path(__file__).parent.parent.parent / '.env.local'
if env_path.exists():
    print(f"環境変数を読み込んでいます: {env_path}")
    load_dotenv(dotenv_path=env_path)

# backend ディレクトリをシステムパスに追加
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_db
from google.genai import types
from services.ai_shared import get_genai_client

def fetch_zenn_rss() -> List[Dict[str, Any]]:
    """Zennの全体RSSフィード(RSS 2.0形式)から最新記事を取得してパースする"""
    url = "https://zenn.dev/feed"
    print(f"Zenn RSSフィードを取得中: {url}")
    
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            xml_data = response.read()
            
        root = ET.fromstring(xml_data)
        articles = []
        
        channel = root.find('channel')
        if channel is not None:
            for item in channel.findall('item'):
                title_el = item.find('title')
                link_el = item.find('link')
                pub_el = item.find('pubDate')
                
                title = title_el.text if title_el is not None else "無題"
                url = link_el.text if link_el is not None else ""
                pub_date_str = pub_el.text if pub_el is not None else ""
                
                # 日時パース (RFC 822 / RFC 2822)
                pub_date = None
                if pub_date_str:
                    try:
                        pub_date = email.utils.parsedate_to_datetime(pub_date_str)
                    except Exception:
                        pub_date = datetime.now(timezone.utc)
                else:
                    pub_date = datetime.now(timezone.utc)
                    
                if url:
                    articles.append({
                        "title": title,
                        "url": url,
                        "published_at": pub_date,
                        "source": "Zenn"
                    })
                
        print(f"Zenn RSSから {len(articles)} 件の記事を抽出しました。")
        return articles
    except Exception as e:
        print(f"Zenn RSS取得エラー: {e}")
        return []

async def fetch_web_trends_via_gemini(topic_name: str) -> List[Dict[str, Any]]:
    """GeminiのGoogle Searchグラウンディング機能を用いて、特定トピックに関する最新Web情報を収集する"""
    print(f"Gemini Web Searchでトレンド情報を検索中: {topic_name}")
    client = get_genai_client()
    if not client:
        print("WARNING: GenAI Client が初期化されていません。")
        return []
        
    system_instruction = (
        "あなたは最新の技術動向をリサーチする優秀なリサーチエージェントです。\n"
        "指定されたトピックに関する最新の技術解説、ブログ記事、公式ドキュメント、またはリリースの情報をWebから検索してください。\n"
        "実在する信頼できる情報源のみを対象とし、タイトル、URL、簡単な内容概要（3行程度）を必ず抽出してください。\n"
        "以下のJSONフォーマット（配列のみ）で応答してください。それ以外の文字は一切含めないでください。\n\n"
        "## 応答JSONスキーマ:\n"
        "[\n"
        "  {\n"
        "    \"title\": \"記事またはドキュメントのタイトル\",\n"
        "    \"url\": \"完全なURL（httpまたはhttpsから始まるもの。ダミーは禁止）\",\n"
        "    \"brief_summary\": \"記事の簡潔な概要（2〜3行）\"\n"
        "  }\n"
        "]"
    )
    
    prompt = f"トピック: 「{topic_name}」に関連する、2025年〜2026年現在の最新の技術動向や詳細な技術解説・ブログ記事を3件見つけてリストアップしてください。"
    
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=[types.Tool(google_search=types.GoogleSearch())], # Google Search を有効化
                # response_mime_type="application/json" は Search ツールと併用できないため削除
                temperature=0.3
            )
        )
        
        text = response.text or ""
        # JSONブロックの抽出
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        items = json.loads(text.strip())
        results = []
        for item in items:
            if item.get("url") and item.get("title"):
                results.append({
                    "title": item["title"],
                    "url": item["url"],
                    "published_at": datetime.now(timezone.utc),
                    "source": "Gemini Web Search",
                    "brief_summary": item.get("brief_summary", "")
                })
        print(f"Gemini Web Search から {len(results)} 件の技術情報を抽出しました。")
        return results
    except Exception as e:
        print(f"Gemini Web Search エラー ({topic_name}): {e}")
        return []

async def generate_consultant_summary(article_title: str, article_url: str, brief_summary: str = "") -> str:
    """Gemini APIを呼び出し、コンサルタント用の構造化サマリを生成する"""
    client = get_genai_client()
    if not client:
        return "AIクライアントの初期化エラーのため、サマリを生成できませんでした。"
        
    db = get_db()
    
    # Firestoreからユーザー独自の要約プロンプトを取得
    memory_doc = db.collection("dab_user_memory").document("default_user").get()
    summary_prompt = ""
    if memory_doc.exists:
        summary_prompt = memory_doc.to_dict().get("summary_prompt_template", "")
        
    if not summary_prompt:
        # フォールバック用デフォルトプロンプト
        summary_prompt = (
            "あなたは優秀なデータアーキテクチャコンサルタントの学習支援AIです。\n"
            "記事を以下の構成で構造化要約してください。\n"
            "1. 技術概要 (3行)\n"
            "2. コンサルタントとしての示唆 (実務的な重要性、影響)\n"
            "3. 関連技術・トピック\n"
        )
        
    # 記事をスクレイピングして内容を入手したいが、アクセス制限や速度を考慮し、
    # タイトルと簡単な概要からGeminiにWeb検索(Grounding)させつつ要約させると非常に高精度かつ安定したサマリが得られます。
    prompt = (
        f"【対象記事】\n"
        f"タイトル: {article_title}\n"
        f"URL: {article_url}\n"
        f"事前概要: {brief_summary}\n\n"
        f"指示：上記の記事のURLにアクセスする、またはWeb検索でこの記事の具体的な内容（技術仕様、機能、ユースケース）を調べて把握し、"
        f"以下のカスタマイズプロンプト指示に従ってコンサルタント向けの構造化要約を日本語で生成してください。\n\n"
        f"【要約プロンプト指示】:\n{summary_prompt}"
    )
    
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())], # 記事内容の補完のために検索を許可
                temperature=0.3
            )
        )
        return response.text or "サマリの生成に失敗しました。"
    except Exception as e:
        print(f"サマリ生成エラー: {e}")
        return f"サマリの生成中にエラーが発生しました: {str(e)}"

async def map_article_to_topics(article_title: str, summary: str, active_topics: List[Dict[str, Any]]) -> List[str]:
    """記事の内容を分析し、現在アクティブなホットトピック10選のどれに紐づくかをGeminiに推論させる"""
    client = get_genai_client()
    if not client or not active_topics:
        return []
        
    topics_list = [f"- ID: {t['id']}, 名前: {t['name']}" for t in active_topics]
    topics_context = "\n".join(topics_list)
    
    system_instruction = (
        "あなたは記事の分類分類エージェントです。\n"
        "提供された記事のタイトルと要約から、現在アクティブなホットトピックリスト（複数選択可）のうち、最も密接に関連しているトピックのIDを抽出してください。\n"
        "どれにも関連しない場合は空の配列を返してください。\n"
        "必ずJSON形式の配列のみで回答してください。例: [\"graph_rag\", \"multimodal_rag\"]\n"
        "JSON以外の余計な文字は一切出力しないでください。"
    )
    
    prompt = (
        f"【アクティブなホットトピックリスト】:\n{topics_context}\n\n"
        f"【対象記事】\n"
        f"タイトル: {article_title}\n"
        f"サマリ:\n{summary}\n"
    )
    
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                temperature=0.1
            )
        )
        
        topic_ids = json.loads(response.text)
        # 有効なトピックIDのみにフィルタ
        valid_ids = {t['id'] for t in active_topics}
        mapped_ids = [tid for tid in topic_ids if tid in valid_ids]
        return mapped_ids
    except Exception as e:
        print(f"トピックマッピングエラー: {e}")
        return []

async def run_ingestion_pipeline():
    """情報収集インジェクションのメインバッチ処理"""
    print("=== DAB 情報収集パイプライン開始 ===")
    db = get_db()
    
    # 1. 現在のアクティブトピック（10選）を取得
    topics_docs = db.collection("dab_hot_topics").where("status", "==", "ACTIVE").get()
    active_topics = [doc.to_dict() for doc in topics_docs]
    
    if not active_topics:
        print("アクティブなホットトピックが見つかりません。バッチを終了します。")
        return
        
    # 2. Zenn RSSから新着記事を取得
    zenn_articles = fetch_zenn_rss()
    
    # 3. 各アクティブトピックについて Gemini Web Search で最新技術情報を3件ずつ収集
    web_articles = []
    for topic in active_topics:
        topic_articles = await fetch_web_trends_via_gemini(topic["name"])
        web_articles.extend(topic_articles)
        
    all_raw_articles = zenn_articles + web_articles
    print(f"合計 {len(all_raw_articles)} 件の記事候補が集まりました。")
    
    # 4. 重複排除とフィルタリング
    feed_ref = db.collection("dab_feeds")
    processed_count = 0
    
    for article in all_raw_articles:
        # URLのハッシュ値をドキュメントIDとして使用（重複保存を防止）
        url_hash = hashlib.md5(article["url"].encode('utf-8')).hexdigest()
        
        # 既にFirestoreに存在するかチェック
        doc_ref = feed_ref.document(url_hash)
        if doc_ref.get().exists:
            # 既に登録済みの場合はスキップ
            continue
            
        # Zenn記事の場合、アクティブトピックに関連するかを事前に簡易キーワード判定、
        # または直接Geminiに判定させて、関連しないノイズ記事ならスキップする。
        # ここではノイズ排除のため、「アクティブトピックのどれかに関連している」と分類された場合のみ取り込む。
        print(f"\n新着記事を処理中: {article['title']}")
        
        # 一次的に関連度を測るため、またはサマリを作るための下地
        brief = article.get("brief_summary", "")
        
        # コンサル向け構造化サマリの生成
        summary = await generate_consultant_summary(article["title"], article["url"], brief)
        
        # 記事をアクティブなホットトピックにマッピング
        mapped_topic_ids = await map_article_to_topics(article["title"], summary, active_topics)
        
        # Zenn記事でどれにもマッピングされなかった場合は、ノイズとしてスキップ
        if not mapped_topic_ids and article["source"] == "Zenn":
            print("  -> 現在のホットトピックに関連しないため、ノイズとしてスキップします。")
            continue
            
        # マッピングされたトピック名を収集
        topic_names = []
        for t_id in mapped_topic_ids:
            for t in active_topics:
                if t["id"] == t_id:
                    topic_names.append(t["name"])
                    break
        
        # Firestoreへ保存
        feed_data = {
            "id": url_hash,
            "title": article["title"],
            "url": article["url"],
            "source": article["source"],
            "published_at": article["published_at"],
            "summary": summary,
            "read_status": "UNREAD",
            "user_evaluations": None,
            "related_topics": topic_names,
            "created_at": datetime.now(timezone.utc)
        }
        
        doc_ref.set(feed_data)
        print(f"  -> Firestoreに保存完了！ (関連トピック: {', '.join(topic_names)})")
        processed_count += 1
        
        # APIレート制限への配慮（適度にウェイトを置く）
        import asyncio
        await asyncio.sleep(1)
        
    print(f"=== DAB 情報収集パイプライン終了 (新規処理件数: {processed_count} 件) ===")

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_ingestion_pipeline())
