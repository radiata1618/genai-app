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
import google.auth
from google.oauth2 import service_account
import json

try:
    from moviepy import VideoFileClip
except ImportError:
    VideoFileClip = None

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.proxies import GenericProxyConfig
except ImportError:
    YouTubeTranscriptApi = None
    GenericProxyConfig = None

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
    status: int = 0 # 0: Unlearned, 1: Learned Once, 2: Mastered

class ReviewCreateRequest(BaseModel):
    video_filename: str
    gcs_path: str # gs://bucket/path

class ReviewTask(BaseModel):
    id: str
    video_filename: str
    content: str
    script: Optional[str] = None
    created_at: datetime
    status: int = 0


class YouTubePrepRequest(BaseModel):
    url: str

class YouTubePrepTask(BaseModel):
    id: str
    video_id: str
    video_url: str
    topic: str
    content: str
    script: Optional[str] = None
    script_formatted: Optional[str] = None
    script_augmented: Optional[str] = None
    created_at: datetime
    status: int = 0
# --- Models ---

class PhraseGenerateRequest(BaseModel):
    japanese: str

class PhraseSuggestion(BaseModel):
    japanese: str
    english: str
    type: str # variation, recommendation
    explanation: str

class PhraseGenerateResponse(BaseModel):
    suggestions: List[PhraseSuggestion]

class PhraseCreateRequest(BaseModel):
    japanese: str
    english: str
    note: Optional[str] = None

class Phrase(BaseModel):
    id: str
    japanese: str
    english: str
    note: Optional[str] = None
    is_memorized: bool = False
    status: int = 0
    created_at: datetime
    
class ChatMessage(BaseModel):
    role: str # "user" or "model"
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    context: Optional[str] = None

    
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
    tasks = []
    for d in docs:
        data = d.to_dict()
        # Migration: "TODO" -> 0, "DONE" -> 2
        if isinstance(data.get("status"), str):
             if data["status"] == "DONE":
                 data["status"] = 2
             else:
                 data["status"] = 0
        tasks.append(PreparationTask(**data))
    return tasks

@router.patch("/preparation/{task_id}/status")
def update_preparation_status(task_id: str, status: int, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("english_preparation").document(task_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    doc_ref.update({"status": status})
    return {"status": "updated", "new_status": status}


@router.delete("/preparation/{task_id}")
def delete_preparation(task_id: str, db: firestore.Client = Depends(get_db)):
    db.collection("english_preparation").document(task_id).delete()
    return {"status": "deleted"}


@router.post("/youtube-prep", response_model=YouTubePrepTask)
async def create_youtube_prep(req: YouTubePrepRequest, db: firestore.Client = Depends(get_db)):
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
        # Support proxy if configured via environment variable
        
        proxy_url = os.getenv("YOUTUBE_PROXY")
        proxy_config = None
        if proxy_url:
            # Handle raw format: host:port:user:pass (Smartproxy copy usage)
            if "://" not in proxy_url and proxy_url.count(":") >= 3:
                try:
                    parts = proxy_url.split(":")
                    if len(parts) >= 4:
                        # host:port:user:pass
                        p_host = parts[0]
                        p_port = parts[1]
                        p_user = parts[2]
                        p_pass = ":".join(parts[3:]) # Handle potential colons in password
                        
                        import urllib.parse
                        p_user = urllib.parse.quote(p_user)
                        p_pass = urllib.parse.quote(p_pass)
                        
                        proxy_url = f"http://{p_user}:{p_pass}@{p_host}:{p_port}"
                        print(f"DEBUG: Auto-formatted raw proxy to: {proxy_url}")
                except Exception as e:
                    print(f"WARNING: Failed to parse raw proxy string: {e}")

            print(f"DEBUG: Using YouTube Proxy: {proxy_url}")
            if GenericProxyConfig:
                proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)
            else:
                print("WARNING: GenericProxyConfig not available despite youtube_transcript_api being present.")
        else:
             print("DEBUG: No YouTube Proxy configured, connecting directly.")

        # Instantiate API with proxy config if present
        ytt = YouTubeTranscriptApi(proxy_config=proxy_config)
        transcript_list = ytt.fetch(video_id, languages=['en', 'ja'])
        
        # Combine text
        full_text = " ".join([t.text for t in transcript_list])
    except Exception as e:
        print(f"Transcript Error: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to fetch transcript: {str(e)}")

    # 3. Generate Content with Gemini (Parallel Execution)
    import asyncio

    # Prompt for Notes (Main Content)
    # Improved to avoid excessive bolding and ensure proper structure
    prompt_notes = f"""
    あなたはTOEIC900点以上を取得し、ネイティブレベルの英語力を目指している学習者のためのプロの英語教師です。
    以下はYouTube動画の字幕テキストです。この動画を視聴して学習するための、妥協のない高度な予習資料を作成してください。

    **字幕テキスト:**
    {full_text[:20000]} 
    (テキストが長すぎる場合は切り詰められています)

    **出力形式:**
    Markdown形式（日本語）で出力してください。
    **冒頭の挨拶や前置きは不要です。**
    **最初の行に、この動画の内容を表す適切なタイトル（日本語）を `# タイトル` の形式で書いてください。**
    **重要: タイトルの直後は必ず改行し、各セクションの間にも必ず空行を入れてください。**

    ## 構成案
    1. **概要 (Summary)**
       - 動画の内容を3行程度で要約。

    2. **発展的語彙・専門用語 (Advanced & Niche Vocabulary)**
       - 動画内で使われている、TOEIC等の試験範囲を超えた難解な単語、専門用語、文学的な表現などを**可能な限りすべて（少なくとも20個以上）**リストアップしてください。
       - **形式**:
         - **Word**: 意味 - 解説
         - **Word**: 意味 - 解説
       - **注意:** 見出し語（Word）のみを太字 `**Word**` にしてください。説明文全体を太字にしないように注意してください。

    3. **高度なフレーズ・慣用句 (Sophisticated Phrases & Idioms)**
       - ネイティブが使うこなれた言い回し、スラング、教養ある表現などを**徹底的に（10個以上）**ピックアップしてください。
       - **形式**:
         - **Phrase**: 意味 - 解説
         - **Phrase**: 意味 - 解説
       - **注意:** 見出し語（Phrase）のみを太字 `**Phrase**` にしてください。

    4. **リスニング、理解のポイント (Listening Points)**
       - 特に聞き取るべき箇所や、話の展開のポイント。難易度が高い箇所があれば解説。
    """

    # Prompt for Script Formatting
    prompt_format_script = f"""
    以下のYouTube動画の字幕テキスト（Transcript）を、読みやすい英語のスクリプトに整形してください。

    **処理内容:**
    1. 意味のまとまりごとに改行を入れて段落（Paragraph）に分けてください。
    2. 話題が変わるタイミングなどで、適切な見出し（Heading 2: ## 見出し名 [英語]）を挿入してください。
    3. `>>` やタイムスタンプなどの不要なメタデータはすべて削除してください。
    4. テキストの内容（単語など）は絶対に変更しないでください。

    **Input Script:**
    {full_text[:25000]}

    **Output:**
    - 整形されたMarkdownテキストのみを出力してください。
    - 冒頭の挨拶などは不要です。
    """

    async def generate_notes():
        try:
            # Reverting to 3.0 Pro for better formatting quality (fixing bolding issue)
            response = await client.aio.models.generate_content(
                model="gemini-3-flash-preview",
                contents=prompt_notes,
            )
            return response.text
        except Exception as e:
            print(f"Notes Generation Error: {e}")
            raise e

    async def generate_scripts():
        try:
            # 1. Format Script
            response_format = await client.aio.models.generate_content(
                model="gemini-3-flash-preview",
                contents=prompt_format_script,
            )
            formatted_text = response_format.text

            # 2. Augment Script (Vocabulary Analysis)
            # Improved prompt for broader coverage and detailed explanations
            prompt_augment_script = f"""
            以下の英語スクリプト（整形済み）を読み、英語学習者のために語彙の補足を追加してください。

            **処理内容:**
            1. 以下の基準に該当する語彙・表現を**幅広く**特定してください（単なる難単語だけでなく、文脈理解に必要なものを含む）。
               - 英検准1級〜1級、TOEIC 800点以上のレベルの単語
               - ニュース特有の表現、固有名詞（人名、地名、イベント名などで背景知識が必要なもの）
               - カジュアルな口語表現、比喩、イディオム
               - 文脈によって特殊な意味を持つ語
               - 具体例: "MAMMOGRAMS", "ROSE PARADE", "LEGACY CELEBRATED" など

            2. 特定した語・表現を **太字** (`**word**`) に変更してください。

            3. 太字にした語の直後に、カッコ書き `(意味: 解説)` で補足を追加してください。
               - 単なる日本語訳だけでなく、**なぜその言葉が使われているか、背景知識、ニュアンス**などを含めて少し詳しく解説してください。
               - 形式: `**word** (意味: 解説)`

            4. 元のテキストの段落構成や見出しは維持してください。
            5. 元の英文自体は変更しないでください（挿入のみ）。

            **Formatted Script:**
            {formatted_text}

            **Output:**
            - 補足追加済みのMarkdownテキストのみを出力してください。
            - 冒頭の挨拶などは不要です。
            """

            response_augment = await client.aio.models.generate_content(
                model="gemini-3-flash-preview",
                contents=prompt_augment_script,
            )
            augmented_text = response_augment.text
            
            return formatted_text, augmented_text
        except Exception as e:
            print(f"Script Generation Error: {e}")
            raise e

    try:
        # Execute in parallel
        notes_content, (script_formatted, script_augmented) = await asyncio.gather(
            generate_notes(),
            generate_scripts()
        )
        
        content = notes_content
        
        # Extract title from the first line if present
        topic = "YouTube Video Study" # Default
        lines = content.strip().splitlines()
        if lines:
            first_line = lines[0].strip()
            if first_line.startswith('# '):
                candidate_topic = first_line.replace('# ', '').strip()
                # Safety check: If "topic" is too long, it's likely the whole text. 
                # Titles shouldn't be excessively long.
                if len(candidate_topic) < 100:
                    topic = candidate_topic
                    # Optional: Remove title from content to avoid duplication, or keep it.
                    # Keeping it is fine as it acts as a header.
                else:
                    print("Extracted topic too long, ignoring:", candidate_topic[:50])
                    topic = "Video Analysis"

    except Exception as e:
        print(f"Gemini Error (Parallel): {e}")
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
        script_formatted=script_formatted,
        # script_augmented=script_augmented, # Fix: variable usage
        script_augmented=script_augmented,
        created_at=datetime.now()
    )
    doc_ref.set(task.dict())
    
    return task

@router.get("/youtube-prep", response_model=List[YouTubePrepTask])
def get_youtube_prep_list(db: firestore.Client = Depends(get_db)):
    docs = db.collection("english_youtube_prep").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    tasks = []
    for d in docs:
        data = d.to_dict()
        if isinstance(data.get("status"), str):
             if data["status"] == "DONE":
                 data["status"] = 2
             else:
                 data["status"] = 0
        tasks.append(YouTubePrepTask(**data))
    return tasks

@router.delete("/youtube-prep/{task_id}")
def delete_youtube_prep(task_id: str, db: firestore.Client = Depends(get_db)):
    db.collection("english_youtube_prep").document(task_id).delete()
    return {"status": "deleted"}

@router.patch("/youtube-prep/{task_id}/status")
def update_youtube_prep_status(task_id: str, status: int, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("english_youtube_prep").document(task_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    doc_ref.update({"status": status})
    return {"status": "updated", "new_status": status}


@router.get("/upload-url")
def get_upload_url(filename: str, content_type: Optional[str] = "video/mp4"):
    """
    Generates a PUT Signed URL for uploading directly to GCS.
    """
    if not GCS_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME not configured")
    
    try:
        # Check for service account key in env (injected from Secret Manager)
        service_account_info_str = os.getenv("SERVICE_ACCOUNT_KEY")
        if service_account_info_str:
            try:
                print("DEBUG: using SERVICE_ACCOUNT_KEY from env")
                # Handle potential quoting issues if raw json was stringified weirdly
                if service_account_info_str.startswith("'") and service_account_info_str.endswith("'"):
                     service_account_info_str = service_account_info_str[1:-1]
                
                info = json.loads(service_account_info_str)
                creds = service_account.Credentials.from_service_account_info(info)
                # Create a specific client with these creds
                current_storage_client = storage.Client(credentials=creds)
                bucket = current_storage_client.bucket(GCS_BUCKET_NAME)
            except Exception as json_e:
                print(f"Warning: Failed to parse SERVICE_ACCOUNT_KEY: {json_e}")
                # Fallback to default
                bucket = storage_client.bucket(GCS_BUCKET_NAME)
        else:
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
async def create_review(req: ReviewCreateRequest, db: firestore.Client = Depends(get_db)):
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
        elif req.video_filename.lower().endswith(".mp3"):
             mime_type = "audio/mpeg"
        elif req.video_filename.lower().endswith(".wav"):
             mime_type = "audio/wav"
        elif req.video_filename.lower().endswith(".m4a"):
             mime_type = "audio/mp4"
        elif req.video_filename.lower().endswith(".aac"):
             mime_type = "audio/aac"
        
        part = types.Part.from_uri(file_uri=req.gcs_path, mime_type=mime_type)

    except Exception as e:
        print(f"Error creating Part from URI: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process media file: {str(e)}")

    # Define prompts
    prompt_review = """
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

    prompt_script = """
        この音声は英語のレッスンまたは会話の録音です。
        内容を書き起こして、読みやすいスクリプト（Transcript）を作成してください。

        **制約事項:**
        1. **英語で**書き起こしてください。
        2. 話者（Teacher/Studentなど）が区別できる場合は、行頭に `Teacher:` `Student:` のようにラベルを付けてください。不明な場合は `Speaker A:` 等でも構いません。
        3. 読みやすさを重視し、適度に段落分けを行ってください。
        4. 冒頭の挨拶やメタコメントは不要です。スクリプトのみを出力してください。
        """

    async def generate_content(p_prompt, p_part, p_model="gemini-3-pro-preview"):
        # Retry logic for 429 RESOURCE_EXHAUSTED
        import time
        max_retries = 3
        retry_delay = 5 # seconds
        
        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=p_model,
                    contents=[p_prompt, p_part]
                )
                return response.text
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

    try:
        print(f"DEBUG: STARTING GEMINI GENERATION (Parallel)")
        import asyncio

        # Run review generation and script generation in parallel
        # Note: Using asyncio.get_event_loop().run_in_executor might be needed if client.models.generate_content is synchronous.
        # However, the user provided code in create_youtube_prep used await client.aio.models.generate_content.
        # But here we used the sync client in previous turn. Let's switch to async call for parallel execution if possible, 
        # OR use ThreadPoolExecutor for sync calls.
        # For simplicity and consistency with previous turn effectively being sync inside async def (FastAPI runs it in threadpool?), 
        # let's try to use client.aio if available or just run sequentially if not strict performance.
        # BUT the plan explicitly said "parallel".
        
        # Let's use the async client method if available on the `client` object we initialized. 
        # The `client` was initialized as `genai.Client(...)`.
        # Assuming `client.aio` exists as in `create_youtube_prep`.

        async def run_parallel():
             task_review = client.aio.models.generate_content(
                model="gemini-3-pro-preview",
                contents=[prompt_review, part]
             )
             task_script = client.aio.models.generate_content(
                model="gemini-3-flash-preview", # Use Flash for script to save cost/time
                contents=[prompt_script, part]
             )
             return await asyncio.gather(task_review, task_script)

        results = await run_parallel()
        content_review = results[0].text
        content_script = results[1].text

        print(f"DEBUG: GEMINI GENERATION COMPLETE")

    except Exception as e:
        print(f"Review Processing Error: {e}")
        error_detail = str(e)
        if "429" in error_detail or "RESOURCE_EXHAUSTED" in error_detail:
             error_detail = "AI Service Busy (Rate Limit). Please try again in a few minutes."
        raise HTTPException(status_code=500, detail=f"Processing Failed: {error_detail}")
    
    # 4. Save to Firestore
    doc_ref = db.collection("english_review").document()
    task = ReviewTask(
        id=doc_ref.id,
        video_filename=req.video_filename,
        content=content_review,
        script=content_script,
        created_at=datetime.now()
    )
    doc_ref.set(task.dict())
    
    return task


@router.get("/review", response_model=List[ReviewTask])
def get_review_list(db: firestore.Client = Depends(get_db)):
    docs = db.collection("english_review").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    tasks = []
    for d in docs:
        data = d.to_dict()
        if isinstance(data.get("status"), str):
             if data["status"] == "DONE":
                 data["status"] = 2
             else:
                 data["status"] = 0
        tasks.append(ReviewTask(**data))
    return tasks

@router.delete("/review/{task_id}")
def delete_review(task_id: str, db: firestore.Client = Depends(get_db)):
    db.collection("english_review").document(task_id).delete()
    return {"status": "deleted"}

@router.patch("/review/{task_id}/status")
def update_review_status(task_id: str, status: int, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("english_review").document(task_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    doc_ref.update({"status": status})
    return {"status": "updated", "new_status": status}

# --- Phrases Endpoints ---

@router.post("/phrases/generate", response_model=PhraseGenerateResponse)
def generate_phrases(req: PhraseGenerateRequest):
    prompt = f"""
    あなたはプロの英語教師です。以下の日本語フレーズに対して、いくつかの英語のバリエーションと、関連するおすすめフレーズ（追加のトピックや会話の返しなど）を提案してください。
    
    日本語: {req.japanese}
    
    以下のJSON形式で出力してください。Markdownのコードブロックは不要です。
    [
      {{
        "japanese": "{req.japanese}",
        "english": "英語フレーズ1",
        "type": "variation",
        "explanation": "ニュアンス解説"
      }},
      {{
         "japanese": "{req.japanese}",
         "english": "英語フレーズ2",
         "type": "variation",
         "explanation": "ニュアンス解説"
      }},
      {{
         "japanese": "関連する日本語",
         "english": "英語フレーズ3",
         "type": "recommendation",
         "explanation": "なぜこれがおすすめか"
      }}
    ]
    
    バリエーションは3つ程度、おすすめは2つ程度提案してください。
    学習者が微妙なニュアンスの違いを理解できるように解説を含めてください。
    """
    
    try:
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
        )
        
        # Simple cleaning of Markdown code blocks if present
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
        
        suggestions_data = json.loads(text)
        return PhraseGenerateResponse(suggestions=[PhraseSuggestion(**s) for s in suggestions_data])
        
    except Exception as e:
        print(f"Phrase Generation Error: {e}")
        # Return a dummy response or raise error? Raising error is better for now.
        raise HTTPException(status_code=500, detail=f"Phrase Generation Failed: {str(e)}")

@router.post("/phrases", response_model=List[Phrase])
def create_phrases(req_list: List[PhraseCreateRequest], db: firestore.Client = Depends(get_db)):
    batch = db.batch()
    new_phrases = []
    
    for req in req_list:
        doc_ref = db.collection("english_phrases").document()
        phrase = Phrase(
            id=doc_ref.id,
            japanese=req.japanese,
            english=req.english,
            note=req.note,
            is_memorized=False,
            created_at=datetime.now()
        )
        batch.set(doc_ref, phrase.dict())
        new_phrases.append(phrase)
        
    batch.commit()
    return new_phrases

@router.get("/phrases", response_model=List[Phrase])
def get_phrases(
    filter_memorized: bool = Query(False, description="Deprecated: Use status filtering"), # Keeping for backward compat logic if needed
    db: firestore.Client = Depends(get_db)
):
    query = db.collection("english_phrases").order_by("created_at", direction=firestore.Query.DESCENDING)
    
    docs = query.stream()
    phrases = []
    for d in docs:
        data = d.to_dict()
        # Migration: is_memorized=True -> status=2, False -> status=0
        if "status" not in data:
            data["status"] = 2 if data.get("is_memorized", False) else 0
        
        phrases.append(Phrase(**data))
        
    return phrases

@router.patch("/phrases/{phrase_id}/status")
def update_phrase_status(phrase_id: str, status: int, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("english_phrases").document(phrase_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Phrase not found")
        
    doc_ref.update({"status": status, "is_memorized": status == 2})
    return {"status": "updated", "new_status": status}

@router.delete("/phrases/{phrase_id}")
def delete_phrase(phrase_id: str, db: firestore.Client = Depends(get_db)):
    db.collection("english_phrases").document(phrase_id).delete()
    return {"status": "deleted"}


# --- Chat Endpoint ---

@router.post("/chat")
def chat_with_context(req: ChatRequest):
    """
    Chat with Gemini 3 Flash using the provided context (e.g. review content).
    """
    try:
        # Construct the prompt
        system_instruction = """
        あなたは有能な英語学習アシスタントです。
        ユーザーは現在、英語のレビュー資料（context）を見ています。
        この資料の内容に基づいて、ユーザーの質問に答えてください。
        
        回答のガイドライン:
        1. **コンテキスト重視**: 質問が資料に関するものであれば、必ず資料の内容を根拠に答えてください。
        2. **簡潔さ**: 回答は長くなりすぎないように、要点をまとめてください。
        3. **日本語**: 基本的に日本語で答えてください（英語の解説が必要な場合は英語を交えても構いません）。
        4. **親しみやすさ**: 丁寧ですが、硬すぎないトーンで話してください。
        """
        
        contents = []
        
        # Add context as the first user message part if provided
        if req.context:
             contents.append(types.Content(
                 role="user",
                 parts=[types.Part.from_text(text=f"【以下の資料（Context）を前提に回答してください】\n\n{req.context}")]
             ))
        
        # Add history
        for msg in req.messages:
            contents.append(types.Content(
                role=msg.role,
                parts=[types.Part.from_text(text=msg.content)]
            ))
            
        print(f"DEBUG: sending chat request with {len(req.messages)} messages")
        
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
            )
        )
        
        return {"response": response.text}

    except Exception as e:
        print(f"Chat Error: {e}")
        raise HTTPException(status_code=500, detail=f"Chat Failed: {str(e)}")
