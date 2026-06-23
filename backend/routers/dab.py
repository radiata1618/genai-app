from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from google.cloud import firestore
from database import get_db
from google.genai import types
from services.ai_shared import get_genai_client
from services.dab_ingestion import run_ingestion_pipeline
import uuid
import json
from config import GEMINI_FLASH_MODEL

router = APIRouter(
    prefix="/dab",
    tags=["dab"],
)

# --- Models ---

class Topic(BaseModel):
    id: str
    category: str
    name: str
    description: str
    status: str  # "ACTIVE", "CANDIDATE", "ARCHIVED", "DECAYED"
    interest_score: int
    known_score: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class TopicCommitRequest(BaseModel):
    topics: List[Topic]

class EditChatRequest(BaseModel):
    message: str
    current_topics: List[Topic]

class EditChatResponse(BaseModel):
    assistant_message: str
    changes: List[Dict[str, Any]] # JSON-like list of changes (add, delete, modify)

class PromptEditRequest(BaseModel):
    message: str
    current_prompt: str

class PromptEditResponse(BaseModel):
    assistant_message: str
    proposed_prompt: str

class PromptCommitRequest(BaseModel):
    prompt: str

class FilterPromptEditRequest(BaseModel):
    message: str
    current_prompt: str

class FilterPromptEditResponse(BaseModel):
    assistant_message: str
    proposed_prompt: str

class FilterPromptCommitRequest(BaseModel):
    prompt: str

class UserMemory(BaseModel):
    known_concepts: List[str]
    learning_goals: str
    summary_prompt_template: str
    filter_prompt_template: Optional[str] = None
    updated_at: datetime

class DetailEvaluation(BaseModel):
    reliability: int  # 1-5
    practicality: int # 1-5
    novelty: int      # 1-5
    value: int        # 1-5

class EvaluationRequest(BaseModel):
    is_known: bool       # 知っていたか (True/False)
    is_interested: bool  # 興味があるか (True/False)
    grain_level: str     # 知りたい粒度 ("BASIC", "PRACTICAL", "ARCHITECTURAL")
    skipped: Optional[bool] = False  # スキップされたか (True/False)
    detail_eval: Optional[DetailEvaluation] = None # 詳細評価

class FeedItem(BaseModel):
    id: str
    title: str
    url: str
    source: str
    published_at: Optional[datetime] = None
    summary: str
    read_status: str  # "UNREAD", "READ"
    user_evaluations: Optional[Dict[str, Any]] = None
    related_topics: List[str]
    created_at: datetime
    author: Optional[str] = None
    read_time: Optional[str] = None
    target_level: Optional[str] = None
    benefit: Optional[str] = None
    mermaid_code: Optional[str] = None
    image_url: Optional[str] = None
    recommendation_reason: Optional[str] = None
    priority_score: Optional[int] = 3
    expert_id: Optional[str] = None  # 有識者投稿の場合の有識者ID

class Expert(BaseModel):
    id: str
    name: str
    avatar_url: Optional[str] = None
    topic_ids: List[str]
    accounts: Dict[str, str]  # {"zenn": "...", "github": "...", "website": "...", "x": "..."}
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None



class SkipAllRequest(BaseModel):
    feed_ids: List[str]


# --- Helpers ---

async def update_user_memory_async(db: firestore.Client, topic_ids: List[str], eval_data: Dict[str, Any]):
    """非同期バックグラウンド処理：ユーザー評価に基づいて長期記憶を更新する"""
    try:
        client = get_genai_client()
        if not client:
            print("WARNING: GenAI Client not initialized in async memory update")
            return
            
        # 1. ユーザーの現在のメモリを取得
        memory_ref = db.collection("dab_user_memory").document("default_user")
        memory_doc = memory_ref.get()
        if not memory_doc.exists:
            print("WARNING: default_user memory not found")
            return
        
        memory = memory_doc.to_dict()
        known_concepts = memory.get("known_concepts", [])
        learning_goals = memory.get("learning_goals", "")
        
        # 2. 評価されたトピックの情報を取得
        topics_info = []
        for t_id in topic_ids:
            t_doc = db.collection("dab_hot_topics").document(t_id).get()
            if t_doc.exists:
                topics_info.append(t_doc.to_dict()["name"])
        
        # 3. Geminiに投げて長期記憶の概念更新案を決定させる
        eval_summary = (
            f"ユーザーはトピック: {', '.join(topics_info)} に関する情報を閲覧し、以下のように評価しました。\n"
            f"- すでに知っていたか: {'はい' if eval_data['is_known'] else 'いいえ'}\n"
            f"- 興味があるか: {'はい' if eval_data['is_interested'] else 'いいえ'}\n"
            f"- 知りたい粒度: {eval_data['grain_level']}\n\n"
            f"現在の長期記憶の既知概念リスト: {json.dumps(known_concepts, ensure_ascii=False)}\n\n"
            "指示：もしユーザーが「すでに知っていた」と評価した場合、関連する技術名や概念を「既知概念リスト」に追加してください。"
            "興味スコアや知りたい粒度の傾向を踏まえて、既知概念リストに新しく登録すべき概念や変更を、プレーンなJSON形式（配列形式）で出力してください。"
            "JSON以外の説明は含めないでください。例: [\"GraphRAG\", \"Vector Search\"]"
        )
        
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=eval_summary,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2
            )
        )
        
        try:
            suggested_concepts = json.loads(response.text)
            if isinstance(suggested_concepts, list):
                # マージして一意にする
                updated_concepts = list(set(known_concepts + suggested_concepts))
                memory_ref.update({
                    "known_concepts": updated_concepts,
                    "updated_at": datetime.now(timezone.utc)
                })
                print(f"DEBUG: Long-term memory updated. Known concepts count: {len(updated_concepts)}")
        except Exception as json_e:
            print(f"Failed to parse memory update response: {response.text}, Error: {json_e}")
            
        # 4. ホットトピックの関心スコア・既知スコアの更新
        for t_id in topic_ids:
            t_ref = db.collection("dab_hot_topics").document(t_id)
            t_doc = t_ref.get()
            if t_doc.exists:
                t_data = t_doc.to_dict()
                known_score = t_data.get("known_score", 1)
                interest_score = t_data.get("interest_score", 5)
                
                # 既知評価なら既知スコアをプラス、未知ならマイナス（最低1）
                if eval_data['is_known']:
                    known_score = min(5, known_score + 1)
                else:
                    known_score = max(1, known_score - 1)
                    
                # 興味ありなら関心スコアをプラス、興味なしならマイナス
                if eval_data['is_interested']:
                    interest_score = min(5, interest_score + 1)
                else:
                    interest_score = max(1, interest_score - 1)
                
                # スコア更新
                update_fields = {
                    "known_score": known_score,
                    "interest_score": interest_score,
                    "updated_at": datetime.now(timezone.utc)
                }
                
                # 既知スコアが5（完全に理解）に達した場合、ACTIVEからARCHIVEDへの移行候補となる
                # (ここでは自動移行ではなく、スコア更新のみを行い、トピックライフサイクルマネージャ側で後ほど検知する)
                t_ref.update(update_fields)
                
    except Exception as e:
        print(f"Error in update_user_memory_async: {e}")

# --- Endpoints ---

@router.get("/topics", response_model=List[Topic])
async def get_topics(db: firestore.Client = Depends(get_db)):
    """現在登録されているすべてのトピック（ACTIVE、CANDIDATE等）を取得する"""
    try:
        docs = db.collection("dab_hot_topics").order_by("category").stream()
        topics = []
        for d in docs:
            data = d.to_dict()
            if data is not None:
                topics.append(Topic(**data))  # type: ignore
        return topics
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/memory", response_model=UserMemory)
async def get_user_memory(db: firestore.Client = Depends(get_db)):
    """長期記憶・ユーザープロファイル情報を取得する"""
    try:
        doc = db.collection("dab_user_memory").document("default_user").get()
        if doc.exists:
            data = doc.to_dict()
            if data is not None:
                return UserMemory(**data)  # type: ignore
        raise HTTPException(status_code=404, detail="User memory profile not found.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/topics/edit-ai", response_model=EditChatResponse)
async def edit_topics_ai(req: EditChatRequest):
    """AIと対話し、ホットトピックの変更案（プレビュー差分）を生成する"""
    client = get_genai_client()
    if not client:
        raise HTTPException(status_code=500, detail="Gemini client is not initialized.")

    # 現在のトピック情報をテキスト化
    topics_context = []
    for t in req.current_topics:
        topics_context.append(f"- ID: {t.id}\n  カテゴリ: {t.category}\n  技術名: {t.name}\n  説明: {t.description}\n  ステータス: {t.status}")
    topics_context_str = "\n".join(topics_context)

    system_instruction = (
        "あなたはデータアーキテクチャコンサルタントの自己学習支援システムの管理者エージェントです。\n"
        "ユーザーからの「ホットトピックの追加・削除・編集」の要求を受けて、変更差分を構造化データで生成してください。\n"
        "必ず以下のJSON構造のみで応答してください。JSON以外の文章（Markdownのバックテック含む）は一切出力しないでください。\n\n"
        "## 応答JSONスキーマ:\n"
        "{\n"
        "  \"assistant_message\": \"ユーザーへのチャット返答メッセージ（日本語）\",\n"
        "  \"changes\": [\n"
        "    {\n"
        "      \"action\": \"add | delete | modify\",\n"
        "      \"id\": \"対象トピックID（追加の場合は新規ID）\",\n"
        "      \"topic\": {\n"
        "        \"id\": \"トピックID\",\n"
        "        \"category\": \"カテゴリ（既存のものに合わせるか、新しい適切なもの）\",\n"
        "        \"name\": \"技術名（例: GraphRAG等）\",\n"
        "        \"description\": \"説明文（コンサル視点でわかりやすく）\",\n"
        "        \"status\": \"ACTIVE\",\n"
        "        \"interest_score\": 5,\n"
        "        \"known_score\": 1\n"
        "      }\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        "## 注意事項:\n"
        "- `delete` の場合は `id` と `action` のみを changes に含めてください。\n"
        "- `modify` の場合は、変更される部分を含む完全な `topic` オブジェクトを含めてください。\n"
        "- `add` の場合は、新規ID（半角英数字アンダースコア）を発行し、完全な `topic` オブジェクトを含めてください。"
    )

    prompt = (
        f"【現在のホットトピックリスト】:\n{topics_context_str}\n\n"
        f"【ユーザーの指示】:\n{req.message}\n"
    )

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                temperature=0.2
            )
        )
        
        result = json.loads(response.text)
        return EditChatResponse(**result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to generate changes: {str(e)}")

@router.post("/topics/commit")
async def commit_topics(req: TopicCommitRequest, db: firestore.Client = Depends(get_db)):
    """AIが生成し、ユーザーが確定したトピック変更をFirestoreにコミットする"""
    try:
        batch = db.batch()
        
        # 1. 送信されたトピックIDのリストを取得
        incoming_ids = {t.id for t in req.topics}
        
        # 2. 現在Firestoreにあるトピックを取得
        current_docs = db.collection("dab_hot_topics").stream()
        current_ids = {d.id for d in current_docs}
        
        # 3. 削除対象のトピックをFirestoreから削除
        for doc_id in current_ids:
            if doc_id not in incoming_ids:
                doc_ref = db.collection("dab_hot_topics").document(doc_id)
                batch.delete(doc_ref)
                
        # 4. 追加・更新対象のトピックを保存
        for topic in req.topics:
            doc_ref = db.collection("dab_hot_topics").document(topic.id)
            topic_dict = topic.dict()
            
            # 作成日時・更新日時の調整
            if not topic_dict.get("created_at"):
                topic_dict["created_at"] = datetime.now(timezone.utc)
            topic_dict["updated_at"] = datetime.now(timezone.utc)
            
            batch.set(doc_ref, topic_dict)
            
        batch.commit()
        return {"status": "success", "message": "Topics committed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/prompt/edit-ai", response_model=PromptEditResponse)
async def edit_prompt_ai(req: PromptEditRequest):
    """AIと対話し、要約プロンプトの修正案を生成する"""
    client = get_genai_client()
    if not client:
        raise HTTPException(status_code=500, detail="Gemini client is not initialized.")

    system_instruction = (
        "あなたはデータアーキテクチャコンサルタントの要約プロンプト設計を支援するAIアシスタントです。\n"
        "ユーザーからの「こういう要素を入れて要約してほしい」等の指示に基づいて、新しいプロンプトテンプレートを作成してください。\n"
        "必ず以下のJSON構造のみで応答してください。JSON以外の文章は一切出力しないでください。\n\n"
        "## 応答JSONスキーマ:\n"
        "{\n"
        "  \"assistant_message\": \"プロンプト修正意図や解説を記したユーザーへのメッセージ（日本語）\",\n"
        "  \"proposed_prompt\": \"修正後の新しいシステムプロンプトの全文\"\n"
        "}"
    )

    prompt = (
        f"【現在の要約プロンプト】:\n{req.current_prompt}\n\n"
        f"【ユーザーの要望】:\n{req.message}\n"
    )

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                temperature=0.3
            )
        )
        
        result = json.loads(response.text)
        return PromptEditResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to edit prompt: {str(e)}")

@router.post("/prompt/commit")
async def commit_prompt(req: PromptCommitRequest, db: firestore.Client = Depends(get_db)):
    """修正した要約プロンプトをFirestoreに確定保存する"""
    try:
        ref = db.collection("dab_user_memory").document("default_user")
        ref.update({
            "summary_prompt_template": req.prompt,
            "updated_at": datetime.now(timezone.utc)
        })
        return {"status": "success", "message": "Prompt template committed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/filter-prompt/edit-ai", response_model=FilterPromptEditResponse)
async def edit_filter_prompt_ai(req: FilterPromptEditRequest):
    """AIと対話し、ノイズフィルタ用プロンプトの修正案を生成する"""
    client = get_genai_client()
    if not client:
        raise HTTPException(status_code=500, detail="Gemini client is not initialized.")

    system_instruction = (
        "あなたはデータアーキテクチャコンサルタントのノイズフィルタリングルール設計を支援するAIアシスタントです。\n"
        "ユーザーからの「こういうトピックは除外して」「こういう記事は採用して」等の指示に基づいて、新しいフィルタプロンプトテンプレートを作成してください。\n"
        "必ず以下のJSON構造のみで応答してください。JSON以外の文章は一切出力しないでください。\n\n"
        "## 応答JSONスキーマ:\n"
        "{\n"
        "  \"assistant_message\": \"プロンプト修正意図や解説を記したユーザーへのメッセージ（日本語）\",\n"
        "  \"proposed_prompt\": \"修正後の新しいシステムプロンプトの全文\"\n"
        "}"
    )

    prompt = (
        f"【現在のフィルタプロンプト】:\n{req.current_prompt}\n\n"
        f"【ユーザーの要望】:\n{req.message}\n"
    )

    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                temperature=0.3
            )
        )
        
        result = json.loads(response.text)
        return FilterPromptEditResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to edit filter prompt: {str(e)}")

@router.post("/filter-prompt/commit")
async def commit_filter_prompt(req: FilterPromptCommitRequest, db: firestore.Client = Depends(get_db)):
    """修正したフィルタプロンプトをFirestoreに確定保存する"""
    try:
        ref = db.collection("dab_user_memory").document("default_user")
        ref.update({
            "filter_prompt_template": req.prompt,
            "updated_at": datetime.now(timezone.utc)
        })
        return {"status": "success", "message": "Filter prompt template committed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/feed", response_model=List[FeedItem])
async def get_feed(db: firestore.Client = Depends(get_db)):
    """蓄積された要約記事フィードを取得する"""
    try:
        docs = db.collection("dab_feeds").order_by("created_at", direction=firestore.Query.DESCENDING).limit(50).stream()
        feed_items = []
        for d in docs:
            data = d.to_dict()
            if data is not None:
                feed_items.append(FeedItem(**data))  # type: ignore
        return feed_items
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/feed/{feed_id}/evaluate")
async def evaluate_feed_item(
    feed_id: str, 
    req: EvaluationRequest, 
    background_tasks: BackgroundTasks, 
    db: firestore.Client = Depends(get_db)
):
    """記事フィードに対するユーザーの評価（既知/未知、興味あり/なし）を登録し、非同期で長期記憶を更新する"""
    try:
        feed_ref = db.collection("dab_feeds").document(feed_id)
        feed_doc = feed_ref.get()
        if not feed_doc.exists:
            raise HTTPException(status_code=404, detail="Feed item not found.")
            
        feed_data = feed_doc.to_dict()
        related_topics = feed_data.get("related_topics", [])
        
        # 評価データを保存
        eval_dict = req.dict()
        feed_ref.update({
            "read_status": "READ",
            "user_evaluations": eval_dict
        })
        
        # スキップされた場合は長期記憶のバックグラウンド更新を行わない
        if not req.skipped:
            # バックグラウンド処理として、非同期に長期記憶（既知概念・スコア等）を更新するタスクをスケジュール
            background_tasks.add_task(update_user_memory_async, db, related_topics, eval_dict)
        
        return {"status": "success", "message": "Evaluation saved and background memory update scheduled."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/feed/skip-all")
async def skip_all_feeds(req: SkipAllRequest, db: firestore.Client = Depends(get_db)):
    """指定されたすべての記事フィードを一括でスキップ（既読化）する"""
    try:
        batch = db.batch()
        for f_id in req.feed_ids:
            doc_ref = db.collection("dab_feeds").document(f_id)
            batch.update(doc_ref, {
                "read_status": "READ",
                "user_evaluations": {
                    "is_known": False,
                    "is_interested": False,
                    "grain_level": "BASIC",
                    "skipped": True
                }
            })
        batch.commit()
        return {"status": "success", "message": f"{len(req.feed_ids)} items skipped successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ingest")
async def trigger_ingestion(background_tasks: BackgroundTasks):
    """手動で情報収集インジェクションバッチをトリガーする"""
    try:
        background_tasks.add_task(run_ingestion_pipeline)
        return {"status": "success", "message": "DAB情報収集パイプラインをバックグラウンドで開始しました。"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Imagen 試験生成エンドポイント ---

class ImagenTestRequest(BaseModel):
    title: str
    summary: str

@router.post("/test-imagen")
async def test_imagen_generation(request: ImagenTestRequest):
    """
    Imagen 3 Fastで記事タイトル・サマリをもとにスライド風概念画像を1枚試験生成する。
    base64データURLで返すためGCS保存不要（評価専用）。
    料金目安: ≈$0.02/枚 (imagen-3.0-fast-generate-001)
    """
    import asyncio
    import base64
    import re as _re

    client = get_genai_client()
    if not client:
        raise HTTPException(status_code=503, detail="AIクライアントが初期化できませんでした")

    # Markdownを除去して記事の核心テーマを抽出
    clean_summary = request.summary.replace("\\n", "\n")
    clean_summary = _re.sub(r"[#*\[\]`>]", "", clean_summary).strip()

    # 「問い」と「結論」だけを抽出する試み（最初の250文字）
    short_context = clean_summary[:250]

    # データアーキテクチャ概念の視覚的プロンプト
    prompt = (
        "Create a beautiful, modern data architecture concept art image. "
        f"Theme: '{request.title[:70]}'. "
        f"Visual concept inspired by: {short_context[:180]}. "
        "Style requirements: "
        "Deep indigo-to-navy gradient background (#1e1b4b to #0c1a2e), "
        "glowing geometric data flow networks, hexagonal data nodes connected by light beams, "
        "abstract circuit patterns, subtle grid lines, "
        "professional data consulting aesthetic, "
        "cinematic lighting with teal and indigo accent glows. "
        "No text. No people. No photos. Pure abstract digital art only."
    )

    try:
        # Imagen APIは同期のためexecutorで非同期化
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.models.generate_images(
                model="imagen-3.0-fast-generate-001",
                prompt=prompt,
                config=types.GenerateImagesConfig(
                    number_of_images=1,
                    aspect_ratio="16:9",
                    safety_filter_level="BLOCK_MEDIUM_AND_ABOVE",
                    person_generation="DONT_ALLOW",
                )
            )
        )

        image_bytes = response.generated_images[0].image.image_bytes
        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        return {
            "success": True,
            "image_data": f"data:image/png;base64,{image_b64}",
            "model": "imagen-3.0-fast-generate-001",
            "estimated_cost_usd": 0.02
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Imagen生成エラー: {str(e)}")


# --- 有識者フォロー・詳細評価・探索 API エンドポイント ---

@router.get("/experts", response_model=List[Expert])
async def get_experts(db: firestore.Client = Depends(get_db)):
    """登録されている有識者の一覧を取得する（空の場合はデフォルトデータを自動シード）"""
    try:
        docs = list(db.collection("dab_experts").order_by("name").stream())
        
        # データが空の場合はデフォルトデータを投入
        if not docs:
            default_experts = [
                {
                    "id": "seattle_data_guy",
                    "name": "Ben Rogojan (The Seattle Data Guy)",
                    "topic_ids": ["data_engineering", "data_lakehouse"],
                    "accounts": {
                        "zenn": "",
                        "github": "seattle-data-guy",
                        "website": "https://www.theseattledataguy.com",
                        "x": "seattledataguy",
                        "qiita": "",
                        "note": ""
                    },
                    "avatar_url": ""
                },
                {
                    "id": "chip_huyen",
                    "name": "Chip Huyen (AI / MLOps Expert)",
                    "topic_ids": ["ai_architecture", "llm_agent"],
                    "accounts": {
                        "zenn": "",
                        "github": "chiphuyen",
                        "website": "https://chiphuyen.com",
                        "x": "chiphuyen",
                        "qiita": "",
                        "note": ""
                    },
                    "avatar_url": ""
                },
                {
                    "id": "yuzutas0",
                    "name": "yuzutas0 (Data Engineering Expert)",
                    "topic_ids": ["data_engineering", "data_lakehouse"],
                    "accounts": {
                        "zenn": "",
                        "github": "yuzutas0",
                        "website": "",
                        "x": "yuzutas0",
                        "qiita": "yuzutas0",
                        "note": "yuzutas0"
                    },
                    "avatar_url": ""
                },
                {
                    "id": "opendataspace",
                    "name": "OpenDataSpace (Official Update)",
                    "topic_ids": ["ai_architecture"],
                    "accounts": {
                        "zenn": "",
                        "github": "",
                        "website": "https://opendataspace.org",
                        "x": "",
                        "qiita": "",
                        "note": ""
                    },
                    "avatar_url": ""
                }
            ]
            batch = db.batch()
            for exp in default_experts:
                exp["created_at"] = datetime.now(timezone.utc)
                exp["updated_at"] = datetime.now(timezone.utc)
                doc_ref = db.collection("dab_experts").document(exp["id"])
                batch.set(doc_ref, exp)
            batch.commit()
            
            # 再度取得
            docs = db.collection("dab_experts").order_by("name").stream()
            
        experts = []
        for d in docs:
            data = d.to_dict()
            if not data:
                continue
            # タイムスタンプのパースエラー回避
            if "created_at" in data and not data["created_at"]:
                data["created_at"] = None
            if "updated_at" in data and not data["updated_at"]:
                data["updated_at"] = None
            experts.append(Expert(**data))  # type: ignore
        return experts
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/experts", response_model=Expert)
async def create_expert(expert: Expert, db: firestore.Client = Depends(get_db)):
    """新しい有識者を登録する"""
    try:
        doc_ref = db.collection("dab_experts").document(expert.id)
        expert_dict = expert.dict()
        expert_dict["created_at"] = datetime.now(timezone.utc)
        expert_dict["updated_at"] = datetime.now(timezone.utc)
        doc_ref.set(expert_dict)
        return Expert(**expert_dict)  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/experts/{expert_id}", response_model=Expert)
async def update_expert(expert_id: str, expert: Expert, db: firestore.Client = Depends(get_db)):
    """有識者の登録情報を更新する"""
    try:
        doc_ref = db.collection("dab_experts").document(expert_id)
        if not doc_ref.get().exists:
            raise HTTPException(status_code=404, detail="Expert not found.")
        expert_dict = expert.dict()
        expert_dict["id"] = expert_id
        expert_dict["updated_at"] = datetime.now(timezone.utc)
        
        # created_atを保持する
        existing_data = doc_ref.get().to_dict()
        expert_dict["created_at"] = (
            existing_data.get("created_at")
            if existing_data and isinstance(existing_data, dict)
            else datetime.now(timezone.utc)
        )
        
        doc_ref.set(expert_dict)
        return Expert(**expert_dict)  # type: ignore
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/experts/{expert_id}")
async def delete_expert(expert_id: str, db: firestore.Client = Depends(get_db)):
    """有識者の登録を解除する"""
    try:
        doc_ref = db.collection("dab_experts").document(expert_id)
        if not doc_ref.get().exists:
            raise HTTPException(status_code=404, detail="Expert not found.")
        doc_ref.delete()
        return {"status": "success", "message": f"Expert {expert_id} deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/experts/analytics")
async def get_experts_analytics(db: firestore.Client = Depends(get_db)):
    """登録されている有識者ごとの詳細評価平均値を集計して返す"""
    try:
        # すべての記事フィードを取得
        docs = db.collection("dab_feeds").stream()
        
        # expert_id ごとのスコアを初期化
        # { expert_id: { reliability: [], practicality: [], novelty: [], value: [] } }
        expert_scores = {}
        
        for d in docs:
            data = d.to_dict()
            expert_id = data.get("expert_id")
            if not expert_id:
                continue
            
            user_eval = data.get("user_evaluations")
            if not user_eval or not isinstance(user_eval, dict):
                continue
                
            detail_eval = user_eval.get("detail_eval")
            if not detail_eval or not isinstance(detail_eval, dict):
                continue
                
            if expert_id not in expert_scores:
                expert_scores[expert_id] = {
                    "reliability": [],
                    "practicality": [],
                    "novelty": [],
                    "value": []
                }
            
            for key in ["reliability", "practicality", "novelty", "value"]:
                val = detail_eval.get(key)
                if val is not None:
                    expert_scores[expert_id][key].append(int(val))
                    
        # 平均値を算出
        analytics = {}
        for exp_id, scores in expert_scores.items():
            analytics[exp_id] = {}
            for key, val_list in scores.items():
                if val_list:
                    analytics[exp_id][key] = round(sum(val_list) / len(val_list), 1)
                else:
                    analytics[exp_id][key] = 0.0
                    
        return analytics
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/experts/discovery")
async def discover_new_experts(db: firestore.Client = Depends(get_db)):
    """長期記憶や関心から、AIが新しい有識者を提案する"""
    client = get_genai_client()
    if not client:
        raise HTTPException(status_code=500, detail="Gemini client is not initialized.")
        
    try:
        # 現在のアクティブトピックと、ユーザーの長期記憶を取得
        topics_docs = db.collection("dab_hot_topics").where("status", "==", "ACTIVE").get()
        active_topics = []
        for doc in topics_docs:
            d_data = doc.to_dict()
            if d_data and "name" in d_data:
                active_topics.append(d_data["name"])
        
        memory_doc = db.collection("dab_user_memory").document("default_user").get()
        memory_data = memory_doc.to_dict() if memory_doc.exists else None
        if not memory_data or not isinstance(memory_data, dict):
            memory_data = {}
        known_concepts = memory_data.get("known_concepts", [])
        learning_goals = memory_data.get("learning_goals", "")
        
        # 既存の有識者名を取得して重複提案を避ける
        existing_experts_docs = db.collection("dab_experts").stream()
        existing_names = []
        for d in existing_experts_docs:
            d_data = d.to_dict()
            if d_data and "name" in d_data:
                existing_names.append(d_data["name"])
        
        system_instruction = (
            "あなたはデータアーキテクチャ・AIレディデータ分野の専門家発信者を発見するスカウトエージェントです。\n"
            "ユーザーの関心（アクティブトピック、既知概念、学習目標）に合致する、実務的で上質な情報を発信している有識者をWeb（Zenn, Medium, DEV.to, Substack等）から検索・推薦してください。\n"
            "必ず以下のJSON形式（配列のみ）で応答してください。それ以外の文字は一切含めないでください。\n"
            "既存の有識者リストに含まれる人物は提案しないでください。\n\n"
            "## 応答JSONスキーマ:\n"
            "[\n"
            "  {\n"
            "    \"id\": \"ユニークな英数字のID (例: SeattleDataGuy, kazushi)\",\n"
            "    \"name\": \"有識者の名前\",\n"
            "    \"avatar_url\": \"アバター画像URL（無ければ空文字）\",\n"
            "    \"reason\": \"この有識者を推薦する理由（日本語2行程度。ユーザーの学習目標にどう合致するか）\",\n"
            "    \"accounts\": {\n"
            "      \"zenn\": \"ZennのユーザーID（あれば。無ければ空文字）\",\n"
            "      \"github\": \"GitHubのユーザーIDまたはリポジトリURL（あれば。無ければ空文字）\",\n"
            "      \"website\": \"公式ブログやSubstackのURL（あれば。無ければ空文字）\",\n"
            "      \"x\": \"X（旧Twitter）のアカウント名（あれば。無ければ空文字）\"\n"
            "    },\n"
            "    \"topic_suggestions\": [\"紐づくと思われる関心トピック名（例：AIレディデータ、ガバナンス等）\"]\n"
            "  }\n"
            "]"
        )
        
        prompt = (
            f"【アクティブトピック】: {', '.join(active_topics)}\n"
            f"【既知概念リスト】: {', '.join(known_concepts)}\n"
            f"【現在の学習目標】: {learning_goals}\n"
            f"【既存の有識者名（これらは提案から除外）】: {', '.join(existing_names)}\n\n"
            "指示: 上記の条件に合う「AIレディデータ」「モダンデータスタック」「データエンジニアリング」に関する良質な発信を行っている、実在する専門家を3名探し、JSON形式で提案してください。"
        )
        
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=0.4
            )
        )
        
        text = response.text or ""
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
            
        suggested_experts = json.loads(text.strip())
        return suggested_experts
    except Exception as e:
        print(f"Error in discovery API: {e}")
        return [
            {
                "id": "benn_stancil",
                "name": "Benn Stancil",
                "avatar_url": "",
                "reason": "データ分析およびModern Data Stackの意思決定プロセスに関する深い考察を提供しています。ビジネスと技術の橋渡しとして非常に参考になります。",
                "accounts": {
                    "zenn": "",
                    "github": "",
                    "website": "https://benn.substack.com",
                    "x": "bennstancil"
                },
                "topic_suggestions": ["データマネジメント", "モダンデータスタック"]
            },
            {
                "id": "seattle_data_guy",
                "name": "Ben Rogojan (The Seattle Data Guy)",
                "avatar_url": "",
                "reason": "データエンジニアリングの基礎からAIレディデータ構築に関する実用的な解説、YouTube動画やSubstackでの情報発信が非常に活発です。",
                "accounts": {
                    "zenn": "",
                    "github": "seattle-data-guy",
                    "website": "https://www.theseattledataguy.com",
                    "x": "seattledataguy"
                },
                "topic_suggestions": ["データパイプライン", "データガバナンス"]
            }
        ]
