from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body, BackgroundTasks
from concurrent.futures import ThreadPoolExecutor, as_completed
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import base64
import os
import requests
import datetime
from google.cloud import storage
from google.cloud import aiplatform
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
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME")
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

@router.post("/consulting/collect")
async def collect_data(req: CollectRequest, background_tasks: BackgroundTasks):
    """
    Downloads content from URL.
    - If PDF: Downloads directly (foreground, fast).
    - If HTML: Scrapes for .pdf links (foreground), then downloads all of them (Background).
    """
    try:
        # 1. Fetch the URL
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(req.url, headers=headers, stream=True)
        response.raise_for_status()
        
        content_type = response.headers.get('Content-Type', '').lower()
        
        pdf_links = []

        # 2. Case: Single PDF
        if 'application/pdf' in content_type or req.url.lower().endswith('.pdf'):
            download_and_upload_worker(req.url) # Do single file immediately
            return {"status": "success", "message": f"Collected single PDF: {req.url.split('/')[-1]}"}
            
        # 3. Case: HTML Page (Scraping)
        elif 'text/html' in content_type:
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Find all links ending in .pdf
            for a in soup.find_all('a', href=True):
                href = a['href']
                full_url = urljoin(req.url, href)
                if full_url.lower().endswith('.pdf'):
                    pdf_links.append(full_url)
            
            # Remove duplicates
            pdf_links = list(set(pdf_links))
            print(f"Found {len(pdf_links)} unique PDFs on page.")

            if not pdf_links:
                return {"status": "warning", "message": "No PDFs found on page."}

            # Queue background task
            background_tasks.add_task(process_downloads, pdf_links)

            return {
                "status": "success", 
                "message": f"Found {len(pdf_links)} PDFs. Starting background download..."
            }

        else:
            return {"status": "error", "message": f"Unsupported content type: {content_type}"}

    except Exception as e:
        print(f"Collection Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/consulting/collect-file")
async def collect_file(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """
    Accepts a PDF file upload.
    - Parses attributes to find links (Annotations /URI).
    - Downloads all found .pdf links to GCS (Background).
    """
    try:
        content = await file.read()
        pdf_file = io.BytesIO(content)
        reader = PdfReader(pdf_file)
        
        pdf_links = set()
        
        # Iterate pages
        for page in reader.pages:
            if "/Annots" in page:
                for annot in page["/Annots"]:
                    obj = annot.get_object()
                    if "/A" in obj and "/URI" in obj["/A"]:
                        uri = obj["/A"]["/URI"]
                        if uri.lower().endswith(".pdf"):
                            pdf_links.add(uri)
        
        pdf_links = list(pdf_links)
        print(f"Found {len(pdf_links)} PDF links in uploaded file.")
        
        if not pdf_links:
             return {"status": "warning", "message": "No accessible PDF links found in the uploaded file."}

        # Queue background task
        background_tasks.add_task(process_downloads, pdf_links)

        return {
            "status": "success", 
            "message": f"Found {len(pdf_links)} linked files. Starting background download..."
        }

    except Exception as e:
        print(f"File Collection Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
