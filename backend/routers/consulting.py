from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body, BackgroundTasks
from concurrent.futures import ThreadPoolExecutor, as_completed
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import base64
import os
import requests
import datetime
import asyncio
import uuid
import json
from google.cloud import storage
from google.cloud import aiplatform
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from google.api_core.client_options import ClientOptions
import vertexai
from vertexai.vision_models import MultiModalEmbeddingModel, Image
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from pypdf import PdfReader
import io
import time

# Import poppler wrapper
try:
    from pdf2image import convert_from_bytes
except ImportError:
    print("WARNING: pdf2image not installed. PDF ingestion will fail.")

router = APIRouter(
    tags=["consulting"],
)

# --- Configuration (Sharing some env vars with RAG) ---
from google.cloud import firestore
try:
    from google.cloud.firestore import Vector
except ImportError:
    from google.cloud.firestore_v1.vector import Vector

# --- Configuration (Sharing some env vars with RAG) ---
# DEBUG: Print env vars on load
print("Loading consulting.py...")
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")
FIRESTORE_COLLECTION_NAME = os.getenv("FIRESTORE_COLLECTION_NAME", "consulting_slides")

print(f"DEBUG: PROJECT_ID={PROJECT_ID}, BUCKET={GCS_BUCKET_NAME}, COLLECTION={FIRESTORE_COLLECTION_NAME}")

# --- Clients ---
# Initialize GenAI Client
client = None
if PROJECT_ID and LOCATION:
    try:
        api_key = os.getenv("GOOGLE_CLOUD_API_KEY", "").strip()
        client = genai.Client(
            vertexai=True,
            project=PROJECT_ID,
            location=LOCATION,
            api_key=api_key,
            http_options={'api_version': 'v1beta1'}
        )
    except Exception as e:
        print(f"Error initializing GenAI Client: {e}")

def get_storage_client():
    return storage.Client(project=PROJECT_ID)

def get_firestore_client():
    return firestore.Client(project=PROJECT_ID)

# --- Helpers ---

def generate_signed_url(gcs_uri: str) -> str:
    """Generates a signed URL for a GCS object."""
    try:
        if not gcs_uri.startswith("gs://"):
            return ""
        parts = gcs_uri.replace("gs://", "").split("/", 1)
        if len(parts) != 2:
            return ""
        bucket_name, blob_name = parts
        g_client = get_storage_client()
        bucket = g_client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        return blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(minutes=60),
            method="GET",
        )
    except Exception as e:
        print(f"Error generating signed URL: {e}")
        return ""

def get_embedding(text: str = None, image_bytes: bytes = None):
    """Generates embedding using the multimodal model via google.genai SDK."""
    if not client:
        print("GenAI client not initialized")
        return None
        
    try:
        model = "multimodalembedding@001"
        contents = []
        
        if image_bytes:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
            if text:
                 contents.append(types.Part.from_text(text=text))
        elif text:
            contents.append(types.Part.from_text(text=text))
            
        if not contents:
            return None

        result = client.models.embed_content(
            model=model,
            contents=contents
        )
        
        # Handle response extraction for multimodalembedding@001 via SDK
        # The SDK usually returns 'embeddings' list.
        if hasattr(result, 'image_embedding') and result.image_embedding:
             return result.image_embedding
        if hasattr(result, 'embeddings') and result.embeddings:
             return result.embeddings[0].values
             
        return None
    except Exception as e:
        print(f"Embedding error: {e}")
        return None
    return None

def analyze_slide_structure(image_bytes: bytes) -> Dict[str, Any]:
    """Analyzes a slide image using Gemini 1.5 Pro to extract structure and key message."""
    if not client:
        return {}
        
    try:
        prompt = """
        Analyze this consulting slide. Return a JSON object (no markdown) with these keys:
        - "structure_type": Short category of the visual structure (e.g., "2x2 Matrix", "Waterfall Chart", "3-Column List", "Process Flow", "Text Only", "Bar Chart").
        - "key_message": A single sentence summarizing the main takeaway or insight of the slide.
        - "description": A concise description of the slide's visual and logical content.
        """
        
        response = client.models.generate_content(
            model="gemini-1.5-pro",
            contents=[
                types.Part.from_text(text=prompt),
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2
            )
        )
        
        text = response.text
        # Safety cleanup
        if text.startswith("```json"):
            text = text.replace("```json", "").replace("```", "")
        elif text.startswith("```"):
            text = text.replace("```", "")
            
        return json.loads(text)
    except Exception as e:
        print(f"Slide Analysis Error: {e}")
        return {"structure_type": "Unknown", "key_message": "", "description": ""}

def search_vector_db(vector: List[float], top_k: int = 5) -> List[Dict[str, Any]]:
    """Searches Firestore using Vector Search."""
    try:
        db = get_firestore_client()
        collection = db.collection(FIRESTORE_COLLECTION_NAME)
        
        vector_query = collection.find_nearest(
            vector_field="embedding",
            query_vector=Vector(vector),
            distance_measure=firestore.VectorQuery.DistanceMeasure.COSINE,
            limit=top_k
        )
        
        docs = vector_query.get()
        
        results = []
        for doc in docs:
            data = doc.to_dict()
            results.append({
                "id": data.get("uri"), # GCS URI
                "score": 0.0, # Placeholder
                "metadata": {
                    "structure_type": data.get("structure_type"),
                    "key_message": data.get("key_message"),
                    "description": data.get("description"),
                    "page_number": data.get("page_number")
                }
            })
        return results
    except Exception as e:
        print(f"Firestore Vector Search Error: {e}")
        return []

def download_and_upload_worker(pdf_url: str):
    """Helper for threading."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
        
        pdf_res = requests.get(pdf_url, headers=headers, timeout=30)
        
        if pdf_res.status_code == 200:
            filename = pdf_url.split("/")[-1]
            filename = "".join(c for c in filename if c.isalnum() or c in "._-")
            if not filename.lower().endswith(".pdf"): filename += ".pdf"
            
            g_client = get_storage_client()
            bucket = g_client.bucket(GCS_BUCKET_NAME)
            blob = bucket.blob(f"consulting_raw/{filename}")
            blob.upload_from_string(pdf_res.content, content_type="application/pdf")
            print(f"Collected: {filename}")
            return filename
    except Exception as e:
        print(f"Failed to download {pdf_url}: {e}")
    return None

def process_downloads(pdf_links: List[str]):
    """Background task to download files concurrently."""
    print(f"Starting background download for {len(pdf_links)} files.")
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(download_and_upload_worker, url): url for url in pdf_links}
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f"Worker Error: {e}")
    print("Background download complete.")

# --- Models ---

class CollectRequest(BaseModel):
    url: str

class LogicMapperRequest(BaseModel):
    query: str

class VisualSearchRequest(BaseModel):
    image: str # base64

class SlidePolisherRequest(BaseModel):
    text: Optional[str] = None
    image: Optional[str] = None # base64

class DeleteFilesRequest(BaseModel):
    filenames: List[str]

class GenerateSignedUrlRequest(BaseModel):
    filename: str

# --- Endpoints ---

@router.get("/consulting/files")
async def list_files():
    """Lists PDF files in the consulting_raw directory."""
    try:
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        # Scan 'consulting_raw/' prefix
        blobs = bucket.list_blobs(prefix="consulting_raw/")
        
        file_list = []
        for blob in blobs:
            if blob.name.endswith(".pdf"):
                file_list.append({
                    "name": blob.name,
                    "basename": blob.name.split("/")[-1],
                    "size": blob.size,
                    "updated": blob.updated.isoformat() if blob.updated else None,
                    "content_type": blob.content_type
                })
        
        # Sort by updated desc
        file_list.sort(key=lambda x: x["updated"] or "", reverse=True)
        return {"files": file_list}
    except Exception as e:
        print(f"List Files Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/files/delete")
async def delete_files(req: DeleteFilesRequest):
    """Deletes specified files."""
    try:
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        
        deleted_count = 0
        errors = []
        
        for filename in req.filenames:
            # filename is full path e.g. "consulting_raw/foo.pdf"
            try:
                blob = bucket.blob(filename)
                blob.delete()
                deleted_count += 1
            except Exception as e:
                errors.append(f"{filename}: {e}")
        
        return {"deleted_count": deleted_count, "errors": errors}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/files/signed-url")
async def get_file_signed_url(req: GenerateSignedUrlRequest):
    """Generates a signed URL for viewing the file."""
    try:
        # Re-use helper
        # Helper expects gs://URI, but we can just use blob logic directly if we have bucket/blob
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(req.filename)
        
        url = blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(minutes=60),
            method="GET",
        )
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/files/upload")
async def simple_upload_file(file: UploadFile = File(...)):
    """Simple synchronous upload for the file manager."""
    try:
        if not GCS_BUCKET_NAME:
            raise HTTPException(status_code=500, detail="GCS config missing")
            
        content = await file.read()
        filename = file.filename
        # Sanitize
        filename = "".join(c for c in filename if c.isalnum() or c in "._-")
        if not filename.lower().endswith(".pdf"): filename += ".pdf"
        
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(f"consulting_raw/{filename}")
        blob.upload_from_string(content, content_type="application/pdf")
        
        return {"message": "Uploaded", "filename": f"consulting_raw/{filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ... (Existing code) ...

# --- Task Management ---

# In-memory storage for tasks: task_id -> {"status": str, "queue": asyncio.Queue, "logs": list}
tasks: Dict[str, Dict] = {}

async def add_log(task_id: str, message: str):
    """Adds a log to the queue and in-memory list."""
    if task_id in tasks:
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        tasks[task_id]["logs"].append(log_entry)
        await tasks[task_id]["queue"].put(log_entry)
        # DEBUG: Also print to console so we see it in Docker logs
        print(f"TASK[{task_id}]: {message}")

async def run_background_ingest(task_id: str):
    """Background worker for AI-Enhanced Ingestion (PDF -> Image -> Analysis -> Embedding -> DB)."""
    print(f"DEBUG: Starting background ingest {task_id}")
    try:
        await add_log(task_id, "Starting AI-Enhanced Ingestion...")
        
        if not GCS_BUCKET_NAME:
            await add_log(task_id, "Error: GCS_BUCKET_NAME not set.")
            await add_log(task_id, "DONE")
            return
            
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        blobs = list(bucket.list_blobs(prefix="consulting_raw/"))
        await add_log(task_id, f"Found {len(blobs)} files in consulting_raw/.")
        
        db = get_firestore_client()
        collection = db.collection(FIRESTORE_COLLECTION_NAME)
        
        count = 0
        
        for blob in blobs:
            if not blob.name.lower().endswith(".pdf"):
                continue

            await add_log(task_id, f"Processing PDF: {blob.name}")
            
            try:
                # 1. Download PDF
                pdf_bytes = blob.download_as_bytes()
                
                # 2. Convert to Images (per page)
                try:
                    images = convert_from_bytes(pdf_bytes, fmt="jpeg") # Returns list of PIL images
                except Exception as img_err:
                    await add_log(task_id, f"PDF Conversion Failed for {blob.name}: {img_err}")
                    continue

                total_pages = len(images)
                await add_log(task_id, f"  > Found {total_pages} pages in {blob.name}")

                for i, image in enumerate(images):
                    page_num = i + 1
                    
                    # 3. Resume Check (Check if page already indexed)
                    # ID format: raw_filename_p{page_num}
                    # Sanitize filename for ID
                    safe_filename = "".join(c for c in blob.name if c.isalnum() or c in "._-")
                    doc_id = f"{safe_filename}_p{page_num}"
                    
                    doc_snapshot = collection.document(doc_id).get()
                    if doc_snapshot.exists:
                        # Optional: skip log to reduce noise if many
                        # await add_log(task_id, f"    Skipping p{page_num} (Already indexed)")
                        continue
                    
                    await add_log(task_id, f"    Analyzing p{page_num}/{total_pages}...")

                    # Convert PIL image to bytes
                    img_byte_arr = io.BytesIO()
                    image.save(img_byte_arr, format='JPEG')
                    img_bytes = img_byte_arr.getvalue()

                    # 4. AI Analysis (Structure & Key Message)
                    analysis = analyze_slide_structure(img_bytes)
                    
                    # 5. Embedding (Image + AI Description)
                    # Use description in text part for better retrieval
                    text_context = f"Structure: {analysis.get('structure_type', '')}. Key Message: {analysis.get('key_message', '')}. {analysis.get('description', '')}"
                    
                    emb = get_embedding(image_bytes=img_bytes, text=text_context)
                    
                    if emb:
                        # 6. Save to Firestore
                        doc_data = {
                            "uri": f"gs://{GCS_BUCKET_NAME}/{blob.name}", # Link to original PDF
                            "filename": blob.name,
                            "page_number": page_num,
                            "structure_type": analysis.get("structure_type"),
                            "key_message": analysis.get("key_message"),
                            "description": analysis.get("description"),
                            "embedding": Vector(emb),
                            "created_at": firestore.SERVER_TIMESTAMP
                        }
                        collection.document(doc_id).set(doc_data)
                        count += 1
                        await add_log(task_id, f"    Indexed p{page_num}. Structure: {analysis.get('structure_type')}")
                    else:
                        await add_log(task_id, f"    Failed to embed p{page_num}")
                
            except Exception as f_err:
                await add_log(task_id, f"Error processing file {blob.name}: {f_err}")

        await add_log(task_id, f"Ingestion Complete. Indexed {count} new pages.")

    except Exception as e:
        await add_log(task_id, f"Critical Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        await add_log(task_id, "DONE")

async def run_background_index_creation(task_id: str):
    """Background worker for Index Creation."""
    try:
        await add_log(task_id, "Starting Index Creation...")
        await add_log(task_id, "This triggers 'gcloud firestore indexes composite create' command.")
        
        import subprocess
        
        cmd = [
            "gcloud", "firestore", "indexes", "composite", "create",
            "--project", PROJECT_ID,
            "--collection-group", FIRESTORE_COLLECTION_NAME,
            "--query-scope", "COLLECTION",
            "--field-config", 'field-path=embedding,vector-config={"dimension":1408,"flat":{}}'
        ]
        
        await add_log(task_id, f"Running: {' '.join(cmd)}")
        
        # Run subprocess
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await process.communicate()
        
        if stdout: await add_log(task_id, f"STDOUT: {stdout.decode().strip()}")
        if stderr: await add_log(task_id, f"STDERR: {stderr.decode().strip()}")
            
        if process.returncode == 0:
             await add_log(task_id, "Command executed successfully.")
        else:
             await add_log(task_id, f"Command failed with return code {process.returncode}")

    except Exception as e:
        await add_log(task_id, f"Error: {e}")
    finally:
        await add_log(task_id, "DONE")

# --- Endpoints ---

@router.post("/consulting/ingest")
async def trigger_ingest(background_tasks: BackgroundTasks):
    """Triggers background ingestion."""
    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "running",
        "queue": asyncio.Queue(),
        "logs": []
    }
    background_tasks.add_task(run_background_ingest, task_id)
    return {"task_id": task_id, "message": "Ingestion started"}

@router.post("/consulting/index")
async def trigger_index(background_tasks: BackgroundTasks):
    """Triggers background index creation."""
    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "running",
        "queue": asyncio.Queue(),
        "logs": []
    }
    background_tasks.add_task(run_background_index_creation, task_id)
    return {"task_id": task_id, "message": "Index creation started"}

@router.get("/consulting/tasks/{task_id}/stream")
async def stream_task_logs(task_id: str):
    """Streams logs for a given task using Server-Sent Events."""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
        
    async def event_generator():
        q = tasks[task_id]["queue"]
        while True:
            log_msg = await q.get()
            yield f"data: {json.dumps({'message': log_msg})}\n\n"
            if log_msg == "DONE" or "Critical Error" in log_msg:
                break
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/consulting/collect")
async def collect_data(req: CollectRequest, background_tasks: BackgroundTasks):
# ... (rest of the file)
    """Starts async collection from URL."""
    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "running",
        "queue": asyncio.Queue(),
        "logs": []
    }
    
    background_tasks.add_task(run_background_collection, task_id, 'url', req.url)
    
    return {"task_id": task_id, "message": "Task started"}

@router.post("/consulting/collect-file")
async def collect_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Starts async collection from File."""
    try:
        content = await file.read() # Read into memory immediately
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")

    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "running",
        "queue": asyncio.Queue(),
        "logs": []
    }
    
    # Pass content (bytes) to background task
    background_tasks.add_task(run_background_collection, task_id, 'file_bytes', content)
    
    return {"task_id": task_id, "message": "Task started"}

@router.post("/consulting/logic-mapper")
async def logic_mapper(req: LogicMapperRequest):
    """Analyzes text intent and searches for slide structures."""
    try:
        # 1. (Optional) Enhance query with Gemini? 
        # For now, direct embedding of the user intent
        
        vector = get_embedding(text=req.query)
        if not vector:
            return {"results": []}

        neighbors = search_vector_db(vector)
        
        results = []
        for n in neighbors:
            uri = n['id']
            url = generate_signed_url(uri)
            results.append({
                "url": url, 
                "uri": uri, 
                "score": n['score'],
                "metadata": n['metadata']
            })
            
        return {"results": results}
    except Exception as e:
        print(f"Logic Mapper Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/visual-search")
async def visual_search(req: VisualSearchRequest):
    """Searches using image embedding."""
    try:
        image_bytes = base64.b64decode(req.image)
        vector = get_embedding(image_bytes=image_bytes)
        
        if not vector:
             return {"results": []}

        neighbors = search_vector_db(vector)
        results = []
        for n in neighbors:
            uri = n['id']
            url = generate_signed_url(uri)
            results.append({
                "url": url, 
                "uri": uri, 
                "score": n['score'],
                "metadata": n['metadata']
            })
            
        return {"results": results}
    except Exception as e:
         raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/slide-polisher")
async def slide_polisher(req: SlidePolisherRequest):
    """Generates a polished slide visual (HTML/React) using Gemini 3.0."""
    try:
        if not client:
             raise Exception("GenAI client not initialized")

        contents = []
        contents.append("You are an expert McKinsey/BCG consultant slide designer.")
        contents.append("Your task is to take the user's content and generate a beautiful, modern, professional HTML/Tailwind slide representation.")
        contents.append("Return ONLY the HTML code for a <div> that represents the slide (aspect ratio 16:9). Use Tailwind CSS for styling. Do not include <html> or <body> tags, just the inner content.")
        contents.append("The background should be white or very light gray.")
        
        if req.text:
            contents.append(f"Content Constraints: {req.text}")
        if req.image:
             image_bytes = base64.b64decode(req.image)
             contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
             contents.append("Refine the layout of this slide sketch/draft.")
        
        response = client.models.generate_content(
            model="gemini-3-pro-preview",
            contents=contents
        )
        
        html_content = response.text
        # Cleanup markdown code blocks if present
        if html_content.startswith("```html"):
            html_content = html_content.replace("```html", "").replace("```", "")
        elif html_content.startswith("```"):
            html_content = html_content.replace("```", "")
        
        return {"html": html_content}
    except Exception as e:
        print(f"Polisher Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
