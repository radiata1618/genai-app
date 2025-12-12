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

try:
    from moviepy import VideoFileClip
except ImportError:
    VideoFileClip = None

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:
    YouTubeTranscriptApi = None

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

class YouTubePrepRequest(BaseModel):
    url: str

class YouTubePrepTask(BaseModel):
    id: str
    video_id: str
    video_url: str
    topic: str
    content: str
    script: Optional[str] = None
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

    以下は以下の情報を整理した予習ガイドをMarkdown形式（日本語）で作成してください。
    **冒頭の挨拶や前置きは不要です。コンテンツのみを出力してください。**
    **可読性を高めるため、各セクションや項目の間には必ず空行を入れてください。**

    ## 構成案
    1. **高度な語彙・イディオム (Advanced Vocabulary & Idioms)**
       - **Word**: 発音記号 [IPA] 意味
       - 例文: *斜体で記載*
       - 解説: ニュアンスや使い分け。
       > **Note:** 太字（`**`）はこのセクションの単語（Word）部分のみに使用してください。

    2. **重要フレーズ・コロケーション (Key Phrases & Collocations)**
       - カタい表現からカジュアルなものまで、ネイティブらしい組み合わせ。
       - カタい表現からカジュアルなものまで、ネイティブらしい組み合わせ。
       - **注意:** 各フレーズ（コロケーション）は必ず太字（`**`）で囲ってください。解説や例文には太字を使わないでください。

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
            model="gemini-2.5-pro",
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


@router.post("/youtube-prep", response_model=YouTubePrepTask)
def create_youtube_prep(req: YouTubePrepRequest, db: firestore.Client = Depends(get_db)):
    if YouTubeTranscriptApi is None:
        raise HTTPException(status_code=500, detail="youtube_transcript_api not installed")

    # 1. Extract Video ID
    # Support various formats: youtube.com/watch?v=ID, youtu.be/ID
    import re
    video_id_match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", req.url)
    if not video_id_match:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL")
    video_id = video_id_match.group(1)

    # 2. Fetch Transcript
    try:
        # Prefer English, then Japanese, then auto properties
        ytt = YouTubeTranscriptApi()
        transcript_list = ytt.fetch(video_id, languages=['en', 'ja'])
        full_text = " ".join([t.text for t in transcript_list])
    except Exception as e:
        print(f"Transcript Error: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to fetch transcript: {str(e)}")

    # 3. Generate Content with Gemini
    prompt = f"""
    あなたは既にTOEIC900点以上を取得し、ネイティブレベルの英語力を目指している学習者のためのプロの英語教師です。
    以下はYouTube動画の字幕テキストです。この動画を視聴して学習するための、妥協のない高度な予習資料を作成してください。

    **字幕テキスト:**
    {full_text[:20000]} 
    (テキストが長すぎる場合は切り詰められています)

    **出力形式:**
    Markdown形式（日本語）で出力してください。
    **冒頭の挨拶や前置きは不要です。**
    **最初の行に、この動画の内容を表す適切なタイトル（日本語）を `# タイトル` の形式で書いてください。**

    ## 構成案
    1. **概要 (Summary)**
       - 動画の内容を3行程度で要約。

    2. **発展的語彙・専門用語 (Advanced & Niche Vocabulary)**
       - 動画内で使われている、TOEIC等の試験範囲を超えた難解な単語、専門用語、文学的な表現などを**可能な限りすべて（少なくとも20個以上）**列挙してください。
       - 既知の単語でも、文脈が特殊な場合や、第二義・第三義で使われているものも含めてください。
       - **Word**: 意味 - 動画内での文脈、語源、または類義語とのニュアンスの違いなども含めた深い解説

    3. **高度なフレーズ・慣用句 (Sophisticated Phrases & Idioms)**
       - ネイティブが使うこなれた言い回し、スラング、教養ある表現などを**徹底的に（10個以上）**ピックアップしてください。
       - **Phrase**: 意味 - 解説（どのようなシチュエーションで使われるか等）

    4. **リスニング、理解のポイント (Listening Points)**
       - 特に聞き取るべき箇所や、話の展開のポイント。難易度が高い箇所があれば解説。


    """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-pro",
            contents=prompt,
        )
        content = response.text
        
        # Extract title from the first line if present
        lines = content.strip().split('\n')
        topic = "YouTube Video Study" # Default
        if lines and lines[0].startswith('# '):
            topic = lines[0].replace('# ', '').strip()
            # Remove the title line from content to avoid duplication if desired, 
            # but keeping it is fine too. Let's keep it for MD rendering.
        
    except Exception as e:
        print(f"Gemini Error: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini Generation Failed: {str(e)}")

    # 4. Save to Firestore
    doc_ref = db.collection("english_youtube_prep").document()
    task = YouTubePrepTask(
        id=doc_ref.id,
        video_id=video_id,
        video_url=req.url,
        topic=topic,
        content=content,
        script=full_text,
        created_at=datetime.now()
    )
    doc_ref.set(task.dict())
    
    return task

@router.get("/youtube-prep", response_model=List[YouTubePrepTask])
def get_youtube_prep_list(db: firestore.Client = Depends(get_db)):
    docs = db.collection("english_youtube_prep").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    return [YouTubePrepTask(**d.to_dict()) for d in docs]

@router.delete("/youtube-prep/{task_id}")
def delete_youtube_prep(task_id: str, db: firestore.Client = Depends(get_db)):
    db.collection("english_youtube_prep").document(task_id).delete()
    return {"status": "deleted"}

@router.patch("/youtube-prep/{task_id}/status")
def update_youtube_prep_status(task_id: str, status: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("english_youtube_prep").document(task_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    doc_ref.update({"status": status})
    return {"status": "updated"}


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
        2. **冒頭の挨拶や前置きは一切含めないでください。**
        3. 各セクションの区切りには必ず空行を入れ、可読性を高くしてください。
        4. **重要:** 太字（`**`）の使用は、セクション2の「推奨ボキャブラリー」の単語名のみに厳密に制限してください。他の箇所で強調したい場合は、*斜体* または `コードブロック` を使用してください。

        ## レポート構成

        1. **要改善点と修正案 (Corrections & Refinements)**
           - 生徒の発言の中で、文法ミス、不自然なコロケーション、または発音の不明瞭な箇所を具体的に指摘してください。
           - 「Student:」「Correction:」などのラベルには太字を使わないでください（例: `Student:` や `*Student:*`）。
           - 修正箇所の強調には `コードブロック` を推奨します（例: I went `to` school）。
           - それぞれに対して、より自然で洗練された言い換え（Better Version）を提示してください。

        2. **推奨ボキャブラリー・表現 (Recommended Vocabulary & Expressions)**
           - この会話の文脈で使える、より高度な語彙やネイティブらしい表現（イディオム等）を3〜5つ紹介してください。
           - **形式:** `- **Expression**: 意味 - 解説`
           - ここでのみ、見出し語（Expression）を太字（`**`）にします。

        3. **ロールプレイ最適化案 (Roleplay Optimization)**
           - 会話の特定の部分を取り上げ、「こう返せばもっと話が弾んだ」「より論理的に意見を主張できた」という理想的な会話スクリプト（数往復）を提示してください。
           - **重要:** 会話スクリプトは必ず引用記法（>）で囲ってください。

        4. **総評 (Overall Feedback)**
           - 文法、流暢さ、発音、対話力の観点から簡潔なアドバイスをお願いします。

        解説はすべて日本語で行い、学習者が納得感を持てるよう論理的かつ具体的な内容にしてください。
        """
        
        print(f"DEBUG: STARTING GEMINI GENERATION")
        
        # Retry logic for 429 RESOURCE_EXHAUSTED
        import time
        max_retries = 3
        retry_delay = 5 # seconds
        
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model="gemini-2.5-pro",
                    contents=[prompt, part]
                )
                content = response.text
                print(f"DEBUG: GEMINI GENERATION COMPLETE")
                break # Success, exit loop
            except Exception as e:
                error_str = str(e)
                if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                    print(f"WARNING: Rate limit hit (Attempt {attempt + 1}/{max_retries}). Retrying in {retry_delay}s...")
                    if attempt == max_retries - 1:
                        raise e # Re-raise if last attempt
                    time.sleep(retry_delay)
                    retry_delay *= 2 # Exponential backoff
                else:
                    raise e # Re-raise other errors immediately

    except Exception as e:
        print(f"Review Processing Error: {e}")
        error_detail = str(e)
        if "429" in error_detail or "RESOURCE_EXHAUSTED" in error_detail:
             error_detail = "AI Service Busy (Rate Limit). Please try again in a few minutes."
        raise HTTPException(status_code=500, detail=f"Processing Failed: {error_detail}")
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
