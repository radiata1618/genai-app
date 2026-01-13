import os
import datetime
from google.cloud import storage
from google.cloud import firestore
from google import genai
from google.cloud import storage
from google.cloud import firestore
from google import genai

# Lazy import for vertexai
# import vertexai
# from vertexai.vision_models import MultiModalEmbeddingModel, Image

try:
    from google.cloud.firestore import Vector
except ImportError:
    from google.cloud.firestore_v1.vector import Vector

# --- Configuration ---
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")
FIRESTORE_COLLECTION_NAME = os.getenv("FIRESTORE_COLLECTION_NAME", "consulting_slides")
BATCH_COLLECTION_NAME = "ingestion_batches"
RESULT_COLLECTION_NAME = "ingestion_results"

# --- Credentials Auto-Fix (for Local Windows Check) ---
if os.getenv("GOOGLE_APPLICATION_CREDENTIALS") == "/app/key.json":
    if not os.path.exists("/app/key.json"):
        # We are likely running locally on Windows, check for local key.json
        # Assuming we are in backend/services, key.json is in backend/ or root
        current_dir = os.path.dirname(os.path.abspath(__file__)) # services/
        backend_dir = os.path.dirname(current_dir) # backend/
        local_key_path = os.path.join(backend_dir, "key.json")
        
        if os.path.exists(local_key_path):
            print(f"Auto-fixing CREDENTIALS path to local: {local_key_path}")
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = local_key_path
            # Re-init clients if needed, but usually lazy loaded or will use env var on init


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
    
    api_key = os.getenv("GOOGLE_CLOUD_API_KEY")
    p_id = os.getenv("PROJECT_ID")
    p_loc = os.getenv("LOCATION", "us-central1")

    # 1. Try Vertex AI with API Key (Working pattern in car_quiz.py / generate.py)
    if api_key:
        try:
            _genai_client = genai.Client(
                vertexai=True,
                api_key=api_key.strip(),
                # http_options={'api_version': 'v1beta1'} # Let SDK decide
            )
            print("DEBUG: GenAI Client initialized in Vertex AI mode with API Key")
            return _genai_client
        except Exception as e:
            print(f"Error initializing GenAI Client with API Key: {e}")

    # 2. Fallback to Vertex AI with Service Account / Project ID
    if p_id:
        try:
            _genai_client = genai.Client(
                vertexai=True,
                project=p_id,
                location=p_loc,
                # http_options={'api_version': 'v1beta1'} # Let SDK decide
            )
            print(f"DEBUG: GenAI Client initialized in Vertex AI mode (Project={p_id}, Location={p_loc})")
            return _genai_client
        except Exception as e:
            print(f"Error initializing GenAI Client with Project ID: {e}")
            
    # 3. Last Fallback: Google AI Studio mode (not vertexai)
    if api_key:
        try:
            _genai_client = genai.Client(
                api_key=api_key.strip(),
                # http_options={'api_version': 'v1beta1'} # Let SDK decide
            )
            print("DEBUG: GenAI Client initialized in Google AI Studio mode")
            return _genai_client
        except Exception as e:
            print(f"Error initializing GenAI Client in AI Studio mode: {e}")

    print("WARNING: No GenAI Client could be initialized (missing Project ID or API Key)")
    return None

def get_storage_client():
    return storage.Client(project=os.getenv("PROJECT_ID"))

def get_firestore_client():
    return firestore.Client(project=os.getenv("PROJECT_ID"))

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
        import vertexai
        from vertexai.vision_models import MultiModalEmbeddingModel, Image

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
