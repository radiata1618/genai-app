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
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")
INDEX_ENDPOINT_ID = os.getenv("INDEX_ENDPOINT_ID")
DEPLOYED_INDEX_ID = os.getenv("DEPLOYED_INDEX_ID")
VECTOR_SEARCH_LOCATION = os.getenv("VECTOR_SEARCH_LOCATION")

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
        # Return dummy embedding for testing if real model fails (e.g. auth issues locally)
        # return [0.0] * 1408 
        return None
    return None

def search_vector_db(vector: List[float], top_k: int = 5) -> List[Dict[str, Any]]:
    if not INDEX_ENDPOINT_ID or not DEPLOYED_INDEX_ID:
        print("Vector Search Env Vars missing. Returning empty results.")
        return []
    
    vs_location = VECTOR_SEARCH_LOCATION if VECTOR_SEARCH_LOCATION else LOCATION
    try:
        # Use api_endpoint for specific location
        api_endpoint = f"{vs_location}-aiplatform.googleapis.com"
        client_options = ClientOptions(api_endpoint=api_endpoint)
        
        # We need to use the lower level SDK or the high level one. 
        # Using aiplatform.MatchingEngineIndexEndpoint is easiest if initialized correctly.
        # But we need to set global location or pass it.
        
        index_endpoint = aiplatform.MatchingEngineIndexEndpoint(
            index_endpoint_name=INDEX_ENDPOINT_ID,
            project=PROJECT_ID,
            location=vs_location,
            credentials=None # Uses default 
        )
        
        response = index_endpoint.find_neighbors(
            deployed_index_id=DEPLOYED_INDEX_ID,
            queries=[vector],
            num_neighbors=top_k
        )
        
        results = []
        if response:
            for neighbor in response[0]:
                results.append({
                    "id": neighbor.id,
                    "distance": neighbor.distance
                })
        return results
        return results
    except Exception as e:
        print(f"Vector Search Error: {e}")
        return []

def download_and_upload_worker(pdf_url: str):
    """Helper for threading."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
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

# --- Endpoints ---

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

async def run_background_collection(task_id: str, mode: str, input_data: Any):
    """
    Background worker that performs the logic and streams logs.
    mode: 'url' or 'file_bytes'
    """
    try:
        await add_log(task_id, "Task Started.")
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        pdf_links = []
        
        # --- 1. Identify Links ---
        if mode == 'url':
            url = input_data
            await add_log(task_id, f"Fetching URL: {url}...")
            
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            try:
                response = requests.get(url, headers=headers, stream=True, timeout=30)
                response.raise_for_status()
                content_type = response.headers.get('Content-Type', '').lower()

                if 'application/pdf' in content_type or url.lower().endswith('.pdf'):
                    # Direct PDF
                    pdf_links.append(url)
                    await add_log(task_id, "Identified direct PDF URL.")
                elif 'text/html' in content_type:
                    # HTML Scraping
                    await add_log(task_id, "Parsing HTML page...")
                    soup = BeautifulSoup(response.content, 'html.parser')
                    count = 0
                    for a in soup.find_all('a', href=True):
                        href = a['href']
                        full_url = urljoin(url, href)
                        if full_url.lower().endswith('.pdf'):
                            pdf_links.append(full_url)
                            count += 1
                    # Remove duplicates
                    pdf_links = list(set(pdf_links))
                    await add_log(task_id, f"Found {len(pdf_links)} unique PDFs on page.")
                else:
                    await add_log(task_id, f"Unsupported content type: {content_type}")
            except Exception as e:
                await add_log(task_id, f"Error fetching URL: {e}")
                
        elif mode == 'file_bytes':
            # Create a bytes stream from the input data
            await add_log(task_id, "Parsing uploaded PDF file...")
            pdf_file = io.BytesIO(input_data)
            try:
                reader = PdfReader(pdf_file)
                found = set()
                for page in reader.pages:
                    if "/Annots" in page:
                        for annot in page["/Annots"]:
                            obj = annot.get_object()
                            if "/A" in obj and "/URI" in obj["/A"]:
                                uri = obj["/A"]["/URI"]
                                if uri.lower().endswith(".pdf"):
                                    found.add(uri)
                pdf_links = list(found)
                await add_log(task_id, f"Found {len(pdf_links)} links in file.")
            except Exception as e:
                await add_log(task_id, f"Error parsing PDF: {e}")
                
        # --- 2. Download Phase ---
        if not pdf_links:
            await add_log(task_id, "No PDFs found to download.")
            await add_log(task_id, "DONE")
            return

        await add_log(task_id, f"Starting download of {len(pdf_links)} files...")
        
        # Sequential or Parallel? Parallel is better but let's keep it simple-ish or use inner ThreadPool
        # Since we are in an async function, we should use a ThreadPool for blocking IO (requests/upload)
        
        loop = asyncio.get_running_loop()
        with ThreadPoolExecutor(max_workers=5) as executor:
            # Helper to run inside thread
            def _download_one(p_url):
                 try:
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                    res = requests.get(p_url, headers=headers, timeout=60)
                    if res.status_code == 200:
                        filename = p_url.split("/")[-1]
                        filename = "".join(c for c in filename if c.isalnum() or c in "._-") # sanitize
                        if not filename.lower().endswith(".pdf"): filename += ".pdf"
                        
                        blob = bucket.blob(f"consulting_raw/{filename}")
                        blob.upload_from_string(res.content, content_type="application/pdf")
                        return True, filename
                    return False, f"Status {res.status_code}"
                 except Exception as ex:
                    return False, str(ex)

            # Submit all
            futures = [loop.run_in_executor(executor, _download_one, link) for link in pdf_links]
            
            completed_count = 0
            for f in asyncio.as_completed(futures):
                success, msg = await f
                if success:
                    completed_count += 1
                    await add_log(task_id, f"Saved: {msg}")
                else:
                    await add_log(task_id, f"Failed: {msg}")
                    
        await add_log(task_id, f"Process Complete. Collected {completed_count}/{len(pdf_links)} files.")
        
    except Exception as e:
        await add_log(task_id, f"Critical Error: {e}")
    finally:
        await add_log(task_id, "DONE")

# --- Endpoints ---

@router.get("/consulting/tasks/{task_id}/stream")
async def stream_task_logs(task_id: str):
    """Streams logs for a given task using Server-Sent Events."""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
        
    async def event_generator():
        q = tasks[task_id]["queue"]
        
        # Flush existing logs first? (Optional, but good if client re-connects)
        # For simplicity, we assume one-time connection. 
        # If we wanted re-connection support, we'd iterate tasks[task_id]['logs'] first.
        
        while True:
            log_msg = await q.get()
            # Send event
            yield f"data: {json.dumps({'message': log_msg})}\n\n"
            
            if log_msg == "DONE" or "Critical Error" in log_msg:
                break
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/consulting/collect")
async def collect_data(req: CollectRequest, background_tasks: BackgroundTasks):
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
