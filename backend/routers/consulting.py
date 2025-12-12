from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body
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
    except Exception as e:
        print(f"Vector Search Error: {e}")
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

# --- Endpoints ---

@router.post("/consulting/collect")
async def collect_data(req: CollectRequest):
    """Downloads a PDF from URL and saves to GCS."""
    try:
        response = requests.get(req.url, stream=True)
        response.raise_for_status()
        
        filename = req.url.split("/")[-1]
        if not filename.endswith(".pdf"):
            filename += ".pdf"
        
        # Upload to GCS
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(f"consulting_raw/{filename}")
        blob.upload_from_string(response.content, content_type="application/pdf")
        
        return {"status": "success", "message": f"Collected {filename} to gs://{GCS_BUCKET_NAME}/consulting_raw/{filename}"}
    except Exception as e:
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
