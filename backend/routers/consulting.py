from fastapi import (
    APIRouter,
    HTTPException,
    UploadFile,
    File,
    Form,
    Body,
    BackgroundTasks,
    Depends,
    WebSocket,
    WebSocketDisconnect
)
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
import time
import warnings
import subprocess
import io

# Suppress Vertex AI SDK deprecation warning
warnings.filterwarnings("ignore", category=UserWarning, module="vertexai._model_garden._model_garden_models")
warnings.filterwarnings("ignore", category=UserWarning, module="vertexai.vision_models._vision_models")

from fastapi.responses import StreamingResponse
from google.genai import types
from google import genai
from google.cloud import firestore, storage
from google.oauth2 import service_account
import traceback

# --- Import from Services ---
from services.ai_shared import (
    get_genai_client,
    get_storage_client,
    get_firestore_client,
    get_embedding,
    trace,
    PROJECT_ID,
    LOCATION,
    GCS_BUCKET_NAME,
    FIRESTORE_COLLECTION_NAME,
    BATCH_COLLECTION_NAME,
    RESULT_COLLECTION_NAME,
    Vector
)
# from services.ai_analysis import analyze_slide_structure
# from services.ingestion import run_batch_ingestion

router = APIRouter(
    tags=["consulting"],
)

# DEBUG: Print env vars on load
print("Loading consulting.py...")
trace(f"PROJECT_ID={PROJECT_ID}")
trace(f"LOCATION={LOCATION}")
trace(f"BUCKET={GCS_BUCKET_NAME}, COLLECTION={FIRESTORE_COLLECTION_NAME}")


# --- Helpers Wrappers (for backward compatibility if needed) ---
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
            trace(f"Collected: {filename}")
            return filename
    except Exception as e:
        print(f"Failed to download {pdf_url}: {e}")
    return None

import io
# from pdf2image import convert_from_bytes # Used in retry_batch_worker (legacy)

async def run_batch_ingestion_worker(batch_id: str):
    """
    Wrapper for backward compatibility or local threaded run.
    This calls the shared service logic.
    """
    try:
        # In a real async environment, we might run this in a thread pool executor
        # if the service function is blocking (it is).
        loop = asyncio.get_event_loop()
        from services.ingestion import run_batch_ingestion
        await loop.run_in_executor(None, run_batch_ingestion, batch_id)
    except Exception as e:
        print(f"Worker Wrapper Error: {e}")

async def retry_batch_worker(batch_id: str, item_ids: List[str] = None):
    """Retries failed items in a batch. Kept as legacy logic for now, or needs refactor to Service."""
    # TODO: Move this logic to backend/services/ingestion.py as well
    print(f"DEBUG: Retrying batch {batch_id}")
    db = get_firestore_client()
    batch_ref = db.collection(BATCH_COLLECTION_NAME).document(batch_id)
    results_ref = db.collection(RESULT_COLLECTION_NAME)
    
    batch_ref.update({"status": "retrying"})
    
    try:
        # Query failed items
        query = results_ref.where("batch_id", "==", batch_id).where("status", "==", "failed")
        docs = query.stream()
        
        target_docs = []
        for d in docs:
            if item_ids and d.id not in item_ids:
                continue
            target_docs.append(d)
            
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        main_collection = db.collection(FIRESTORE_COLLECTION_NAME)
        
        for doc in target_docs:
            data = doc.to_dict()
            blob_name = data.get("filename")
            doc.reference.update({"status": "processing", "error": firestore.DELETE_FIELD, "updated_at": firestore.SERVER_TIMESTAMP})
            
            try:
                blob = bucket.blob(blob_name)
                pdf_bytes = blob.download_as_bytes()
                from pdf2image import convert_from_bytes
                images = convert_from_bytes(pdf_bytes, fmt="jpeg")
                pages_success = 0
                for i, image in enumerate(images):
                    page_num = i + 1
                    img_byte_arr = io.BytesIO()
                    image.save(img_byte_arr, format='JPEG')
                    img_bytes = img_byte_arr.getvalue()
                    
                    
                    from services.ai_analysis import analyze_slide_structure
                    analysis = analyze_slide_structure(img_bytes)
                    text_context = f"Structure: {analysis.get('structure_type', '')}. Key Message: {analysis.get('key_message', '')}. {analysis.get('description', '')}"
                    emb = get_embedding(image_bytes=img_bytes, text=text_context)
                    
                    if emb:
                        safe_filename = "".join(c for c in blob_name if c.isalnum() or c in "._-")
                        doc_id = f"{safe_filename}_p{page_num}"
                        main_collection.document(doc_id).set({
                            "uri": f"gs://{GCS_BUCKET_NAME}/{blob_name}",
                            "filename": blob_name,
                            "page_number": page_num,
                            "structure_type": analysis.get("structure_type"),
                            "key_message": analysis.get("key_message"),
                            "description": analysis.get("description"),
                            "embedding": Vector(emb),
                            "created_at": firestore.SERVER_TIMESTAMP
                        })
                        pages_success += 1
                
                if pages_success > 0:
                    doc.reference.update({"status": "success", "pages_processed": pages_success, "updated_at": firestore.SERVER_TIMESTAMP})
                else:
                    doc.reference.update({"status": "failed", "error": "Retry failed: No pages", "updated_at": firestore.SERVER_TIMESTAMP})
                    
            except Exception as e:
                doc.reference.update({"status": "failed", "error": f"Retry error: {str(e)}", "updated_at": firestore.SERVER_TIMESTAMP})
        
        batch_ref.update({"status": "completed"}) 
        
    except Exception as e:
        batch_ref.update({"status": "failed", "error": f"Retry Crash: {str(e)}"})

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

# --- Models for MTG Review & SME ---

class ConsultingReviewCreateRequest(BaseModel):
    media_filename: str
    gcs_path: str # gs://bucket/path

class ConsultingReviewTask(BaseModel):
    id: str
    media_filename: str
    feedback: str # Markdown content
    created_at: datetime.datetime
    status: int = 0

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

class RetryBatchRequest(BaseModel):
    item_ids: Optional[List[str]] = None 

# --- Endpoints ---

@router.get("/consulting/files")
async def list_files(max_results: int = 100, page_token: Optional[str] = None, search: Optional[str] = None):
    """Lists PDF files in the consulting_raw directory with pagination and optional search."""
    try:
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        
        prefix = "consulting_raw/"
        match_glob = None
        
        if search:
            # Note: GCS match_glob works relative to the bucket root, but we want to search INSIDE the prefix
            # However, list_blobs with both prefix and match_glob can be tricky or supported depending on lib version.
            # Best practice: use match_glob for the full pattern.
            # Pattern: consulting_raw/*{search}*
            # We must be careful about case sensitivity (GCS is case sensitive).
            # match_glob does not support insensitive search natively. 
            # We will accept exact case or try to match loosely if possible, but standard glob is case sensitive.
            # For now, we implement simple glob matching.
            match_glob = f"consulting_raw/*{search}*"
            # When match_glob is used, prefix is often ignored or used as a filter. 
            # We'll use match_glob primarily.
            blobs_iter = bucket.list_blobs(match_glob=match_glob, max_results=max_results, page_token=page_token)
        else:
            blobs_iter = bucket.list_blobs(prefix=prefix, max_results=max_results, page_token=page_token)
        
        file_list = []
        db = get_firestore_client()
        summary_collection = db.collection("ingestion_file_summaries")
        
        doc_refs = []
        file_map = {} 
        
        for blob in blobs_iter:
            if blob.name.endswith(".pdf"):
                safe_filename = "".join(c for c in blob.name if c.isalnum() or c in "._-")
                item = {
                    "name": blob.name,
                    "basename": blob.name.split("/")[-1],
                    "size": blob.size,
                    "updated": blob.updated.isoformat() if blob.updated else None,
                    "content_type": blob.content_type,
                    "status": "pending",
                    "filter_reason": None,
                    "firm_name": None,
                    "page_count": None,
                    "design_rating": None
                }
                file_list.append(item)
                file_map[safe_filename] = item
                doc_refs.append(summary_collection.document(safe_filename))
        
        if doc_refs:
            docs = db.get_all(doc_refs)
            for doc in docs:
                if doc.exists:
                    data = doc.to_dict()
                    safe_fname = doc.id
                    if safe_fname in file_map:
                        item = file_map[safe_fname]
                        item["status"] = data.get("status", "pending")
                        reason = data.get("filter_reason")
                        if not reason and data.get("error"):
                            reason = data.get("error")
                        item["filter_reason"] = reason
                        item["firm_name"] = data.get("firm_name")
                        item["page_count"] = data.get("page_count")
                        item["design_rating"] = data.get("design_rating")
        
        file_list.sort(key=lambda x: x["updated"] or "", reverse=True)
        return {"files": file_list, "next_page_token": blobs_iter.next_page_token}
    except Exception as e:
        print(f"List Files Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/files/delete")
async def delete_files(req: DeleteFilesRequest):
    try:
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        deleted_count = 0
        errors = []
        for filename in req.filenames:
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
    try:
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(req.filename)
        url = blob.generate_signed_url(version="v4", expiration=datetime.timedelta(minutes=60), method="GET")
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/files/upload")
async def simple_upload_file(file: UploadFile = File(...)):
    try:
        if not GCS_BUCKET_NAME:
            raise HTTPException(status_code=500, detail="GCS config missing")
        content = await file.read()
        filename = file.filename
        filename = "".join(c for c in filename if c.isalnum() or c in "._-")
        if not filename.lower().endswith(".pdf"): filename += ".pdf"
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(f"consulting_raw/{filename}")
        blob.upload_from_string(content, content_type="application/pdf")
        return {"message": "Uploaded", "filename": f"consulting_raw/{filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Batch Ingestion Endpoints ---

@router.post("/consulting/ingest")
async def trigger_ingest(background_tasks: BackgroundTasks):
    """Starts a new ingestion batch (Via Cloud Run Job in Prod, or Thread in Local)."""
    try:
        batch_id = str(uuid.uuid4())
        db = get_firestore_client()
        db.collection(BATCH_COLLECTION_NAME).document(batch_id).set({
            "id": batch_id,
            "created_at": firestore.SERVER_TIMESTAMP,
            "status": "pending",
            "summary": "Full Ingestion Run"
        })
        
        # Determine Execution Mode (Option A: Cloud Run Job)
        USE_CLOUD_JOBS = os.getenv("USE_CLOUD_RUN_JOBS", "false").lower() == "true"
        
        if USE_CLOUD_JOBS and PROJECT_ID and LOCATION:
            try:
                # Trigger Cloud Run Job
                from google.cloud import run_v2
                client = run_v2.JobsClient()
                job_name = f"projects/{PROJECT_ID}/locations/{LOCATION}/jobs/ingestion-worker"
                
                request = run_v2.RunJobRequest(
                    name=job_name,
                    overrides=run_v2.RunJobRequest.Overrides(
                        container_overrides=[
                            run_v2.RunJobRequest.Overrides.ContainerOverride(
                                args=["--batch_id", batch_id]
                            )
                        ]
                    )
                )
                operation = client.run_job(request=request)
                print(f"Triggered Cloud Run Job: {operation.operation.name}")
                return {"batch_id": batch_id, "message": "Batch started (Cloud Run Job)"}
                
            except Exception as job_err:
                print(f"Failed to trigger Cloud Run Job: {job_err}. Falling back to local.")
                # Fallback to local
                pass

        # Local Fallback
        background_tasks.add_task(run_batch_ingestion_worker, batch_id)
        return {"batch_id": batch_id, "message": "Batch started (Local Background Task)"}
        
    except Exception as e:
        print(f"Trigger Ingest Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/consulting/batches")
async def list_batches():
    try:
        db = get_firestore_client()
        docs = db.collection(BATCH_COLLECTION_NAME).order_by("created_at", direction=firestore.Query.DESCENDING).limit(20).stream()
        batches = [d.to_dict() for d in docs]
        return {"batches": batches}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/consulting/batches/{batch_id}")
async def get_batch_details(batch_id: str):
    try:
        db = get_firestore_client()
        batch = db.collection(BATCH_COLLECTION_NAME).document(batch_id).get().to_dict()
        items_ref = db.collection(RESULT_COLLECTION_NAME).where("batch_id", "==", batch_id).stream()
        items = [d.to_dict() for d in items_ref]
        items.sort(key=lambda x: (x.get("status") != "failed", x.get("filename")))
        return {"batch": batch, "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/batches/{batch_id}/retry")
async def retry_batch(batch_id: str, req: RetryBatchRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(retry_batch_worker, batch_id, req.item_ids)
    return {"message": "Retry started"}

@router.post("/consulting/batches/{batch_id}/cancel")
async def cancel_batch(batch_id: str):
    try:
        db = get_firestore_client()
        batch_ref = db.collection(BATCH_COLLECTION_NAME).document(batch_id)
        batch_ref.update({"status": "cancelling"})
        return {"message": "Cancellation requested"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Other Endpoints (Index, Collect, Polisher, etc.) ---

# tasks dict is local in-memory. 
tasks: Dict[str, Dict] = {}

async def add_log(task_id: str, message: str):
    if task_id in tasks:
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        tasks[task_id]["logs"].append(log_entry)
        await tasks[task_id]["queue"].put(log_entry)
        print(f"TASK[{task_id}]: {message}")

async def run_background_index_creation(task_id: str):
    try:
        await add_log(task_id, "Starting Index Creation...")
        await add_log(task_id, "This triggers 'gcloud firestore indexes composite create' command.")
        # Detect OS for command adjustment
        import platform
        is_windows = platform.system().lower() == "windows"
        gcloud_cmd = "gcloud.cmd" if is_windows else "gcloud"

        cmd = [
             gcloud_cmd, "firestore", "indexes", "composite", "create",
            "--quiet",
            "--project", PROJECT_ID,
            "--collection-group", FIRESTORE_COLLECTION_NAME,
            "--query-scope", "COLLECTION",
            "--field-config", 'field-path=embedding,vector-config={"dimension":1408,"flat":{}}'
        ]
        await add_log(task_id, f"Running: {' '.join(cmd)}")
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
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

@router.post("/consulting/index")
async def trigger_index(background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {"status": "running", "queue": asyncio.Queue(), "logs": []}
    background_tasks.add_task(run_background_index_creation, task_id)
    return {"task_id": task_id, "message": "Index creation started"}

@router.get("/consulting/tasks/{task_id}/stream")
async def stream_task_logs(task_id: str):
    if task_id not in tasks: raise HTTPException(status_code=404, detail="Task not found")
    async def event_generator():
        q = tasks[task_id]["queue"]
        while True:
            log_msg = await q.get()
            yield f"data: {json.dumps({'message': log_msg})}\n\n"
            if log_msg == "DONE" or "Critical Error" in log_msg: break
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/consulting/collect")
async def collect_data(req: CollectRequest, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {"status": "running", "queue": asyncio.Queue(), "logs": []}
    async def run_background_collection(task_id: str, source_type: str, content: Any):
        await add_log(task_id, f"Starting collection from {source_type}...")
        try:
            if source_type == 'url':
                filename = download_and_upload_worker(content)
                if filename: await add_log(task_id, f"Successfully collected {filename}")
                else: await add_log(task_id, f"Failed to collect from URL: {content}")
            await add_log(task_id, "Collection complete.")
        except Exception as e: await add_log(task_id, f"Collection error: {e}")
        finally: await add_log(task_id, "DONE")
    background_tasks.add_task(run_background_collection, task_id, 'url', req.url)
    return {"task_id": task_id, "message": "Task started"}

@router.post("/consulting/collect-file")
async def collect_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    try: content = await file.read()
    except Exception as e: raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")
    task_id = str(uuid.uuid4())
    tasks[task_id] = {"status": "running", "queue": asyncio.Queue(), "logs": []}
    async def run_background_collection(task_id: str, source_type: str, content: Any):
        await add_log(task_id, f"Starting collection from {source_type}...")
        try:
            if source_type == 'file_bytes':
                filename = f"uploaded_{uuid.uuid4()}.pdf"
                g_client = get_storage_client()
                bucket = g_client.bucket(GCS_BUCKET_NAME)
                blob = bucket.blob(f"consulting_raw/{filename}")
                blob.upload_from_string(content, content_type="application/pdf")
                await add_log(task_id, f"Successfully uploaded file: {filename}")
            await add_log(task_id, "Collection complete.")
        except Exception as e: await add_log(task_id, f"Collection error: {e}")
        finally: await add_log(task_id, "DONE")
    background_tasks.add_task(run_background_collection, task_id, 'file_bytes', content)
    return {"task_id": task_id, "message": "Task started"}

@router.post("/consulting/logic-mapper")
async def logic_mapper(req: LogicMapperRequest):
    try:
        vector = get_embedding(text=req.query)
        if not vector: return {"results": []}
        neighbors = search_vector_db(vector)
        results = []
        for n in neighbors:
            uri = n['id']
            url = generate_signed_url(uri)
            results.append({"url": url, "uri": uri, "score": n['score'], "metadata": n['metadata']})
        return {"results": results}
    except Exception as e:
        print(f"Logic Mapper Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/visual-search")
async def visual_search(req: VisualSearchRequest):
    try:
        image_bytes = base64.b64decode(req.image)
        vector = get_embedding(image_bytes=image_bytes)
        if not vector: return {"results": []}
        neighbors = search_vector_db(vector)
        results = []
        for n in neighbors:
            uri = n['id']
            url = generate_signed_url(uri)
            results.append({"url": url, "uri": uri, "score": n['score'], "metadata": n['metadata']})
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/slide-polisher")
async def slide_polisher(req: SlidePolisherRequest):
    try:
        client = get_genai_client()
        if not client: raise Exception("GenAI client not initialized")
        contents = ["You are an expert McKinsey/BCG consultant slide designer.",
                    "Your task is to take the user's content and generate a beautiful, modern, professional HTML/Tailwind slide representation.",
                    "Return ONLY the HTML code for a <div> that represents the slide (aspect ratio 16:9). Use Tailwind CSS for styling. Do not include <html> or <body> tags, just the inner content.",
                    "The background should be white or very light gray."]
        if req.text: contents.append(f"Content Constraints: {req.text}")
        if req.image:
             image_bytes = base64.b64decode(req.image)
             contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))
             contents.append("Refine the layout of this slide sketch/draft.")
        response = client.models.generate_content(model="gemini-1.5-pro-002", contents=contents)
        html_content = response.text
        if html_content.startswith("```html"): html_content = html_content.replace("```html", "").replace("```", "")
        elif html_content.startswith("```"): html_content = html_content.replace("```", "")
        return {"html": html_content}
    except Exception as e:
        print(f"Polisher Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/consulting/files/{filename}/pages")
async def list_file_pages(filename: str):
    try:
        db = get_firestore_client()
        collection = db.collection(FIRESTORE_COLLECTION_NAME)
        docs = collection.where("filename", "==", filename).stream()
        results = []
        for doc in docs:
            d = doc.to_dict()
            results.append({"id": doc.id, "page_number": d.get("page_number"), "structure_type": d.get("structure_type"), "key_message": d.get("key_message"), "description": d.get("description"), "uri": d.get("uri"), "created_at": d.get("created_at")})
        if not results and not filename.startswith("consulting_raw/"):
             alt_filename = f"consulting_raw/{filename}"
             docs_alt = collection.where("filename", "==", alt_filename).stream()
             for doc in docs_alt:
                d = doc.to_dict()
                results.append({"id": doc.id, "page_number": d.get("page_number"), "structure_type": d.get("structure_type"), "key_message": d.get("key_message"), "description": d.get("description"), "uri": d.get("uri"), "created_at": d.get("created_at")})
        results.sort(key=lambda x: x["page_number"] or 0)
        return {"pages": results}
    except Exception as e:
        print(f"List Pages Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
#  MTG Review Endpoints (Video/Audio Upload)
# ==========================================

@router.get("/consulting/upload-url")
def get_consulting_upload_url(filename: str, content_type: Optional[str] = "video/mp4"):
    """
    Generates a PUT Signed URL for uploading directly to GCS (Shared/Similar to English Review).
    """
    # Use the same bucket as English Review or a new one?
    # Provided instructions imply similar structure. Let's reuse GCS_BUCKET_NAME env if available,
    # OR reuse the ENGLISH review bucket if not specifically separate.
    # The existing GCS_BUCKET_NAME in this file seems to be loaded from 'GCS_BUCKET_NAME'.
    # Check if we should use a specific one for consulting review. 
    # Let's use the one imported as GCS_BUCKET_NAME (consulting-specific likely).
    
    if not GCS_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME not configured")
    
    try:
        # Generate with Standard Storage Client
        # Note: If running on Cloud Run, default credentials should    try:
        # Check for service account key in env (Shared/Similar to English Review)
        # This is CRITICAL for signing URLs on Cloud Run where ADC doesn't provide a private key suitable for signing
        service_account_info_str = os.getenv("SERVICE_ACCOUNT_KEY")
        if service_account_info_str:
            try:
                print("DEBUG: using SERVICE_ACCOUNT_KEY from env for Consulting Upload")
                # Handle potential quoting issues if raw json was stringified weirdly
                if service_account_info_str.startswith("'") and service_account_info_str.endswith("'"):
                     service_account_info_str = service_account_info_str[1:-1]
                
                info = json.loads(service_account_info_str)
                creds = service_account.Credentials.from_service_account_info(info)
                # Create a specific client with these creds
                current_storage_client = storage.Client(project=PROJECT_ID, credentials=creds)
                bucket = current_storage_client.bucket(GCS_BUCKET_NAME)
            except Exception as json_e:
                print(f"Warning: Failed to parse SERVICE_ACCOUNT_KEY: {json_e}")
                # Fallback to default
                g_client = get_storage_client()
                bucket = g_client.bucket(GCS_BUCKET_NAME)
        else:
             g_client = get_storage_client()
             bucket = g_client.bucket(GCS_BUCKET_NAME)

        unique_name = f"consulting_uploads/{uuid.uuid4()}_{filename}"
        blob = bucket.blob(unique_name)
        
        url = blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(minutes=15),
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


@router.post("/consulting/review", response_model=ConsultingReviewTask)
async def create_consulting_review(req: ConsultingReviewCreateRequest):
    """
    Analyzes an uploaded MTG audio/video file and provides feedback for Mr. Ushikoshi.
    """
    try:
        print(f"DEBUG: Processing Consulting Review for {req.gcs_path}")
        
        client = get_genai_client()
        
        # 1. Create Part from GCS URI
        # Auto-detect mime-type roughly
        mime_type = "video/mp4" # Default fallback
        path_lower = req.media_filename.lower()
        if path_lower.endswith(".mp3"): mime_type = "audio/mpeg"
        elif path_lower.endswith(".wav"): mime_type = "audio/wav"
        elif path_lower.endswith(".m4a"): mime_type = "audio/mp4"
        elif path_lower.endswith(".aac"): mime_type = "audio/aac"
        elif path_lower.endswith(".amr"): mime_type = "audio/amr"
        elif path_lower.endswith(".mov"): mime_type = "video/quicktime"
        elif path_lower.endswith(".webm"): mime_type = "video/webm"
        elif path_lower.endswith(".3gp"): mime_type = "video/3gpp"
        elif path_lower.endswith(".mkv"): mime_type = "video/x-matroska"
        elif path_lower.endswith(".avi"): mime_type = "video/x-msvideo"
        
        part = types.Part.from_uri(file_uri=req.gcs_path, mime_type=mime_type)
        
        # 2. Define Prompt for Ushikoshi-san
        # Background: Data/AI Consultant in MTG. User is "Ushikoshi".
        # Feedback: Corrections, Additional Info, Manner, Good/Bad remarks (Only for Ushikoshi).
        # Constraint: Concise, Source URLs required.
        
        prompt = """
        あなたはData・AI領域の専門コンサルタントチームの長です。
        添付の音声/動画は、「牛越（うしこし）」さん（あなたの部下、またはレビュー対象者）が参加しているMTGの記録です。
        
        このMTGの内容を分析し、牛越さんの今後の業務改善に役立つフィードバックをMarkdown形式で作成してください。
        
        ## 制約事項
        1. **「牛越」さんの発言・行動のみ** にフォーカスしてフィードバックを行ってください（他者の発言への批評は不要）。
        2. 短時間で確認できるよう、**簡潔に** まとめてください（些末な内容は省略）。
        3. 情報の訂正や追加情報には、**必ず信頼できるソースURL** を付記してください。
        4. 間違った内容や不明確な指摘は絶対にしないでください。
        
        ## 出力フォーマット
        
        ### 1. 情報の訂正 (Corrections)
        * 会議で出た情報に誤りがある場合、正しい情報とソースを提示してください。
          * **誤**: (発言内容) -> **正**: (正しい情報) [Source URL]
        * 該当なしの場合は「特になし」としてください。

        ### 2. 知っておくべき追加情報 (Additional Insights)
        * 議論の内容に関連して、知っておくと有利になる追加情報（最新のAIトレンド、技術仕様など）を提示してください。
        * 必ずソースを付けてください。
          * (情報内容) [Source URL]

        ### 3. MTGの進め方・話し方 (Communication Style)
        * 牛越さんのファシリテーション、説明の仕方、質問の仕方で改善すべき点。
        
        ### 4. 発言レビュー (Remarks Review)
        * **Good**: 牛越さんの良かった発言（論理的、的確、価値ある貢献など）。
        * **Bad/Improvement**: 改善すべき発言、または「こう言った方がよかった」という追加すべきだった発言。
        
        """
        
        response = await client.aio.models.generate_content(
            model="gemini-3-flash-preview", 
            contents=[prompt, part],
            config=types.GenerateContentConfig(
                response_modalities=["TEXT"]
            )
        )
        
        feedback_content = response.text
        
        # 4. Save to Firestore
        db = get_firestore_client()
        doc_ref = db.collection("consulting_review").document()
        
        task = ConsultingReviewTask(
            id=doc_ref.id,
            media_filename=req.media_filename,
            feedback=feedback_content,
            created_at=datetime.datetime.now()
        )
        
        doc_ref.set(task.dict())
        
        return task

    except Exception as e:
        print(f"Consulting Review Error: {e}")
        # traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Review Analysis Failed: {str(e)}")


@router.get("/consulting/review", response_model=List[ConsultingReviewTask])
def get_consulting_reviews(db: firestore.Client = Depends(get_firestore_client)):
    try:
        docs = db.collection("consulting_review").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
        tasks = []
        for d in docs:
            data = d.to_dict()
            # Migration: handle legacy status if needed
            if isinstance(data.get("status"), str):
                 if data["status"] == "DONE":
                     data["status"] = 2
                 else:
                     data["status"] = 0
            tasks.append(ConsultingReviewTask(**data))
        return tasks
    except Exception as e:
        print(f"Get Reviews Error: {e}")
        return []

@router.patch("/consulting/review/{task_id}/status")
def update_consulting_review_status(task_id: str, status: int, db: firestore.Client = Depends(get_firestore_client)):
    doc_ref = db.collection("consulting_review").document(task_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
    doc_ref.update({"status": status})
    return {"status": "updated", "new_status": status}

@router.delete("/consulting/review/{task_id}")
def delete_consulting_review(task_id: str, db: firestore.Client = Depends(get_firestore_client)):
    db.collection("consulting_review").document(task_id).delete()
    return {"status": "deleted"}

# ==========================================
#  MTG SME Endpoints (Live API WebSocket)
# ==========================================


@router.websocket("/consulting/sme/ws")
async def consulting_sme_websocket(websocket: WebSocket):
    await websocket.accept()
    print("DEBUG: SME WebSocket connected (Live API: Audio+Transcript Mode)", flush=True)

    # Use Direct GenAI Client (Fix for 1007 Error)
    # Using same pattern as working roleplay.py
    client = genai.Client(
        vertexai=True,
        project=os.getenv("PROJECT_ID"),
        location=os.getenv("LOCATION", "us-central1"),
        http_options={'api_version': 'v1beta1'}
    )

    # Model Configuration
    # verified working model for Live API connection & transcription
    MODEL_NAME = "gemini-live-2.5-flash-preview-native-audio-09-2025" 
    
    try:
        # 1. Initial Handshake / Setup
        init_data = await websocket.receive_json() 
        print(f"DEBUG: SME Setup data: {init_data}", flush=True)

        system_instruction = """
        You are an expert SME (Subject Matter Expert) listening to a meeting.
        Your role is to strictly observe and Only speak up to correct factual mistakes or provide critical missing context.
        Most of the time, you should remain silent.
        If you speak, be concise and factual.
        Output MUST be in Japanese.
        """

        # Context Integration
        if init_data.get("type") == "setup":
             context = init_data.get("context", {})
             if context.get("topic"):
                 system_instruction += f"\n\nTopic: {context['topic']}"

        # 2. Live API Connection Loop (KeepAlive)
        while True:
            try:
                print(f"{datetime.datetime.now()} DEBUG: Connecting to Live API {MODEL_NAME}...", flush=True)
                
                config = types.LiveConnectConfig(
                    response_modalities=["AUDIO"], # Model requires AUDIO modality
                    system_instruction=types.Content(parts=[types.Part(text=system_instruction)]),
                    # Key Feature: Enable Transcription to get text output from the Audio model
                    # This allows us to receive text almost simultaneously with audio.
                    # We will DISCARD the audio and only send the text to the user as requested.
                    output_audio_transcription=types.AudioTranscriptionConfig(),
                    # Enable session resumption for stability (same as roleplay.py)
                    session_resumption=types.SessionResumptionConfig(transparent=True)
                )

                async with client.aio.live.connect(model=MODEL_NAME, config=config) as session:
                    print(f"{datetime.datetime.now()} DEBUG: Connected to Gemini Live API!", flush=True)
                    
                    # 3. Concurrent Handling: Send (Audio) & Receive (Transcript)
                    print(f"{datetime.datetime.now()} DEBUG: Starting bidirectional loops...", flush=True)


                    # 3. Concurrent Handling: Send (Audio) & Receive (Transcript)
                    
                    async def send_audio_loop():
                        print(f"{datetime.datetime.now()} DEBUG: send_audio_loop started", flush=True)
                        try:
                            while True:
                                msg = await websocket.receive_json()
                                if "audio" in msg:
                                    # Frontend sends base64 PCM/WAV
                                    data = base64.b64decode(msg["audio"])
                                    
                                    # Use send_realtime_input for low-latency audio streaming
                                    # Wrap in types.Blob as required by the SDK
                                    # Frontend provides PCM 16kHz usually
                                    await session.send_realtime_input(
                                        media=types.Blob(data=data, mime_type="audio/pcm;rate=16000")
                                    )
                        except WebSocketDisconnect:
                            print("DEBUG: Client disconnected from send loop", flush=True)
                            raise # Re-raise to signal exit
                        except Exception as e:
                            print(f"DEBUG: Send Loop Error: {e}", flush=True)
                            # raise # Optional: Raise to restart session?
                        finally:
                            print(f"{datetime.datetime.now()} DEBUG: send_audio_loop finished", flush=True)
                    
                    async def receive_response_loop():
                        print(f"{datetime.datetime.now()} DEBUG: receive_response_loop started", flush=True)
                        transcript_buffer = ""
                        try:
                            async for response in session.receive():
                                server_content = response.server_content
                                if not server_content:
                                    continue

                                # Extract Transcription (The "Text" output)
                                if hasattr(server_content, "output_transcription") and server_content.output_transcription:
                                    part = server_content.output_transcription.text
                                    if part:
                                        transcript_buffer += part
                                
                                # Only send when the turn is complete to avoid fragmented UI bubbles
                                if server_content.turn_complete:
                                    if transcript_buffer.strip():
                                        print(f"DEBUG: SME Transcript (Complete): {transcript_buffer}", flush=True)
                                        await websocket.send_json({"text": transcript_buffer})
                                    transcript_buffer = "" # Reset buffer
                                    
                        except Exception as e:
                            print(f"{datetime.datetime.now()} DEBUG: Receive Loop Error: {e}", flush=True)
                            traceback.print_exc()
                        else:
                            print(f"{datetime.datetime.now()} DEBUG: session.receive() iterator exhausted naturally.", flush=True)
                        finally:
                            print(f"{datetime.datetime.now()} DEBUG: receive_response_loop finished (Session Context Exited?)", flush=True)
                            # If receive loop finishes, the session is seemingly over.
                            # We should probably notify the client or just let the ws close.

                    # Run loops
                    # When send_audio_loop finishes (disconnect), we should cancel receive_loop
                    send_task = asyncio.create_task(send_audio_loop())
                    receive_task = asyncio.create_task(receive_response_loop())
                    
                    print("DEBUG: Waiting for tasks...", flush=True)
                    done, pending = await asyncio.wait(
                        [send_task, receive_task], 
                        return_when=asyncio.FIRST_COMPLETED
                    )
                    print(f"DEBUG: Tasks completed. Done: {len(done)}, Pending: {len(pending)}", flush=True)
                    
                    for task in pending:
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass
                    
                    # Check exit condition
                    if send_task in done:
                         # Client disconnected or error -> Exit
                         try:
                             send_task.result() # Log exception if any
                         except WebSocketDisconnect:
                             print("DEBUG: Client websocket disconnected. Exiting loop.")
                             break
                         except Exception as e:
                             print(f"DEBUG: Client send loop error: {e}. Exiting.")
                             break
                         
                         print("DEBUG: Send task finished without exception (strange). Exiting.")
                         break

                    if receive_task in done:
                         print("DEBUG: Gemini receive loop ended. Reconnecting session...", flush=True)
                         # Continue to next iteration of while True -> Reconnect
                         await asyncio.sleep(0.1) # Small delay
            
            except Exception as e:
                print(f"Gemini Live Connection Error: {e}")
                traceback.print_exc()
                print("DEBUG: Retrying connection in 1s...")
                await asyncio.sleep(1)

    except Exception as e:
        print(f"SME WebSocket Error: {e}")
        traceback.print_exc()
        try:
            await websocket.send_json({"error": f"Server Error: {str(e)}"})
        except:
            pass
    finally:
        await websocket.close()

