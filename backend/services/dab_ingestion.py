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
# DAB処理にはコスト対効果の良いflash-liteモデルを使用（標準flashの約1/2のコスト）
from config import GEMINI_FLASH_MODEL, GEMINI_FLASH_LITE_MODEL

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

DEFAULT_FILTER_PROMPT = """あなたはデータアーキテクチャコンサルタントの自己学習支援システム用の分類AIです。
入力された技術記事（タイトルとURL）が、「データアーキテクチャコンサルタントが学習すべきか」を判定してください。

以下の条件に当てはまる記事は【採用（読むべき＝True）】と判定してください：
1. エンタープライズデータ基盤、データマネジメント、データ統合（DWH/Lakehouse、データメッシュ、セマンティックレイヤー、データファブリック、Data Observability等）に関するもの。
2. エンタープライズ環境でのRAG、LLMエージェント統合のアーキテクチャ設計や、セキュリティ/AIガバナンス・規制（EU AI Act等）に関するもの。

以下の条件に当てはまる記事は【除外（読むべきでない＝False）】と判定してください：
1. 一般的なプログラミング言語仕様（Go vs Java、Pythonの文法等）や言語固有のTips。
2. 一般的なフロントエンド開発手法やフレームワーク設計（Next.js、React、CSS等）。
3. インフラ/セキュリティ一般の資格の合格体験記（CKS等）や個人のOS環境構築（Ubuntu等）。
4. ガジェットやツールの個人的な使用感、個人の開発記、無関係なテーマ。

## 判定例：
- 『Bedrock AgentCore + Strands Agents SDKで作る社内RAGボット』 -> True (社内RAG/LLMエージェント設計)
- 『Claude Fable 5が突然使えなくなった(輸出管理指令によるアクセス停止)』 -> True (AIガバナンス/法規制)
- 『GoのパッケージシステムをJavaと比較しながら理解する』 -> False (言語比較)
- 『半年でNext.jsアプリを10本作って見えた設計の『判断基準』』 -> False (フロントエンド)
- 『CKS合格体験記〜AIと歩んだ44日間〜』 -> False (資格)
- 『QAエンジニアが「自分でテストやりきる」のをやめようとしている話』 -> False (一般的なテスト運用)

応答は必ず以下のJSON形式のみで行ってください。
{
  "is_relevant": true または false,
  "reason": "簡単な判定理由（1行）"
}"""

async def filter_article_by_ai(article_title: str, article_url: str) -> bool:
    """記事がデータアーキテクチャコンサルタントにとって有用か（ノイズでないか）をAIに判定させる"""
    client = get_genai_client()
    if not client:
        return True # AIクライアントがない場合はセーフティにTrueとする
        
    db = get_db()
    memory_doc = db.collection("dab_user_memory").document("default_user").get()
    filter_prompt = ""
    if memory_doc.exists:
        filter_prompt = memory_doc.to_dict().get("filter_prompt_template", "")
        
    if not filter_prompt:
        filter_prompt = DEFAULT_FILTER_PROMPT
        
    prompt = (
        f"【対象記事】\n"
        f"タイトル: {article_title}\n"
        f"URL: {article_url}\n\n"
        f"指示: 上記の記事がデータアーキテクチャ・AIガバナンスのテーマに合致し、読む価値があるかを上記ルールに照らし合わせて判定してください。"
    )
    
    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=filter_prompt,
                response_mime_type="application/json",
                temperature=0.1
            )
        )
        
        res_dict = json.loads(response.text.strip())
        is_relevant = res_dict.get("is_relevant", True)
        reason = res_dict.get("reason", "")
        print(f"  AIノイズ判定: {'採用' if is_relevant else '除外'} ({reason})")
        return is_relevant
    except Exception as e:
        print(f"AIノイズフィルタエラー: {e}")
        return True

async def fetch_web_trends_via_gemini(topic_name: str) -> List[Dict[str, Any]]:
    """GeminiのGoogle Searchグラウンディング機能を用いて、特定トピックに関する最新Web情報を収集する"""
    print(f"Gemini Web Searchでトレンド情報を検索中: {topic_name}")
    client = get_genai_client()
    if not client:
        print("WARNING: GenAI Client が初期化されていません。")
        return []
        
    system_instruction = (
        "あなたは最新の技術動向をリサーチする優秀なリサーチエージェントです。\n"
        "指定されたトピックに関する最新（2025年〜2026年）の技術解説、ブログ記事、公式ドキュメント、またはリリースの情報をWebから検索してください。\n"
        "候補として最大10件の記事タイトルとURLを見つけ出し、さらにその中から、データアーキテクチャの文脈における重要度（優先度スコア: 1〜5）を判定してください。\n"
        "以下のJSONフォーマット（配列のみ）で応答してください。それ以外の文字は一切含めないでください。\n\n"
        "## 応答JSONスキーマ:\n"
        "[\n"
        "  {\n"
        "    \"title\": \"記事またはドキュメントのタイトル\",\n"
        "    \"url\": \"完全なURL（httpまたはhttpsから始まるもの。ダミーは禁止）\",\n"
        "    \"brief_summary\": \"記事の簡潔な概要（2〜3行）\",\n"
        "    \"priority_score\": 1から5の重要度数値(5が最も重要)\n"
        "  }\n"
        "]"
    )
    
    prompt = f"トピック: 「{topic_name}」に関連する、2025年〜2026年現在の最新の技術動向や詳細な技術解説・ブログ記事を10件検索し、重要度スコアとともにリストアップしてください。"
    
    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=[types.Tool(google_search=types.GoogleSearch())], # Google Search を有効化
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
                    "brief_summary": item.get("brief_summary", ""),
                    "priority_score": int(item.get("priority_score", 3))
                })
        
        # 優先度スコア4以上のものだけにフィルタリングし、最大3件まで厳選
        results = sorted(results, key=lambda x: x["priority_score"], reverse=True)
        filtered_results = [r for r in results if r["priority_score"] >= 4][:3]
        
        # もしスコア4以上が1件もない場合は、上位3件をそのまま使用
        if not filtered_results and results:
            filtered_results = results[:3]
            
        print(f"Gemini Web Search から {len(filtered_results)} 件の厳選された技術情報を抽出しました（全候補 {len(results)} 件中）。")
        return filtered_results
    except Exception as e:
        print(f"Gemini Web Search エラー ({topic_name}): {e}")
        return []

async def generate_article_metadata(article_title: str, article_url: str, brief_summary: str = "", active_topics: List[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Gemini APIを呼び出し、構造化サマリ、おすすめの理由、優先度スコアを一括生成する"""
    client = get_genai_client()
    if not client:
        return {
            "summary": "AIクライアントの初期化エラーのため、サマリを生成できませんでした。",
            "recommendation_reason": "AI初期化エラー",
            "priority_score": 3,
            "author": "不明",
            "read_time": "5分",
            "target_level": "コンサル向け",
            "benefit": "最新トレンド理解",
            "mermaid_code": ""
        }
        
    db = get_db()
    
    # Firestoreからユーザー独自の要約プロンプトを取得
    memory_doc = db.collection("dab_user_memory").document("default_user").get()
    summary_prompt = ""
    if memory_doc.exists:
        summary_prompt = memory_doc.to_dict().get("summary_prompt_template", "")
        
    if not summary_prompt:
        # フォールバック用デフォルトプロンプト（意思決定支援型サマリ構成）
        summary_prompt = (
            "記事を以下の構成で構造化要約してください。\n\n"
            "### 🎯 この記事が解く「問い」と「結論」\n"
            "- **問い**: （この記事が扱っているアーキテクチャ設計や技術選定における具体的な課題や疑問を1行で）\n"
            "- **結論**: （それに対するこの記事の核心的な解決策や主張を1行で）\n\n"
            "### 🔑 ユニークな技術的論点・トレードオフ\n"
            "（この記事ならではの具体的な重要テーマ、設計上のメリット・デメリット、トレードオフを箇条書きで2〜3点挙げる。辞書的な一般論は除く）\n\n"
            "### 🎓 専門家を目指す中級者が読むべき理由\n"
            "（データアーキテクトや専門家を目指す中級者の実務にどう役立つか、どんな選択肢が増えるかを1〜2行で簡潔に示す）\n"
        )
        
    topics_context = ""
    if active_topics:
        topics_list = [f"- {t['name']}: {t['description']}" for t in active_topics]
        topics_context = "【ユーザーの現在の関心（ホットトピック）】:\n" + "\n".join(topics_list)

    system_instruction = (
        "あなたは優秀なデータアーキテクチャコンサルタントの学習支援AIです。\n"
        "与えられた記事の情報をWebから検索（グラウンディング）して詳細を把握し、以下のJSON形式で応答を出力してください。\n"
        "JSON以外の余計な文字は一切出力しないでください。\n\n"
        "## 応答JSONスキーマ:\n"
        "{\n"
        "  \"summary\": \"【要約プロンプト指示】に従って生成したマークダウン形式の構造化要約\",\n"
        "  \"recommendation_reason\": \"なぜこの記事がユーザーの関心（ホットトピック）にとって重要かを示す、おすすめの理由（日本語1〜2行）\",\n"
        "  \"priority_score\": ユーザーの関心（ホットトピック）との親和性や記事の重要性に応じた優先度（1〜5の数値、5が最高）。必ずユーザーのアクティブなホットトピックの内容に合致しているかを厳格に判定して決定してください。無関係なものは1や2、非常に関連が深い場合は4や5にしてください。一律3にするのは絶対に禁止です。\",\n"
        "  \"author\": \"記事の著者名または発信元の組織名（Web検索結果や記事内から特定できない場合は『不明』またはウェブサイト名とする）\",\n"
        "  \"read_time\": \"想定される読了時間（例：『3分』『5分』『10分』など、日本語表記）\",\n"
        "  \"target_level\": \"対象者レベル（例：『アーキテクト向け』『データエンジニア向け』『初心者向け』『コンサル向け』など、日本語15文字以内）\",\n"
        "  \"benefit\": \"この記事を読むことで得られる最大のベネフィット・学び（例：『RAGの改善手法』『セマンティックレイヤー概要』『法規制の理解』など、日本語15文字以内）\",\n"
        "  \"mermaid_code\": \"記事の内容を1枚絵で視覚的に整理するMermaid.jsのダイアグラムコード。アコーディオン内でグラフィカルに表示されます。マインドマップ (mindmap) またはフローチャート (graph TD) 等の構文を使用して、技術の関係性、構成要素、または主要な流れを表現してください。```mermaidなどのコードブロック記号は含めず、純粋なコードテキストのみを出力してください。\"\n"
        "}\n\n"
        f"【要約プロンプト指示】:\n{summary_prompt}"
    )

    prompt = (
        f"【対象記事】\n"
        f"タイトル: {article_title}\n"
        f"URL: {article_url}\n"
        f"事前概要: {brief_summary}\n\n"
        f"{topics_context}\n\n"
        f"指示：上記の記事のURLにアクセスする、またはWeb検索でこの記事の具体的な内容（技術仕様、機能、ユースケース）を調べて把握し、"
        f"システム指示に従ってJSONを生成してください。"
    )
    
    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,  # サマリ・Mermaid生成は品質重視でflashを使用
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                temperature=0.3
            )
        )
        
        res_dict = json.loads(response.text.strip())
        
        # image_urlはフロントエンドのSlideCardコンポーネントで代替するため空を1ンマイアスディックが対応
        return {
            "summary": res_dict.get("summary", "サマリの生成に失敗しました。"),
            "recommendation_reason": res_dict.get("recommendation_reason", "最新のトレンド情報です。"),
            "priority_score": int(res_dict.get("priority_score", 3)),
            "author": res_dict.get("author", "不明"),
            "read_time": res_dict.get("read_time", "5分"),
            "target_level": res_dict.get("target_level", "コンサル向け"),
            "benefit": res_dict.get("benefit", "最新トレンド理解"),
            "mermaid_code": res_dict.get("mermaid_code", ""),
            "image_url": ""  # SlideCardコンポーネントで代替するため不要
        }
    except Exception as e:
        print(f"メタデータ一括生成エラー: {e}")
        return {
            "summary": f"サマリの生成中にエラーが発生しました: {str(e)}",
            "recommendation_reason": "エラーが発生したため、デフォルトで取り込みました。",
            "priority_score": 3,
            "author": "不明",
            "read_time": "5分",
            "target_level": "コンサル向け",
            "benefit": "最新トレンド理解",
            "mermaid_code": "",
            "image_url": ""  # SlideCardコンポーネントで代替するため不要
        }

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
            model=GEMINI_FLASH_MODEL,
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
        
    # 2. Zenn RSSから新着記事を取得してノイズ除去
    raw_zenn_articles = fetch_zenn_rss()
    zenn_articles = []
    for art in raw_zenn_articles:
        # 重複チェックを事前に行うことで、AIノイズ判定の呼び出し回数を削減する
        url_hash = hashlib.md5(art["url"].encode('utf-8')).hexdigest()
        if db.collection("dab_feeds").document(url_hash).get().exists:
            continue
            
        print(f"\nZenn新規候補をAIフィルタリング判定中: {art['title']}")
        is_relevant = await filter_article_by_ai(art["title"], art["url"])
        if is_relevant:
            zenn_articles.append(art)
    
    # 3. 各アクティブトピックについて Gemini Web Search で最新技術情報を3件ずつ収集（すでに検索内で厳選済み）
    web_articles = []
    for topic in active_topics:
        topic_articles = await fetch_web_trends_via_gemini(topic["name"])
        web_articles.extend(topic_articles)
        
    all_raw_articles = zenn_articles + web_articles
    print(f"合計 {len(all_raw_articles)} 件のフィルタ適用済み記事候補が集まりました。")
    
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
            
        print(f"\n新着記事を処理中: {article['title']}")
        
        # 一次的に関連度を測るため、またはサマリを作るための下地
        brief = article.get("brief_summary", "")
        
        # コンサル向け構造化メタデータ（サマリ、おすすめ理由、優先度スコア）の一括生成
        meta = await generate_article_metadata(article["title"], article["url"], brief, active_topics)
        summary = meta["summary"]
        recommendation_reason = meta["recommendation_reason"]
        # Web Searchの時点でスコアがある場合はそれを優先しつつ、AI生成スコアも加味
        priority_score = article.get("priority_score", meta["priority_score"])
        
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
            "recommendation_reason": recommendation_reason,
            "priority_score": priority_score,
            "read_status": "UNREAD",
            "user_evaluations": None,
            "related_topics": topic_names,
            "created_at": datetime.now(timezone.utc),
            "author": article.get("author") or meta.get("author") or "不明",
            "read_time": meta.get("read_time", "5分"),
            "target_level": meta.get("target_level", "コンサル向け"),
            "benefit": meta.get("benefit", "最新トレンド理解"),
            "mermaid_code": meta.get("mermaid_code", ""),
            "image_url": meta.get("image_url")
        }
        
        doc_ref.set(feed_data)
        print(f"  -> Firestoreに保存完了！ (関連トピック: {', '.join(topic_names)}) (優先度: {priority_score})")
        processed_count += 1
        
        # APIレート制限への配慮（適度にウェイトを置く）
        import asyncio
        await asyncio.sleep(1)
        
    print(f"=== DAB 情報収集パイプライン終了 (新規処理件数: {processed_count} 件) ===")

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_ingestion_pipeline())
