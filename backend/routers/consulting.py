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
_vertexai_initialized = False
def _ensure_vertexai_init():
    global _vertexai_initialized
    if not _vertexai_initialized:
        if PROJECT_ID and LOCATION:
            vertexai.init(project=PROJECT_ID, location=LOCATION)
            _vertexai_initialized = True

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
        client = get_storage_client()
        bucket = client.bucket(bucket_name)
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
    _ensure_vertexai_init()
    try:
        model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")
        if image_bytes:
            image = Image(image_bytes)
            embeddings = model.get_embeddings(image=image, contextual_text=text)
            return embeddings.image_embedding
        elif text:
            embeddings = model.get_embeddings(contextual_text=text)
            return embeddings.text_embedding
    except Exception as e:
        print(f"Embedding error: {e}")
        return None
    return None

def search_vector_db(vector: List[float], top_k: int = 5) -> List[Dict[str, Any]]:
    """Searches Firestore using Vector Search."""
    try:
        db = get_firestore_client()
        collection = db.collection(FIRESTORE_COLLECTION_NAME)
        
        # Firestore Vector Search
        # Requires 'embedding' field to be a Vector type
        # We need to find_nearest
        
        vector_query = collection.find_nearest(
            vector_field="embedding",
            query_vector=Vector(vector),
            distance_measure=firestore.VectorQuery.DistanceMeasure.COSINE, # or DOT_PRODUCT
            limit=top_k
        )
        
        docs = vector_query.get()
        
        results = []
        for doc in docs:
            data = doc.to_dict()
            # Calculate a dummy distance/score if not provided directly or use metadata
            # find_nearest results are ordered by distance.
            # Currently python SDK might not expose distance directly in the doc snapshot without some trick,
            # but usually it's close enough for ranking.
            
            results.append({
                "id": data.get("uri"), # GCS URI
                "distance": 0.0 # Placeholder as distance isn't easily accessible in simple get(), but order is correct
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
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
        }
        # Sometimes referer helps if it is a known domain, but for general PDF links usually no referer is safer unless we know the parent
        # If headers are stricter, we might need a Session
        
        pdf_res = requests.get(pdf_url, headers=headers, timeout=30)
        
        if pdf_res.status_code == 200:
            filename = pdf_url.split("/")[-1]
            # basic sanitization
            filename = "".join(c for c in filename if c.isalnum() or c in "._-")
            if not filename.lower().endswith(".pdf"): filename += ".pdf"
            
            client = get_storage_client()
            bucket = client.bucket(GCS_BUCKET_NAME)
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
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
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
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        
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
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
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
        
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
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
    """Background worker for Firestore Ingestion."""
    print(f"DEBUG: Starting background ingest {task_id}")
    try:
        await add_log(task_id, "Starting Ingestion...")
        
        if not GCS_BUCKET_NAME:
            await add_log(task_id, "Error: GCS_BUCKET_NAME not set.")
            await add_log(task_id, "DONE")
            return
            
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        blobs = list(bucket.list_blobs(prefix="consulting_raw/"))
        await add_log(task_id, f"Found {len(blobs)} files in consulting_raw/.")
        
        db = get_firestore_client()
        collection = db.collection(FIRESTORE_COLLECTION_NAME)
        
        count = 0
        loop = asyncio.get_running_loop()
        
        # We need to run Thread blocking I/O (embedding) in executor
        with ThreadPoolExecutor(max_workers=3) as executor:
            chunk_futures = []
            
            for blob in blobs:
                if not (blob.name.lower().endswith(".png") or blob.name.lower().endswith(".jpg") or blob.name.lower().endswith(".jpeg")):
                    continue
                
                # Define helper for single item processing
                def process_one(b_name, b_data):
                     try:
                        emb = get_embedding(image_bytes=b_data)
                        if emb:
                            safe_id = "".join(c for c in b_name if c.isalnum() or c in "._-")
                            return True, safe_id, emb, b_name
                        return False, "No embedding", None, b_name
                     except Exception as ex:
                        return False, str(ex), None, b_name

                # Download first (IO bound, can be async but blob.download_as_bytes is sync)
                # To avoid blocking event loop, run download in executor too or assume it's fast enough for small concurrency
                # For safety, let's run the whole process_one including download in executor? 
                # passing blob object might be tricky across threads if not careful, but usually ok.
                # Better: download in main loop (async-ish) or use executor.
                
                # Let's do a simpler sequential-ish pattern with ThreadPool for the heavy lifting
                
                # Download
                try:
                    b_data = blob.download_as_bytes()
                    chunk_futures.append(loop.run_in_executor(executor, process_one, blob.name, b_data))
                except Exception as e:
                    await add_log(task_id, f"Error downloading {blob.name}: {e}")

            await add_log(task_id, f"Processing {len(chunk_futures)} images...")
            
            for f in asyncio.as_completed(chunk_futures):
                success, msg, emb, fname = await f
                if success:
                    # Write to Firestore (IO)
                    try:
                        doc_ref = collection.document(msg) # msg is safe_id
                        doc_ref.set({
                            "uri": f"gs://{GCS_BUCKET_NAME}/{fname}",
                            "filename": fname,
                            "embedding": Vector(emb),
                            "created_at": firestore.SERVER_TIMESTAMP
                        })
                        count += 1
                        await add_log(task_id, f"Indexed: {fname}")
                    except Exception as db_e:
                        await add_log(task_id, f"DB Error {fname}: {db_e}")
                else:
                    await add_log(task_id, f"Failed {fname}: {msg}")
                    
        await add_log(task_id, f"Ingestion Complete. Indexed {count} documents.")

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
        await add_log(task_id, "It may take a few minutes for the index to become active on Google Cloud side.")
        
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
        
        if stdout:
            await add_log(task_id, f"STDOUT: {stdout.decode().strip()}")
        if stderr:
             # gcloud sends progress/info to stderr often
            await add_log(task_id, f"STDERR: {stderr.decode().strip()}")
            
        if process.returncode == 0:
             await add_log(task_id, "Command executed successfully.")
             await add_log(task_id, "Please check GCP Console or wait a few minutes before searching.")
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
             # Fallback: Mock results for PoC if embedding fails
            return {
                "results": [
                    {"url": "https://placehold.co/600x400/EEE/31343C?text=Structure+A", "title": "Example Structure A"},
                    {"url": "https://placehold.co/600x400/EEE/31343C?text=Structure+B", "title": "Example Structure B"}
                ]
            }

        neighbors = search_vector_db(vector)
        
        results = []
        for n in neighbors:
            uri = n['id']
            url = generate_signed_url(uri)
            results.append({"url": url, "uri": uri, "score": n['distance']})
            
        if not results:
             # Mock if no results
            return {
                "results": [
                    {"url": "https://placehold.co/600x400/EEE/31343C?text=No+Match+Found", "title": "No Direct Match"}
                ]
            }
            
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
            results.append({"url": url, "uri": uri, "score": n['distance']})
            
        return {"results": results}
    except Exception as e:
         raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/slide-polisher")
async def slide_polisher(req: SlidePolisherRequest):
    """Generates a polished slide visual (HTML/React) using Gemini 3.0."""
    try:
        api_key = os.getenv("GOOGLE_CLOUD_API_KEY", "").strip()
        client = genai.Client(vertexai=True, api_key=api_key, http_options={'api_version': 'v1beta1'})
        
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
        
        return {"html": html_content}
    except Exception as e:
        print(f"Polisher Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
