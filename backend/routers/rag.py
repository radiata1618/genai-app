from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import base64
import os

from google.cloud import aiplatform
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
        embeddings = model.get_embeddings(text=text)
        return embeddings.text_embedding
    return None

def search_vector_db(vector: List[float], top_k: int):
    if not INDEX_ENDPOINT_ID or not DEPLOYED_INDEX_ID:
        # Fallback for demo if env vars not set (return nothing or error)
        print("Vector Search Env Vars missing")
        return []
    
    # Initialize Vector Search Endpoint
    # Use specific region for Vector Search if defined, otherwise default to global LOCATION
    rag_location = os.getenv("VECTOR_SEARCH_LOCATION", LOCATION)
    aiplatform.init(project=PROJECT_ID, location=rag_location)
    index_endpoint = aiplatform.MatchingEngineIndexEndpoint(index_endpoint_name=INDEX_ENDPOINT_ID)
    
    # Query
    response = index_endpoint.find_neighbors(
        deployed_index_id=DEPLOYED_INDEX_ID,
        queries=[vector],
        num_neighbors=top_k
    )
    
    # Extract GCS URIs (Assuming the ID in Vector Search IS the GCS URI)
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
    1. Vectorize Input (Text or Image)
    2. Search Vector DB for similar images (Manual pages)
    3. Generate Answer with Gemini using retrieved images as context
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
        retrieved_uris = [item['id'] for item in retrieved_items]
        
        print(f"Retrieved items: {retrieved_uris}")

        # 3. Generate with Gemini
        client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
        
        contents = []
        
        # Add Retrieved Images (Context)
        # Using Google GenAI SDK, we can pass GCS URI directly?
        # Yes, types.Part.from_uri()
        if retrieved_uris:
            contents.append("Here are some relevant manual pages found:")
            for uri in retrieved_uris:
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
            model="gemini-2.0-flash",
            contents=contents
        )
        
        return {
            "answer": response.text,
            "retrieved_images": retrieved_uris
        }

    except Exception as e:
        print(f"Error in RAG endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))
