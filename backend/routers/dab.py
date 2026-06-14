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

class EvaluationRequest(BaseModel):
    is_known: bool       # 知っていたか (True/False)
    is_interested: bool  # 興味があるか (True/False)
    grain_level: str     # 知りたい粒度 ("BASIC", "PRACTICAL", "ARCHITECTURAL")

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
            topics.append(Topic(**data))
        return topics
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/memory", response_model=UserMemory)
async def get_user_memory(db: firestore.Client = Depends(get_db)):
    """長期記憶・ユーザープロファイル情報を取得する"""
    try:
        doc = db.collection("dab_user_memory").document("default_user").get()
        if doc.exists:
            return UserMemory(**doc.to_dict())
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
            feed_items.append(FeedItem(**data))
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
        
        # バックグラウンド処理として、非同期に長期記憶（既知概念・スコア等）を更新するタスクをスケジュール
        background_tasks.add_task(update_user_memory_async, db, related_topics, eval_dict)
        
        return {"status": "success", "message": "Evaluation saved and background memory update scheduled."}
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
