from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta
from google.cloud import firestore, storage
from database import get_db
import os
import uuid
import json
from google import genai
from google.genai import types
import asyncio

router = APIRouter(
    prefix="/hobbies",
    tags=["hobbies"],
)

# --- Configuration ---
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_ENGLISH_REVIEW") # Reusing bucket or define new one? 
# Ideally should use a generic one or separate. I'll fallback to english one or a general "uploads" one.
# Given I don't want to break things, I'll assume valid bucket env exists or fallback.
if not GCS_BUCKET_NAME:
    GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "your-default-bucket") 

# Re-init client (Should ideally be a dependency/singleton, but following existing pattern)
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

class PhotoUploadRequest(BaseModel):
    filename: str
    content_type: str = "image/jpeg"

class PhotoAnalyzeRequest(BaseModel):
    filename: str
    gcs_path: Optional[str] = None
    photo_url: Optional[str] = None
    camera_model: str = "RX100 VII" # or "Oppo"

class PhotoTask(BaseModel):
    id: str
    filename: str
    gcs_path: str
    camera_model: str
    score: Optional[int] = None
    advice: Optional[str] = None
    created_at: datetime
    status: str = "processed" # processing, processed, error

class ChatMessage(BaseModel):
    role: str
    content: str
    
class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    context: Optional[str] = None

class FinancialAsset(BaseModel):
    id: str
    asset_type: str # stock, crypto, currency, other
    ticker: str
    name: str
    note: Optional[str] = None
    created_at: datetime

class AssetCreateRequest(BaseModel):
    asset_type: str
    ticker: str
    name: str
    note: Optional[str] = None

class FinanceAnalysisRequest(BaseModel):
    target: str = "all" # or specific asset ID

class FinanceAnalysisResult(BaseModel):
    analysis: str
    created_at: datetime

# --- Endpoints: Photos ---

@router.get("/photos/upload-url")
def get_photo_upload_url(filename: str, content_type: str = "image/jpeg"):
    """Generates a PUT Signed URL for uploading photo directly to GCS."""
    try:
        bucket = storage_client.bucket(GCS_BUCKET_NAME)
        unique_name = f"hobbies/photos/{uuid.uuid4()}_{filename}"
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

@router.post("/photos/analyze", response_model=PhotoTask)
async def analyze_photo(req: PhotoAnalyzeRequest, db: firestore.Client = Depends(get_db)):
    # 1. Processing Input (GCS vs URL)
    gcs_path = req.gcs_path
    
    # If URL is provided, try to extract image and upload to GCS first
    if not gcs_path and req.photo_url:
        try:
            print(f"Importing from URL: {req.photo_url}")
            import requests
            from bs4 import BeautifulSoup
            import io
            
            target_image_url = req.photo_url
            
            # Handle Google Photos shared link
            if "photos.app.goo.gl" in req.photo_url or "photos.google.com" in req.photo_url:
                try:
                    # 1. Get the shared page
                    resp = requests.get(req.photo_url, allow_redirects=True)
                    soup = BeautifulSoup(resp.content, "html.parser")
                    # 2. Extract og:image
                    og_image = soup.find("meta", property="og:image")
                    if og_image and og_image.get("content"):
                        target_image_url = og_image["content"]
                        print(f"Extracted Image URL: {target_image_url}")
                    else:
                        raise ValueError("Could not find image in Google Photos link")
                except Exception as e:
                    print(f"Scraping Error: {e}")
                    raise HTTPException(status_code=400, detail="Failed to parse Google Photos link")

            # Download Image
            # Note: requests.get for image
            img_resp = requests.get(target_image_url)
            if img_resp.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to download image from extracted URL")
            
            image_bytes = img_resp.content
            content_type = img_resp.headers.get("Content-Type", "image/jpeg")
            
            # Upload to GCS
            bucket = storage_client.bucket(GCS_BUCKET_NAME)
            unique_name = f"hobbies/photos/{uuid.uuid4()}_imported.jpg"
            blob = bucket.blob(unique_name)
            blob.upload_from_string(image_bytes, content_type=content_type)
            
            gcs_path = f"gs://{GCS_BUCKET_NAME}/{unique_name}"
            # Update filename if it was just "imported" or generic
            if not req.filename:
                req.filename = "Imported Photo"

        except Exception as e:
            print(f"Import Error: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to import photo from URL: {str(e)}")

    if not gcs_path:
        raise HTTPException(status_code=400, detail="Either gcs_path or photo_url is required")

    try:
        # Create Part from GCS URI
        part = types.Part.from_uri(file_uri=gcs_path, mime_type="image/jpeg") # Assuming jpeg/png
        
        prompt = f"""
        あなたはプロのフォトグラファーです。
        ユーザーがアップロードしたこの写真を採点し、より良い写真を撮るためのアドバイスをしてください。

        使用カメラ: **{req.camera_model}**
        
        以下の形式（日本語Markdown）で出力してください:
        
        # 採点: [0-100]/100
        
        ## 良かった点
        - (具体的に)
        
        ## 改善アドバイス ({req.camera_model}の特性を踏まえて)
        - (構図、露出、設定など具体的な操作方法を含めて)
        
        ## 次回のチャレンジ
        - (具体的なテーマや設定の提案)
        """
        
        # 2. Call Gemini 3 Flash
        response = await client.aio.models.generate_content(
            model="gemini-3-flash-preview",
            contents=[prompt, part]
        )
        advice_text = response.text
        
        # Extract score (simple regex or parsing)
        import re
        score = 0
        match = re.search(r"採点[:：]\s*(\d+)", advice_text)
        if match:
            score = int(match.group(1))
            
    except Exception as e:
        print(f"Photo Analysis Error: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis Failed: {str(e)}")
        
    # 3. Save to Firestore
    doc_ref = db.collection("hobbies_photos").document()
    task = PhotoTask(
        id=doc_ref.id,
        filename=req.filename or "Imported Photo",
        gcs_path=gcs_path,
        camera_model=req.camera_model,
        score=score,
        advice=advice_text,
        created_at=datetime.now(),
        status="processed"
    )
    doc_ref.set(task.dict())
    
    return task

@router.get("/photos", response_model=List[PhotoTask])
def get_photos(db: firestore.Client = Depends(get_db)):
    docs = db.collection("hobbies_photos").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    return [PhotoTask(**d.to_dict()) for d in docs]

@router.delete("/photos/{photo_id}")
def delete_photo(photo_id: str, db: firestore.Client = Depends(get_db)):
    db.collection("hobbies_photos").document(photo_id).delete()
    return {"status": "deleted"}

@router.get("/photos/{photo_id}/image-url")
def get_photo_image_url(photo_id: str, db: firestore.Client = Depends(get_db)):
    doc = db.collection("hobbies_photos").document(photo_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Photo not found")
    
    data = doc.to_dict()
    gcs_path = data.get("gcs_path") # gs://bucket/path
    
    if not gcs_path:
        raise HTTPException(status_code=400, detail="No GCS path found")
        
    try:
        # gs://bucket/path -> bucket, blob_name
        parts = gcs_path.replace("gs://", "").split("/", 1)
        if len(parts) != 2:
            raise HTTPException(status_code=500, detail="Invalid GCS path format")
            
        bucket_name, blob_name = parts
        
        # Check if bucket matches env one, or just use the one in path?
        # Use the one in path to be safe if multiple buckets used.
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=60), # 1 hour
            method="GET",
        )
        return {"url": url}
    except Exception as e:
        print(f"Error generating download URL: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate URL: {e}")


# --- Endpoints: Chat (Camera Guide) ---

@router.post("/photos/chat")
async def chat_camera_guide(req: ChatRequest):
    """Chat with context of camera guide/specific photo advice."""
    system_instruction = "あなたは親切なカメラマンのコーチです。ユーザーの写真やカメラに関する質問に答えてください。"
    
    contents = []
    if req.context:
        contents.append(f"【参考情報（写真の評価）】\n{req.context}\n\n上記の評価を踏まえて回答してください。")
    
    # Convert messages
    history = []
    for msg in req.messages:
        # Simple mapping
        if msg.role == "user":
            history.append(types.Content(role="user", parts=[types.Part.from_text(text=msg.content)]))
        else:
             history.append(types.Content(role="model", parts=[types.Part.from_text(text=msg.content)]))
            
    # Add system instruction as first user message or separate config if supported?
    # Gemini 1.5/2.0 supports system_instruction param.
    
    try:
        response = await client.aio.models.generate_content(
            model="gemini-3-flash-preview",
            contents=history,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction
            )
        )
        return {"response": response.text}
    except Exception as e:
        print(f"Chat Error: {e}")
        return {"response": "すみません、エラーが発生しました。"}


# --- Endpoints: Financial Assets ---

@router.get("/finance/assets", response_model=List[FinancialAsset])
def get_assets(db: firestore.Client = Depends(get_db)):
    docs = db.collection("hobbies_finance_assets").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    return [FinancialAsset(**d.to_dict()) for d in docs]

@router.post("/finance/assets", response_model=FinancialAsset)
def create_asset(req: AssetCreateRequest, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("hobbies_finance_assets").document()
    asset = FinancialAsset(
        id=doc_ref.id,
        asset_type=req.asset_type,
        ticker=req.ticker,
        name=req.name,
        note=req.note,
        created_at=datetime.now()
    )
    doc_ref.set(asset.dict())
    return asset

@router.delete("/finance/assets/{asset_id}")
def delete_asset(asset_id: str, db: firestore.Client = Depends(get_db)):
    db.collection("hobbies_finance_assets").document(asset_id).delete()
    return {"status": "deleted"}

@router.post("/finance/analyze")
async def analyze_finance(req: FinanceAnalysisRequest, db: firestore.Client = Depends(get_db)):
    """
    Analyzes assets using Gemini 3 Pro.
    Gathers news/info (simulated or using grounding if enabled) and provides outlook.
    """
    # 1. Fetch Assets
    assets_ref = db.collection("hobbies_finance_assets").stream()
    assets = [d.to_dict() for d in assets_ref]
    
    if not assets:
        return {"analysis": "登録されている資産がありません。", "created_at": datetime.now()}

    # 2. Construct Prompt with Asset List
    assets_str = "\n".join([f"- [{a['asset_type']}] {a['name']} ({a['ticker']}): {a.get('note', '')}" for a in assets])
    
    prompt = f"""
    あなたはプロの金融アナリストです。
    以下のポートフォリオ（資産リスト）について、最新の市場動向やニュースを踏まえて、
    それぞれの今後の展望と、ポートフォリオ全体へのアドバイスを詳細に分析してください。

    ## 保有資産リスト
    {assets_str}

    ## 分析にお願いしたいこと
    1. 各銘柄・資産の直近のニュースやトレンド（Google検索等の機能を活用して最新情報を考慮してください - ※Grounding機能が有効な場合）
    2. 強気(Bullish)か弱気(Bearish)かの見解とその理由
    3. 今後の注目イベントやリスク要因
    
    出力は日本語のMarkdownで見やすくまとめてください。
    """

    try:
        # Use Gemini 3 Pro with Grounding (Google Search)
        # Note: 'google_search_retrieval' tool needs to be configured.
        # Checking if standard grounding tool config is available in V1beta1 SDK
        
        tools = [types.Tool(google_search=types.GoogleSearch())]
        
        response = await client.aio.models.generate_content(
            model="gemini-3-pro-preview",
            contents=prompt,
            config=types.GenerateContentConfig(
                tools=tools
            )
        )
        
        # Save analysis result to history (optional, or just return)
        # Here we just return it, frontend can display it.
        # Or save to a separate collection "hobbies_finance_analysis"
        
        analysis_text = response.text
        
        # Save most recent analysis
        analysis_ref = db.collection("hobbies_finance_analysis").document("latest")
        analysis_ref.set({
            "analysis": analysis_text,
            "created_at": datetime.now()
        })
        
        return {"analysis": analysis_text, "created_at": datetime.now()}
        
    except Exception as e:
        print(f"Finance Analysis Error: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis Failed: {str(e)}")

@router.get("/finance/latest-analysis")
def get_latest_analysis(db: firestore.Client = Depends(get_db)):
    doc = db.collection("hobbies_finance_analysis").document("latest").get()
    if doc.exists:
        return doc.to_dict()
    return None
