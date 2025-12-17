import os
import datetime
from google.cloud import storage
from google.cloud import firestore
from google import genai
import vertexai
from vertexai.vision_models import MultiModalEmbeddingModel, Image

# --- Configuration ---
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")
FIRESTORE_COLLECTION_NAME = os.getenv("FIRESTORE_COLLECTION_NAME", "consulting_slides")
BATCH_COLLECTION_NAME = "ingestion_batches"
RESULT_COLLECTION_NAME = "ingestion_results"

def trace(msg: str):
    """Prints message with high-precision timestamp for debugging."""
    now = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{now}] {msg}", flush=True)

# --- Clients ---
_genai_client = None

def get_genai_client():
    global _genai_client
    if _genai_client:
        return _genai_client
    
    if PROJECT_ID and LOCATION:
        try:
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

def get_embedding(text: str = None, image_bytes: bytes = None):
    """Generates embedding using the stable Vertex AI MultiModalEmbeddingModel."""
    if not PROJECT_ID or not LOCATION:
        print("Project ID or Location missing for Vertex AI")
        return None

    # Truncate text to satisfy model limit
    if text and len(text) > 400:
        # trace(f"Truncating text from {len(text)} to 400 chars for embedding.")
        text = text[:400]

    try:
        # Lazy init Vertex AI SDK
        vertexai.init(project=PROJECT_ID, location=LOCATION)
        
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
            if image_bytes:
                return embeddings.image_embedding
            elif text:
                return embeddings.text_embedding
                
        return None
    except Exception as e:
        print(f"Embedding error (Vertex AI SDK): {e}")
        return None
