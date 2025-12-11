from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import base64
import os
import datetime

from google.cloud import aiplatform
from google.cloud import storage
from google.genai import types
from google import genai
import vertexai
from vertexai.vision_models import MultiModalEmbeddingModel, Image

# Initialize Router
router = APIRouter(
    tags=["rag"],
)

# Configuration
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
INDEX_ENDPOINT_ID = os.getenv("INDEX_ENDPOINT_ID")
DEPLOYED_INDEX_ID = os.getenv("DEPLOYED_INDEX_ID")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME")
VECTOR_SEARCH_LOCATION = os.getenv("VECTOR_SEARCH_LOCATION")

class RagRequest(BaseModel):
    query: Optional[str] = None
    image: Optional[str] = None      # base64 string
    mimeType: Optional[str] = None   # "image/png" etc
    top_k: int = 3

def get_embedding(text: str = None, image_bytes: bytes = None):
    model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")
    if image_bytes:
        image = Image(image_bytes)
        embeddings = model.get_embeddings(image=image, contextual_text=text)
        return embeddings.image_embedding
    elif text:
        embeddings = model.get_embeddings(contextual_text=text)
        return embeddings.text_embedding
    return None

def generate_signed_url(gcs_uri: str) -> str:
    """Generates a signed URL for a GCS object."""
    try:
        if not gcs_uri.startswith("gs://"):
            return ""
        
        # Parse bucket and blob name
        parts = gcs_uri.replace("gs://", "").split("/", 1)
        if len(parts) != 2:
            return ""
        bucket_name, blob_name = parts
        
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        
        url = blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(minutes=15),
            method="GET",
        )
        return url
    except Exception as e:
        print(f"Error generating signed URL for {gcs_uri}: {e}")
        return ""

def search_vector_db(vector: List[float], top_k: int) -> List[Dict[str, Any]]:
    if not INDEX_ENDPOINT_ID or not DEPLOYED_INDEX_ID:
        print("Vector Search Env Vars missing")
        return []
    
    # Initialize Vector Search Endpoint
    # Use VECTOR_SEARCH_LOCATION if available, otherwise fallback to LOCATION
    vs_location = VECTOR_SEARCH_LOCATION if VECTOR_SEARCH_LOCATION else LOCATION
    
    index_endpoint = aiplatform.MatchingEngineIndexEndpoint(
        index_endpoint_name=INDEX_ENDPOINT_ID,
        project=PROJECT_ID,
        location=vs_location
    )
    
    # Query
    response = index_endpoint.find_neighbors(
        deployed_index_id=DEPLOYED_INDEX_ID,
        queries=[vector],
        num_neighbors=top_k
    )
    
    # Extract GCS URIs and distances
    results = []
    if response:
        for neighbor in response[0]:
            results.append({
                "id": neighbor.id, # gs://bucket/path/to/image.jpg
                "distance": neighbor.distance
            })
    return results

@router.post("/rag")
async def generate_rag(request: RagRequest):
    """
    Multimodal RAG Endpoint
    Return: Answer text + List of retrieved contexts with metadata
    """
    try:
        # 1. Vectorize
        image_bytes = None
        if request.image:
            try:
                image_bytes = base64.b64decode(request.image)
            except:
                pass
        
        vector = get_embedding(text=request.query, image_bytes=image_bytes)
        
        if not vector:
             raise HTTPException(status_code=400, detail="Could not generate embedding for input")

        # 2. Retrieve
        retrieved_items = search_vector_db(vector, request.top_k)
        
        retrieved_contexts = []
        for item in retrieved_items:
            uri = item['id']
            signed_url = generate_signed_url(uri)
            retrieved_contexts.append({
                "uri": uri,
                "distance": item['distance'],
                "signed_url": signed_url
            })
        
        print(f"Retrieved items: {retrieved_contexts}")

        # 3. Generate with Gemini
        api_key = os.getenv("GOOGLE_CLOUD_API_KEY")
        if api_key:
            api_key = api_key.strip()
            
        client = genai.Client(
            vertexai=True,
            api_key=api_key,
            http_options={'api_version': 'v1beta1'}
        )
        
        contents = []
        
        # Add Retrieved Images (Context)
        if retrieved_contexts:
            contents.append("Here are some relevant manual pages found:")
            for ctx in retrieved_contexts:
                uri = ctx['uri']
                # Guess mime type from extension or default to image/jpeg
                mime_type = "image/jpeg" 
                if uri.lower().endswith(".png"): mime_type = "image/png"
                
                contents.append(types.Part.from_uri(file_uri=uri, mime_type=mime_type))
        else:
            contents.append("No relevant manual pages found within the database.")

        # Add User Query/Image
        contents.append("User Question:")
        if request.query:
            contents.append(request.query)
        if request.image and request.mimeType:
             contents.append(types.Part.from_bytes(data=base64.b64decode(request.image), mime_type=request.mimeType))

        contents.append("Based on the provided manual pages (if any), please answer the user's question. If the manual pages don't contain the answer, state that.")

        response = client.models.generate_content(
            model="gemini-3-pro-preview",
            contents=contents
        )
        
        return {
            "answer": response.text,
            "retrieved_contexts": retrieved_contexts  # Rich metadata
        }

    except Exception as e:
        print(f"Error in RAG endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))
