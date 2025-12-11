from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta
from google.cloud import firestore, storage
from database import get_db
import os
import shutil
import uuid
from pathlib import Path
from google import genai
from google.genai import types

# Try importing moviepy, handle if missing (though it should be in docker)
try:
    from moviepy import VideoFileClip
except ImportError:
    VideoFileClip = None

router = APIRouter(
    prefix="/english",
    tags=["english"],
)

# --- Configuration ---
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_ENGLISH_REVIEW")

# Initialize GenAI Client (similar to generate_genai.py)
api_key = os.getenv("GOOGLE_CLOUD_API_KEY")
if api_key:
    api_key = api_key.strip()

client = genai.Client(
    vertexai=True,
    api_key=api_key,
    http_options={'api_version': 'v1beta1'}
)

storage_client = storage.Client()

# --- Models ---

class PreparationRequest(BaseModel):
    topic: str

class PreparationTask(BaseModel):
    id: str
    topic: str
    content: str
    created_at: datetime
    status: str = "TODO" # TODO, DONE

class ReviewCreateRequest(BaseModel):
    video_filename: str
    gcs_path: str # gs://bucket/path

class ReviewTask(BaseModel):
    id: str
    video_filename: str
    content: str
    created_at: datetime
    status: str = "TODO"

# --- Helpers ---



# --- Endpoints ---

@router.post("/preparation", response_model=PreparationTask)
def create_preparation(req: PreparationRequest, db: firestore.Client = Depends(get_db)):
    print(f"DEBUG: Received preparation request for topic: {req.topic}")
    # 1. Generate Content with Gemini

    prompt = f"""
    あなたはTOEIC900点以上を持ち、英語圏に2年在住経験のある上級英語学習者のためのプロの英語教師です。
    生徒は「{req.topic}」というトピックでのディスカッションやレッスンに向けて予習をしたいと考えています。

    以下の情報を整理した予習ガイドをMarkdown形式（日本語）で作成してください。
    **冒頭の挨拶や前置き（例：「～向けの記事を作成しました」等）は一切不要です。コンテンツのみを出力してください。**
    **可読性を高めるため、各セクションや項目の間には必ず空行を入れてください。**

    ## 構成案
    1. **高度な語彙・イディオム (Advanced Vocabulary & Idioms)**
       - 単語: 発音記号 [IPA] 意味
       - 例文: *斜体で記載*
       - 解説: ニュアンスや使い分け。

    2. **重要フレーズ・コロケーション (Key Phrases & Collocations)**
       - カタい表現からカジュアルなものまで、ネイティブらしい組み合わせ。

    3. **会話シナリオ (Conversation Scenario)**
       > **重要:** 会話文全体を必ず引用記法（>）で囲ってください。
       > 例:
       > > A: Hello
       > > B: Hi there
       - 議論のポイントや予期せぬ質問を含む現実的な対話。

    4. **ディスカッションポイント (Discussion Points)**
       - 深く考えるべき質問事項（3〜5つ）。

    解説は日本語で行い、内容は実践的で発展的なものにしてください。
    """
    
    try:
        response = client.models.generate_content(
            model="gemini-3-pro-preview",
            contents=prompt,
        )
        content = response.text
    except Exception as e:
        print(f"Gemini Error: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini Generation Failed: {str(e)}")

    # 2. Save to Firestore
    doc_ref = db.collection("english_preparation").document()
    task = PreparationTask(
        id=doc_ref.id,
        topic=req.topic,
        content=content,
        created_at=datetime.now()
    )
    doc_ref.set(task.dict())
    
    return task

@router.get("/preparation", response_model=List[PreparationTask])
def get_preparation_list(db: firestore.Client = Depends(get_db)):
    docs = db.collection("english_preparation").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    return [PreparationTask(**d.to_dict()) for d in docs]

@router.patch("/preparation/{task_id}/status")
def update_preparation_status(task_id: str, status: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("english_preparation").document(task_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    doc_ref.update({"status": status})
    return {"status": "updated"}

@router.delete("/preparation/{task_id}")
def delete_preparation(task_id: str, db: firestore.Client = Depends(get_db)):
    db.collection("english_preparation").document(task_id).delete()
    return {"status": "deleted"}


@router.get("/upload-url")
def get_upload_url(filename: str, content_type: Optional[str] = "video/mp4"):
    """
    Generates a PUT Signed URL for uploading directly to GCS.
    """
    if not GCS_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME not configured")
    
    try:
        bucket = storage_client.bucket(GCS_BUCKET_NAME)
        unique_name = f"english_uploads/{uuid.uuid4()}_{filename}"
        blob = bucket.blob(unique_name)
        
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=15),
            method="PUT",
            content_type=content_type,
        )
        
        return {
            "upload_url": url,
            "gcs_path": f"gs://{GCS_BUCKET_NAME}/{unique_name}",
            "expires_in": 900
        }
    except Exception as e:
        print(f"Signed URL Error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate upload URL: {str(e)}")


@router.post("/review", response_model=ReviewTask)
def create_review(req: ReviewCreateRequest, db: firestore.Client = Depends(get_db)):
    if not GCS_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME not configured")

    # 1. Download Video from GCS to local temp for processing
    # (Since we need to extract audio)
    
    # Parse gs://bucket/path
    # Expected format: gs://{BUCKET_NAME}/english_uploads/...
    if not req.gcs_path.startswith("gs://"):
        raise HTTPException(status_code=400, detail="Invalid GCS path")
    
    path_parts = req.gcs_path.replace("gs://", "").split("/", 1)
    if len(path_parts) != 2:
        raise HTTPException(status_code=400, detail="Invalid GCS path format")
        
    bucket_name = path_parts[0]
    blob_name = path_parts[1]
    
    if bucket_name != GCS_BUCKET_NAME:
         raise HTTPException(status_code=400, detail="Bucket mismatch")

    # Direct GCS URI usage
    print(f"DEBUG: Using GCS URI for Gemini: {req.gcs_path}")
    
    try:
        # Construct Part object directly from GCS URI
        # Assuming video/mp4 as default, but ideally we should pass mime_type if possible or detect it.
        # req.video_filename might help, or we can just assume video/mp4 or video/*
        mime_type = "video/mp4"
        if req.video_filename.lower().endswith(".mov"):
             mime_type = "video/quicktime"
        elif req.video_filename.lower().endswith(".webm"):
             mime_type = "video/webm"
        
        part = types.Part.from_uri(file_uri=req.gcs_path, mime_type=mime_type)


        prompt = """
        この音声は、ある英語学習者（TOEIC900点程度、海外在住経験あり）がオンライン英会話レッスンを受けている際の録音データです。
        あなたは熟練した英語教師として、この生徒の英語力をさらに向上させるための詳細なフィードバックレポートを作成してください。

        **制約事項:**
        1. 出力は**日本語のMarkdown形式**で行ってください。
        2. **冒頭の挨拶や前置き（例：「分析結果は以下の通りです」等）は一切含めないでください。**
        3. 各セクションの区切りには必ず空行を入れ、可読性を高くしてください。

        ## レポート構成

        1. **要改善点と修正案 (Corrections & Refinements)**
           - 生徒の発言の中で、文法ミス、不自然なコロケーション、または発音の不明瞭な箇所を具体的に指摘してください。
           - それぞれに対して、より自然で洗練された言い換え（Better Version）を提示してください。

        2. **推奨ボキャブラリー・表現 (Recommended Vocabulary & Expressions)**
           - この会話の文脈で使える、より高度な語彙やネイティブらしい表現（イディオム等）を3〜5つ紹介してください。

        3. **ロールプレイ最適化案 (Roleplay Optimization)**
           - 会話の特定の部分を取り上げ、「こう返せばもっと話が弾んだ」「より論理的に意見を主張できた」という理想的な会話スクリプト（数往復）を提示してください。

        4. **総評 (Overall Feedback)**
           - 文法、流暢さ、発音、対話力の観点から簡潔なアドバイスをお願いします。

        解説はすべて日本語で行い、学習者が納得感を持てるよう論理的かつ具体的な内容にしてください。
        """
        
        print(f"DEBUG: STARTING GEMINI GENERATION")
        response = client.models.generate_content(
            model="gemini-3-pro-preview",
            contents=[prompt, part]
        )
        print(f"DEBUG: GEMINI GENERATION COMPLETE")
        content = response.text

    except Exception as e:
        print(f"Review Processing Error: {e}")
        raise HTTPException(status_code=500, detail=f"Processing Failed: {str(e)}")
    # No finally block needed as no local files are created
    
    # 4. Save to Firestore
    doc_ref = db.collection("english_review").document()
    task = ReviewTask(
        id=doc_ref.id,
        video_filename=req.video_filename,
        content=content,
        created_at=datetime.now()
    )
    doc_ref.set(task.dict())
    
    return task

@router.get("/review", response_model=List[ReviewTask])
def get_review_list(db: firestore.Client = Depends(get_db)):
    docs = db.collection("english_review").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    return [ReviewTask(**d.to_dict()) for d in docs]

@router.delete("/review/{task_id}")
def delete_review(task_id: str, db: firestore.Client = Depends(get_db)):
    db.collection("english_review").document(task_id).delete()
    return {"status": "deleted"}

@router.patch("/review/{task_id}/status")
def update_review_status(task_id: str, status: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("english_review").document(task_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    doc_ref.update({"status": status})
    return {"status": "updated"}
