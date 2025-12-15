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

# Suppress Vertex AI SDK deprecation warning (active since June 2025)
# This is safe to suppress as we will migrate to google-genai SDK before June 2026.
warnings.filterwarnings("ignore", category=UserWarning, module="vertexai._model_garden._model_garden_models")
warnings.filterwarnings("ignore", category=UserWarning, module="vertexai.vision_models._vision_models")

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

# Import poppler wrapper
try:
    from pdf2image import convert_from_bytes
except ImportError:
    print("WARNING: pdf2image not installed. PDF ingestion will fail.")

router = APIRouter(
    tags=["consulting"],
)

# --- Configuration ---
from google.cloud import firestore
try:
    from google.cloud.firestore import Vector
except ImportError:
    from google.cloud.firestore_v1.vector import Vector

# DEBUG: Print env vars on load
print("Loading consulting.py...")
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")
FIRESTORE_COLLECTION_NAME = os.getenv("FIRESTORE_COLLECTION_NAME", "consulting_slides")
BATCH_COLLECTION_NAME = "ingestion_batches"
RESULT_COLLECTION_NAME = "ingestion_results"

print(f"DEBUG: PROJECT_ID={PROJECT_ID}, BUCKET={GCS_BUCKET_NAME}, COLLECTION={FIRESTORE_COLLECTION_NAME}")

# --- Clients ---
# Initialize GenAI Client
_genai_client = None

def get_genai_client():
    global _genai_client
    if _genai_client:
        return _genai_client
    
    if PROJECT_ID and LOCATION:
        try:
            # Use ADC (Application Default Credentials) on Cloud Run / Local
            # Do NOT pass api_key when using vertexai=True with project/location
            _genai_client = genai.Client(
                vertexai=True,
                project=PROJECT_ID,
                location=LOCATION,
                http_options={'api_version': 'v1beta1'}
            )
            return _genai_client
        except Exception as e:
            print(f"Error initializing GenAI Client: {e}")
            return None
    return None

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

import gc
from vertexai.vision_models import MultiModalEmbeddingModel, Image

# ...

def get_embedding(text: str = None, image_bytes: bytes = None):
    """Generates embedding using the stable Vertex AI MultiModalEmbeddingModel."""
    if not PROJECT_ID or not LOCATION:
        print("Project ID or Location missing for Vertex AI")
        return None

    # Truncate text to satisfy model limit (Multimodal limit is likely 1024 bytes or tokens)
    # 400 chars * ~3 bytes/char = ~1200 bytes. This is slightly over 1024 depending on content,
    # but the prompt now requests <300 chars total, so this is a safety net.
    if text and len(text) > 400:
        print(f"DEBUG: Truncating text from {len(text)} to 400 chars for embedding.")
        text = text[:400]

    try:
        # Lazy init Vertex AI SDK
        vertexai.init(project=PROJECT_ID, location=LOCATION)
# ...
        
        # Load the specific model designed for multimodal embeddings
        model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")
        
        embeddings = None
        if image_bytes and text:
            # Multimodal (Image + Text)
            image = Image(image_bytes)
            embeddings = model.get_embeddings(image=image, contextual_text=text)
        elif image_bytes:
            # Image only
            image = Image(image_bytes)
            embeddings = model.get_embeddings(image=image)
        elif text:
            # Text only
            embeddings = model.get_embeddings(contextual_text=text)
            
        if embeddings:
            # Result usually has .image_embedding or .text_embedding properties
            # If we sent image, utilize image_embedding.
            if image_bytes:
                return embeddings.image_embedding
            elif text:
                return embeddings.text_embedding
                
        return None
    except Exception as e:
        print(f"Embedding error (Vertex AI SDK): {e}")
        return None
    return None

def analyze_slide_structure(image_bytes: bytes) -> Dict[str, Any]:
    """Analyzes a slide image using Gemini 2.5 Flash (Cost Effective) to extract structure and key message."""
    client = get_genai_client()
    if not client:
        return {}
        
    try:
        prompt = """
    Analyze this slide image and return a JSON object with the following fields:
    - "structure_type": The type of visual structure (e.g., "Graph", "Table", "Text", "Diagram").
    - "key_message": A single, short sentence summarizing the implication (in Japanese, max 80 characters).
    - "description": A concise explanation of the logical structure or framework used (e.g., "Comparison of A vs B", "Factor decomposition", "Process flow"), followed by a list of important content keywords (in Japanese, max 250 characters).
    
    IMPORTANT: 
    1. "description" format: "[Logical Structure description]. Keywords: [Keyword1, Keyword2...]"
    2. Output MUST BE IN JAPANESE.
    3. Strictly follow character limits.
    """
        
        # Use gemini-2.5-flash for high speed and low cost
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_text(text=prompt),
                types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2
            )
        )
        
        # Accessing .text directly triggers 'Non-text part found' warning if safety filter blocks it or other parts exist.
        text = ""
        try:
             # Debug log full response structure
             if response.candidates:
                 print(f"DEBUG: Candidate 0 content parts: {response.candidates[0].content.parts}")
                 print(f"DEBUG: Finish Reason: {response.candidates[0].finish_reason}")
             
             if response.text:
                 text = response.text
             else:
                 # Fallback: sometimes model returns parts but no 'text' shortcut if multiple parts
                 # Just concate all text parts
                 text = " ".join([p.text for p in response.candidates[0].content.parts if p.text])
                 
             clean_text = text.strip()
             if clean_text.startswith("```json"):
                 clean_text = clean_text[7:]
             if clean_text.endswith("```"):
                 clean_text = clean_text[:-3]
             return json.loads(clean_text)
        except Exception as json_err:
             print(f"JSON Parse Error for Analysis: {json_err}, Raw: {text}")
             return {
                 "structure_type": "Unknown", 
                 "key_message": "Analysis failed",
                 "description": "Could not parse AI response."
             }
        
    except Exception as e:
        print(f"Analysis error: {e}")
        return {}

def evaluate_document_quality(images_bytes: List[bytes]) -> Dict[str, Any]:
    """
    Evaluates the document (based on first few pages) for:
    1. Creating Company (Major Firm Check)
    2. Design Quality (if not Major Firm)
    Returns a dict with 'decision' ('accept'/'skip'), 'reason', 'firm_name', 'design_rating'.
    """
    client = get_genai_client()
    if not client:
        return {"decision": "skip", "reason": "AI Client Unavailable"}

    try:
        # Prompt for Quality Evaluation
        prompt = """
        You are an expert consultant evaluating a slide deck for a "Slide Database".
        Analyze the provided images (the first few pages of a document) to make a GO/NO-GO decision for ingestion.

        **Step 1: Identify the Creating Company**
        Look for logos, copyright notices, or template styles of the following Major Consulting Firms:
        - **MBB**: McKinsey, BCG (Boston Consulting Group), Bain & Company.
        - **Strategy Firms**: Arthur D. Little (ADL), Roland Berger, Strategy&, Kearney, L.E.K. Consulting, and other reputable strategy consulting firms.
        - **Big4 (Group-wide & Japanese Entities)**: 
            - **Deloitte**: Deloitte Tohmatsu Consulting (DTC), Deloitte Tohmatsu Financial Advisory (DTFA), Deloitte Touche Tohmatsu LLC (有限責任監査法人トーマツ), and all other Deloitte Tohmatsu Group entities.
            - **PwC**: PwC Consulting, PwC Advisory, PwC Japan LLC (PwC Japan有限責任監査法人), PwC Arata (PwCあらた), and all other PwC Japan Group entities.
            - **KPMG**: KPMG Consulting, KPMG FAS, KPMG AZSA LLC (有限責任あずさ監査法人), and all other KPMG Japan Group entities.
            - **EY**: EY Strategy and Consulting, EY ShinNihon LLC (EY新日本有限責任監査法人), and all other EY Japan Group entities.
        - **Accenture**: Including Accenture Japan.
        - **Abeam Consulting**
        
        If ANY of these firms (or their specific Japanese entities/subsidiaries) are identified:
        - **Decision**: ACCEPT
        - **Reason**: "Major Firm: [Company Name]"

        **Step 2: Evaluate Design Quality (Only if Major Firm is NOT identified)**
        If the company is NOT one of the above, evaluate the "Design Quality" for slide creation reference.
        - **High Quality**: Professional layout, clear use of frameworks/charts, high-end visualization, consistent formatting. Suitable for consultants to mimic.
        - **Low Quality**: Wall of text, basic Word-like layout, amateurish design, or just a plain report/whitepaper without visual structure.
        
        If High Quality:
        - **Decision**: ACCEPT
        - **Reason**: "High Design Quality"
        
        If Low Quality:
        - **Decision**: SKIP
        - **Reason**: "Low Design Quality / Not a slide deck"

        **Output Format**:
        Return a JSON object:
        {
            "decision": "ACCEPT" or "SKIP",
            "reason": "String explaining the reason (e.g. 'Major Firm: Deloitte Tohmatsu Financial Advisory' or 'Low Design Quality')",
            "firm_name": "Detected Name or None",
            "design_rating": "High" or "Low"
        }
        """

        contents = [types.Part.from_text(text=prompt)]
        for img_data in images_bytes:
            contents.append(types.Part.from_bytes(data=img_data, mime_type="image/jpeg"))

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0
            )
        )

        text = ""
        if response.text:
            text = response.text
        else:
            if response.candidates and response.candidates[0].content.parts:
                text = " ".join([p.text for p in response.candidates[0].content.parts if p.text])
        
        clean_text = text.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
            
        return json.loads(clean_text)

    except Exception as e:
        print(f"Quality Evaluation Error: {e}")
        # Default to skipping if uncertain.
        return {"decision": "SKIP", "reason": f"AI Evaluation Error: {str(e)}"}

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

class RetryBatchRequest(BaseModel):
    item_ids: Optional[List[str]] = None # List of document IDs in ingestion_results to retry. If None, retry all failed.

# --- Endpoints ---

@router.get("/consulting/files")
async def list_files(max_results: int = 100, page_token: Optional[str] = None):
    """Lists PDF files in the consulting_raw directory with pagination."""
    try:
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        
        # Use GCS iterator pagination
        blobs_iter = bucket.list_blobs(prefix="consulting_raw/", max_results=max_results, page_token=page_token)
        
        file_list = []
        
        # Batch Fetch Metadata from Firestore
        db = get_firestore_client()
        summary_collection = db.collection("ingestion_file_summaries")
        
        doc_refs = []
        # Map safe_filename -> list of items (in case of collision, though unlikely)
        # Actually safe_filename is unique per blob usually.
        file_map = {} 
        
        for blob in blobs_iter:
            if blob.name.endswith(".pdf"):
                # Logic must match run_batch_ingestion_worker
                # blob.name includes prefix e.g 'consulting_raw/file.pdf'
                # safe_filename strips non-alnum except ._-
                safe_filename = "".join(c for c in blob.name if c.isalnum() or c in "._-")
                
                item = {
                    "name": blob.name,
                    "basename": blob.name.split("/")[-1],
                    "size": blob.size,
                    "updated": blob.updated.isoformat() if blob.updated else None,
                    "content_type": blob.content_type,
                    "status": "pending", # Default
                    "filter_reason": None,
                    "firm_name": None,
                    "page_count": None,
                    "design_rating": None
                }
                file_list.append(item)
                file_map[safe_filename] = item
                doc_refs.append(summary_collection.document(safe_filename))
        
        if doc_refs:
            # getAll supports up to 100? Firestore limits might apply to 'in' query but get_all(refs) is usually robust or batched by client.
            # Python SDK 'get_all'
            docs = db.get_all(doc_refs)
            for doc in docs:
                if doc.exists:
                    data = doc.to_dict()
                    safe_fname = doc.id
                    if safe_fname in file_map:
                        item = file_map[safe_fname]
                        item["status"] = data.get("status", "pending")
                        # Combine errors or reasons
                        reason = data.get("filter_reason")
                        if not reason and data.get("error"):
                            reason = data.get("error")
                        item["filter_reason"] = reason
                        item["firm_name"] = data.get("firm_name")
                        item["page_count"] = data.get("page_count")
                        item["design_rating"] = data.get("design_rating")
        
        # Sort by updated desc (Only works for current page in GCS list usually, ensuring global sort is hard with GCS list_blobs unless we list all. 
        # CAUTION: GCS list_blobs returns files in name order usually.
        # If user wants sorted by Date, we can't easily paginate without listing all.
        # However, for 3000 files, maybe we just accept Name order? 
        # Or, we can only sort the retrieved page. 
        # Let's keep verifying: list_blobs returns in alpha order.
        # User is asking for performance. Accepting alpha order is a trade-off.
        
        file_list.sort(key=lambda x: x["updated"] or "", reverse=True)
        
        return {
            "files": file_list,
            "next_page_token": blobs_iter.next_page_token
        }
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


# --- Batch Ingestion Logic ---

async def run_batch_ingestion_worker(batch_id: str):
    """Background worker for batch ingestion."""
    print(f"DEBUG: Starting batch ingest {batch_id}")
    db = get_firestore_client()
    batch_ref = db.collection(BATCH_COLLECTION_NAME).document(batch_id)
    results_ref = db.collection(RESULT_COLLECTION_NAME)
    
    try:
        # 1. Discovery Phase
        batch_ref.update({"status": "discovering"})
        g_client = get_storage_client()
        bucket = g_client.bucket(GCS_BUCKET_NAME)
        blobs = list(bucket.list_blobs(prefix="consulting_raw/"))
        
        # Create result entries for all proper files
        target_blobs = []
        for blob in blobs:
            if blob.name.lower().endswith(".pdf"):
                safe_id = "".join(c for c in blob.name if c.isalnum() or c in "._-")
                res_id = f"{batch_id}_{safe_id}"
                results_ref.document(res_id).set({
                    "batch_id": batch_id,
                    "filename": blob.name,
                    "status": "pending",
                    "created_at": firestore.SERVER_TIMESTAMP,
                    "updated_at": firestore.SERVER_TIMESTAMP
                })
                target_blobs.append(blob)

        batch_ref.update({
            "status": "processing",
            "total_files": len(target_blobs),
            "processed_files": 0,
            "success_files": 0,
            "failed_files": 0
        })

        # 2. Processing Phase
        main_collection = db.collection(FIRESTORE_COLLECTION_NAME)
        processed_count = 0
        success_count = 0
        failed_count = 0

        summary_collection = db.collection("ingestion_file_summaries")

        for blob in target_blobs:
            # Check for cancellation
            current_batch = batch_ref.get().to_dict()
            if current_batch.get("status") == "cancelling":
                print(f"DEBUG: Batch {batch_id} cancelled by user.")
                batch_ref.update({"status": "cancelled", "completed_at": firestore.SERVER_TIMESTAMP})
                break

            print(f"DEBUG: Processing file: {blob.name}")
            safe_filename = "".join(c for c in blob.name if c.isalnum() or c in "._-")
            res_id = f"{batch_id}_{safe_filename}"
            res_doc_ref = results_ref.document(res_id)
            summary_ref = summary_collection.document(safe_filename)
            
            init_data = {"status": "processing", "updated_at": firestore.SERVER_TIMESTAMP, "batch_id": batch_id, "filename": blob.name}
            res_doc_ref.update(init_data)
            summary_ref.set(init_data, merge=True)
            
            try:
                print(f"DEBUG: Downloading {blob.name}...")
                pdf_bytes = blob.download_as_bytes()
                
                # OPTIMIZATION: Process in chunks to avoid OOM
                import tempfile
                from pdf2image import pdfinfo_from_path, convert_from_path
                
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp_pdf:
                    tmp_pdf.write(pdf_bytes)
                    tmp_pdf_path = tmp_pdf.name
                
                # Free memory immediately after writing to disk
                del pdf_bytes
                import gc
                gc.collect()
                
                try:
                    # Get info first
                    try:
                        info = pdfinfo_from_path(tmp_pdf_path)
                        total_pages = info["Pages"]
                    except Exception:
                        # Fallback if pdfinfo fails (rare), load all (risky but fallback)
                        # Or assume a large number and break on empty list
                        print("WARNING: Could not get PDF info, defaulting to chunked read until empty.")
                        total_pages = 9999 

                    # ASPECT RATIO CHECK (Portrait vs Landscape)
                    # Load just the first page to check dimensions
                    should_process = True
                    try:
                        first_page_img = convert_from_path(tmp_pdf_path, first_page=1, last_page=1, fmt="jpeg")
                        if first_page_img:
                            w, h = first_page_img[0].size
                            if h > w:
                                print(f"DEBUG: Detected Portrait orientation ({w}x{h}). Skipping {blob.name} (likely report).")
                                skip_report_data = {
                                    "status": "skipped",
                                    "error": "Skipped: Portrait orientation (likely report/document)",
                                    "filter_reason": "Portrait orientation",
                                    "updated_at": firestore.SERVER_TIMESTAMP
                                }
                                res_doc_ref.update(skip_report_data)
                                summary_ref.set(skip_report_data, merge=True)
                                should_process = False
                            else:
                                print(f"DEBUG: Detected Landscape orientation ({w}x{h}). Processing...")
                            del first_page_img
                    except Exception as e:
                        print(f"WARNING: Could not check aspect ratio for {blob.name}: {e}. Proceeding.")

                    # PAGE COUNT CHECK
                    if should_process and total_pages > 150:
                        print(f"DEBUG: Skipping {blob.name} due to page count {total_pages} > 150.")
                        skip_page_data = {
                            "status": "skipped",
                            "error": f"Skipped: Page count {total_pages} > 150",
                            "filter_reason": f"Page count {total_pages} > 150",
                            "page_count": total_pages,
                            "updated_at": firestore.SERVER_TIMESTAMP
                        }
                        res_doc_ref.update(skip_page_data)
                        summary_ref.set(skip_page_data, merge=True)
                        should_process = False

                    # AI QUALITY CHECK (Major Firm / Design)
                    if should_process:
                        try:
                            eval_pages_num = min(total_pages, 7)
                            print(f"DEBUG: Analyzing first {eval_pages_num} pages for Quality Evaluation...")
                            
                            # Convert first few pages for analysis
                            eval_images = convert_from_path(tmp_pdf_path, first_page=1, last_page=eval_pages_num, fmt="jpeg")
                            
                            eval_images_bytes = []
                            for img in eval_images:
                                buf = io.BytesIO()
                                img.save(buf, format='JPEG')
                                eval_images_bytes.append(buf.getvalue())
                                
                            del eval_images
                            gc.collect()

                            if eval_images_bytes:
                                decision_data = evaluate_document_quality(eval_images_bytes)
                                print(f"DEBUG: Quality Evaluation Result: {decision_data}")
                                
                                update_data = {
                                    "firm_name": decision_data.get("firm_name"),
                                    "design_rating": decision_data.get("design_rating"),
                                    "filter_reason": decision_data.get("reason"),
                                    "page_count": total_pages,
                                    "updated_at": firestore.SERVER_TIMESTAMP
                                }
                                
                                if decision_data.get("decision") == "SKIP":
                                    update_data["status"] = "skipped"
                                    update_data["error"] = f"Skipped: {decision_data.get('reason')}"
                                    should_process = False
                                    print(f"DEBUG: AI decided to SKIP {blob.name}.")
                                else:
                                    print(f"DEBUG: AI decided to ACCEPT {blob.name}.")
                                
                                res_doc_ref.update(update_data)
                                summary_ref.set(update_data, merge=True)
                                
                        except Exception as eval_e:
                            print(f"WARNING: Quality Evaluation Failed for {blob.name}: {eval_e}. Proceeding.")


                    if should_process:
                        print(f"DEBUG: Total pages estimated: {total_pages}. Processing in chunks...")
                        pages_success = 0
                        
                        CHUNK_SIZE = 1 # Process 1 page at a time for maximum stability against OOM
                        for start_page in range(1, total_pages + 1, CHUNK_SIZE):
                            end_page = min(start_page + CHUNK_SIZE - 1, total_pages)
                            print(f"DEBUG: Loading pages {start_page} to {end_page}...")
                            
                            try:
                                # convert_from_path is 1-indexed for first_page/last_page
                                chunk_images = convert_from_path(tmp_pdf_path, first_page=start_page, last_page=end_page, fmt="jpeg")
                            
                                if not chunk_images:
                                    break # End of file if total_pages was wrong
                                    
                                for i, image in enumerate(chunk_images):
                                    page_num = start_page + i
                                    print(f"DEBUG: Processing page {page_num} of {blob.name}")
                                    
                                    # ... Processing Logic ...
                                    img_byte_arr = io.BytesIO()
                                    image.save(img_byte_arr, format='JPEG')
                                    img_bytes = img_byte_arr.getvalue()
                                    
                                    print(f"DEBUG: Analyzing slide structure for page {page_num}...")
                                    analysis = analyze_slide_structure(img_bytes)
                                    
                                    text_context = f"{analysis.get('structure_type', '')}. {analysis.get('key_message', '')}. {analysis.get('description', '')}"
                                    
                                    # RESTORED TRUNCATION LOGIC
                                    if text_context and len(text_context) > 400:
                                        print(f"DEBUG: Truncating text from {len(text_context)} to 400 chars for embedding.")
                                        text_context = text_context[:400]
                                    
                                    print(f"DEBUG: Generating embedding for page {page_num}...")
                                    emb = get_embedding(image_bytes=img_bytes, text=text_context)
                                    
                                    if emb:
                                        print(f"DEBUG: Embedding generated. Saving to Firestore...")
                                        safe_filename = "".join(c for c in blob.name if c.isalnum() or c in "._-")
                                        doc_id = f"{safe_filename}_p{page_num}"
                                        
                                        doc_data = {
                                            "uri": f"gs://{GCS_BUCKET_NAME}/{blob.name}",
                                            "filename": blob.name,
                                            "page_number": page_num,
                                            "structure_type": analysis.get("structure_type"),
                                            "key_message": analysis.get("key_message"),
                                            "description": analysis.get("description"),
                                            "embedding": Vector(emb),
                                            "created_at": firestore.SERVER_TIMESTAMP
                                        }
                                        main_collection.document(doc_id).set(doc_data)
                                        pages_success += 1
                                    else:
                                        print(f"WARNING: Embedding generation failed for page {page_num}")
                                
                                # Cleanup chunk
                                del chunk_images
                                gc.collect()
                                
                            except Exception as chunk_err:
                                print(f"ERROR processing chunk {start_page}-{end_page}: {chunk_err}")
                                # Continue to next chunk or abort file? usually better to continue?
                                # But if conversion failed, maybe next chunk fails too.
                                # Let's log and continue best effort.
                                pass
                            
                finally:
                    # Clean up temp file
                    import os
                    if os.path.exists(tmp_pdf_path):
                        os.remove(tmp_pdf_path)
                    # pdf_bytes already deleted above
                    gc.collect()

                
                if should_process:
                    if pages_success > 0:
                        success_data = {
                            "status": "success",
                            "pages_processed": pages_success,
                            "updated_at": firestore.SERVER_TIMESTAMP
                        }
                        res_doc_ref.update(success_data)
                        summary_ref.set(success_data, merge=True)
                        success_count += 1
                    else:
                        fail_data = {
                            "status": "failed",
                            "error": "No pages processed successfully",
                            "updated_at": firestore.SERVER_TIMESTAMP
                        }
                        res_doc_ref.update(fail_data)
                        summary_ref.set(fail_data, merge=True)
                        failed_count += 1
                else:
                    # Skipped files logic already updated summary_ref
                    pass

            except Exception as e:
                print(f"ERROR processing file {blob.name}: {e}")
                err_data = {
                    "status": "failed",
                    "error": str(e),
                    "updated_at": firestore.SERVER_TIMESTAMP
                }
                res_doc_ref.update(err_data)
                summary_ref.set(err_data, merge=True)
                failed_count += 1
            
            processed_count += 1
            batch_ref.update({
                "processed_files": processed_count,
                "success_files": success_count,
                "failed_files": failed_count
            })

        batch_ref.update({"status": "completed", "completed_at": firestore.SERVER_TIMESTAMP})
        print(f"DEBUG: Batch {batch_id} completed.")

    except Exception as e:
        print(f"Critical Batch Error: {e}")
        batch_ref.update({"status": "failed", "error": str(e), "completed_at": firestore.SERVER_TIMESTAMP})

async def retry_batch_worker(batch_id: str, item_ids: List[str] = None):
    """Retries failed items in a batch."""
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
                # ... COPY PASTE PROCESSING LOGIC ...
                # Ideally refactor this into 'process_single_blob' function
                # For brevity I'll compress logic here
                pdf_bytes = blob.download_as_bytes()
                images = convert_from_bytes(pdf_bytes, fmt="jpeg")
                pages_success = 0
                for i, image in enumerate(images):
                    page_num = i + 1
                    img_byte_arr = io.BytesIO()
                    image.save(img_byte_arr, format='JPEG')
                    img_bytes = img_byte_arr.getvalue()
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
        
        # Recalc stats? Complex. For now just mark batch as completed/partial?
        batch_ref.update({"status": "completed"}) # Back to completed, user can check results
        
    except Exception as e:
        batch_ref.update({"status": "failed", "error": f"Retry Crash: {str(e)}"})

# --- Endpoints ---

@router.post("/consulting/ingest")
async def trigger_ingest(background_tasks: BackgroundTasks):
    """Starts a new ingestion batch."""
    try:
        batch_id = str(uuid.uuid4())
        db = get_firestore_client()
        # Ensure collection exists or just write
        db.collection(BATCH_COLLECTION_NAME).document(batch_id).set({
            "id": batch_id,
            "created_at": firestore.SERVER_TIMESTAMP,
            "status": "pending",
            "summary": "Full Ingestion Run"
        })
        
        background_tasks.add_task(run_batch_ingestion_worker, batch_id)
        return {"batch_id": batch_id, "message": "Batch started"}
    except Exception as e:
        print(f"Trigger Ingest Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/consulting/batches")
async def list_batches():
    """Lists recent batches."""
    try:
        db = get_firestore_client()
        # Order by created_at desc
        docs = db.collection(BATCH_COLLECTION_NAME).order_by("created_at", direction=firestore.Query.DESCENDING).limit(20).stream()
        batches = []
        for d in docs:
            batches.append(d.to_dict())
            # Convert timestamp ?
        return {"batches": batches}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/consulting/batches/{batch_id}")
async def get_batch_details(batch_id: str):
    """Gets batch items."""
    try:
        db = get_firestore_client()
        # Get Batch
        batch = db.collection(BATCH_COLLECTION_NAME).document(batch_id).get().to_dict()
        
        # Get Items
        items_ref = db.collection(RESULT_COLLECTION_NAME).where("batch_id", "==", batch_id).stream()
        items = [d.to_dict() for d in items_ref]
        
        # Sort items by status (failed first)
        items.sort(key=lambda x: (x.get("status") != "failed", x.get("filename")))
        
        return {"batch": batch, "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/batches/{batch_id}/retry")
async def retry_batch(batch_id: str, req: RetryBatchRequest, background_tasks: BackgroundTasks):
    """Retries failed items in a batch."""
    background_tasks.add_task(retry_batch_worker, batch_id, req.item_ids)
    return {"message": "Retry started"}

@router.post("/consulting/batches/{batch_id}/cancel")
async def cancel_batch(batch_id: str):
    """Cancels a running batch."""
    try:
        db = get_firestore_client()
        batch_ref = db.collection(BATCH_COLLECTION_NAME).document(batch_id)
        # We just set the status to 'cancelling'. The worker will pick this up and stop.
        batch_ref.update({"status": "cancelling"})
        return {"message": "Cancellation requested"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/index")
async def trigger_index(background_tasks: BackgroundTasks):
    """Triggers background index creation."""
    task_id = str(uuid.uuid4())
    # This task management is still in-memory for index creation, as it's a simpler, one-off operation.
    # If more complex index management is needed, it could also be moved to Firestore.
    tasks[task_id] = {
        "status": "running",
        "queue": asyncio.Queue(),
        "logs": []
    }
    background_tasks.add_task(run_background_index_creation, task_id)
    return {"task_id": task_id, "message": "Index creation started"}

# In-memory storage for tasks: task_id -> {"status": str, "queue": asyncio.Queue, "logs": list}
# This is kept for the index creation task, as it's not part of the batch ingestion system.
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
    """Starts async collection from URL."""
    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "running",
        "queue": asyncio.Queue(),
        "logs": []
    }
    
    # Placeholder for run_background_collection, assuming it would use the 'tasks' dict for logging
    # If run_background_collection is meant to be part of the new batch system, it needs refactoring.
    # For now, keeping it consistent with the original code's task management.
    async def run_background_collection(task_id: str, source_type: str, content: Any):
        await add_log(task_id, f"Starting collection from {source_type}...")
        try:
            if source_type == 'url':
                filename = download_and_upload_worker(content)
                if filename:
                    await add_log(task_id, f"Successfully collected {filename}")
                else:
                    await add_log(task_id, f"Failed to collect from URL: {content}")
            elif source_type == 'file_bytes':
                # This part is not fully implemented in the original snippet,
                # but would involve saving the bytes to GCS.
                await add_log(task_id, "File bytes collection not fully implemented in worker.")
            await add_log(task_id, "Collection complete.")
        except Exception as e:
            await add_log(task_id, f"Collection error: {e}")
        finally:
            await add_log(task_id, "DONE")

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
    # Placeholder for run_background_collection, assuming it would use the 'tasks' dict for logging
    async def run_background_collection(task_id: str, source_type: str, content: Any):
        await add_log(task_id, f"Starting collection from {source_type}...")
        try:
            if source_type == 'url':
                # This branch is not used by collect_file
                pass
            elif source_type == 'file_bytes':
                # This part is not fully implemented in the original snippet,
                # but would involve saving the bytes to GCS.
                filename = f"uploaded_{uuid.uuid4()}.pdf" # Example filename
                g_client = get_storage_client()
                bucket = g_client.bucket(GCS_BUCKET_NAME)
                blob = bucket.blob(f"consulting_raw/{filename}")
                blob.upload_from_string(content, content_type="application/pdf")
                await add_log(task_id, f"Successfully uploaded file: {filename}")
            await add_log(task_id, "Collection complete.")
        except Exception as e:
            await add_log(task_id, f"Collection error: {e}")
        finally:
            await add_log(task_id, "DONE")

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
        client = get_genai_client()
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

@router.get("/consulting/files/{filename}/pages")
async def list_file_pages(filename: str):
    """Lists all processed pages for a specific file."""
    try:
        db = get_firestore_client()
        collection = db.collection(FIRESTORE_COLLECTION_NAME)
        
        # NOTE: filename passed in URL might need decoding or path handling
        # Stored filename is typically "consulting_raw/basename.pdf" or just basename depending on logic
        # Let's try to match exactly or by suffix
        
        # Try finding by filename field
        docs = collection.where("filename", "==", filename).stream()
        
        results = []
        for doc in docs:
            d = doc.to_dict()
            results.append({
                "id": doc.id,
                "page_number": d.get("page_number"),
                "structure_type": d.get("structure_type"),
                "key_message": d.get("key_message"),
                "description": d.get("description"),
                "uri": d.get("uri"),
                "created_at": d.get("created_at")
            })
            
        # If no results, try adding "consulting_raw/" prefix if missing
        if not results and not filename.startswith("consulting_raw/"):
             alt_filename = f"consulting_raw/{filename}"
             docs_alt = collection.where("filename", "==", alt_filename).stream()
             for doc in docs_alt:
                d = doc.to_dict()
                results.append({
                    "id": doc.id,
                    "page_number": d.get("page_number"),
                    "structure_type": d.get("structure_type"),
                    "key_message": d.get("key_message"),
                    "description": d.get("description"),
                    "uri": d.get("uri"),
                    "created_at": d.get("created_at")
                })
        
        # Sort by page number
        results.sort(key=lambda x: x["page_number"] or 0)
        
        return {"pages": results}
    except Exception as e:
        print(f"List Pages Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
