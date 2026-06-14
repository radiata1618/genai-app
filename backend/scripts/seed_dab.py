import os
import sys
from datetime import datetime, timezone

# Add backend directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_db

def seed_dab_data():
    db = get_db()
    print("Firestoreの初期化が完了しました。")
    
    # 1. 初期ホットトピック10選の定義
    initial_topics = [
        {
            "id": "graph_rag",
            "category": "知識の構造化と高度な検索",
            "name": "GraphRAG (Knowledge Graph × RAG)",
            "description": "単なるベクトル検索ではなく、ナレッジグラフ（知識グラフ）を組み合わせることで、データの「関係性」をLLMに理解させ、複雑な推論や高精度な回答を可能にする技術。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        },
        {
            "id": "multimodal_rag",
            "category": "知識の構造化と高度な検索",
            "name": "マルチモーダルRAGとデータ統合",
            "description": "テキストだけでなく、画像、図面、音声、センサーログなどの非構造化データを一元的にベクタライズし、生成AIプラットフォームで横断検索・活用するアーキテクチャ。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        },
        {
            "id": "data_fabric",
            "category": "データ分散化と自律運用",
            "name": "データファブリック（アクティブ・メタデータ管理）",
            "description": "AIがメタデータを自動で分析・学習し、散在するデータソース間の統合、クレンジング、データパイプライン生成を自動化・効率化するアプローチ。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        },
        {
            "id": "data_mesh",
            "category": "データ分散化と自律運用",
            "name": "データメッシュと「データ製品（Data Product）」",
            "description": "中央集権的なデータ基盤から脱却し、各ドメイン（部門や領域ごと）が責任を持ってデータを「製品」として開発・公開する分散型組織・技術アーキテクチャ。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        },
        {
            "id": "ai_agent_governance",
            "category": "次世代データガバナンスとAI統制",
            "name": "AIエージェントガバナンス",
            "description": "企業のデータ基盤にアクセスして自律的に動く「AIエージェント」の急増に伴い、そのアクセス権限、行動ログ、セキュリティを制御・監査するための新たなガバナンスフレームワーク。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        },
        {
            "id": "data_observability",
            "category": "次世代データガバナンスとAI統制",
            "name": "リアルタイム・データ品質監視 (Data Observability)",
            "description": "dbt等と連携し、データパイプラインの異常や「データの品質低下（Data Drift）」をリアルタイムで検知・可視化し、AIモデルの精度低下を未未防ぐ仕組み。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        },
        {
            "id": "semantic_layer",
            "category": "モダナイゼーションとエンジニアリング",
            "name": "セマンティックレイヤー (Semantic Layer)",
            "description": "SnowflakeやRedshiftの上位層で、ビジネスロジックや定義を共通化（LookerのLookMLやdbt Semantic Layerなど）し、AIやBIツールが迷わず正確なデータ定義を解釈できるようにする抽象化層。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        },
        {
            "id": "platform_engineering_data",
            "category": "モダナイゼーションとエンジニアリング",
            "name": "プラットフォームエンジニアリング (for Data)",
            "description": "データアナリストやデータサイエンティストが、セルフサービスで安全にデータ基盤や開発環境を利用できるようにするための、インフラ運用の標準化・仕組み化。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        },
        {
            "id": "ai_regulation_compliance",
            "category": "コンプライアンスと倫理",
            "name": "AI規制（EU AI Act等）へのデータ実証対応",
            "description": "AIが学習したデータソースの透明性（データリネージ＝追跡可能性）や偏りの排除を証明するための、厳格なメタデータ管理と監査対応。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        },
        {
            "id": "privacy_preserving_computation",
            "category": "コンプライアンスと倫理",
            "name": "プライバシー保護計算 (PETs)",
            "description": "企業の機密データや個人情報を暗号化したまま、クラウド上の生成AIプラットフォームで安全に分析・学習させるための秘密計算技術。",
            "status": "ACTIVE",
            "interest_score": 5,
            "known_score": 1,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc)
        }
    ]

    print("ホットトピックのシードデータを投入中...")
    hot_topics_ref = db.collection("dab_hot_topics")
    for topic in initial_topics:
        doc_id = topic["id"]
        # Overwrite or create
        hot_topics_ref.document(doc_id).set(topic)
        print(f"  - {topic['name']} を登録しました。")

    # 2. 初期長期記憶・設定プロンプトの定義
    default_summary_prompt = """あなたはデータアーキテクチャコンサルタントの学習支援を行う優秀なAIアシスタントです。
提供された最新記事やドキュメントを、以下の構造化フォーマットに従って要約し、解説を生成してください。

## フォーマット:
### 1. 技術概要 (3行)
- 何を実現する技術・サービスか？
- 従来のアプローチとの違いは何か？
- 主要な技術要素は何か？

### 2. コンサルタントとしての示唆
- なぜ今、データアーキテクチャの文脈でこのトピックが重要なのか？
- 企業のデータ基盤やガバナンス設計にどう影響を与えるか？実務（Snowflake/Databricks/GCP/dbt等）での活用場面は？
- 想定されるメリットと導入時の主な課題・注意点。

### 3. 関連技術・トピック
- 既存のどのホットトピック（GraphRAG, データメッシュ, セマンティックレイヤー等）と密接に関連しているか。その関係性は？
- 関連する業界トレンドや標準。
"""

    initial_user_memory = {
        "known_concepts": [],
        "learning_goals": "データアーキテクチャ、データガバナンス、データメッシュ、AIエージェント統制、最新のRAG（GraphRAGなど）の専門家になるための体系的学習。",
        "summary_prompt_template": default_summary_prompt,
        "updated_at": datetime.now(timezone.utc)
    }

    print("長期記憶/プロンプトの初期設定を投入中...")
    user_memory_ref = db.collection("dab_user_memory")
    user_memory_ref.document("default_user").set(initial_user_memory)
    print("  - default_user の初期プロファイルを登録しました。")
    
    print("データ投入が正常に完了しました！")

if __name__ == "__main__":
    seed_dab_data()
