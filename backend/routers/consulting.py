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
import time
import warnings
import subprocess
import io

# Suppress Vertex AI SDK deprecation warning
warnings.filterwarnings("ignore", category=UserWarning, module="vertexai._model_garden._model_garden_models")
warnings.filterwarnings("ignore", category=UserWarning, module="vertexai.vision_models._vision_models")

from fastapi.responses import StreamingResponse
from google.genai import types
from google.cloud import firestore

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
async def list_files(max_results: int = 100, page_token: Optional[str] = None):
    """Lists PDF files in the consulting_raw directory with pagination."""
    try:
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        blobs_iter = bucket.list_blobs(prefix="consulting_raw/", max_results=max_results, page_token=page_token)
        
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
        cmd = [
            "gcloud", "firestore", "indexes", "composite", "create",
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
        response = client.models.generate_content(model="gemini-3-pro-preview", contents=contents)
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
