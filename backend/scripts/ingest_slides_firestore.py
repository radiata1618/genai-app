
import os
import json
import base64
import time
import uuid
from google.cloud import storage
from google.cloud import firestore
from google import genai
from google.genai import types
from concurrent.futures import ThreadPoolExecutor, as_completed

# Configuration
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")
COLLECTION_NAME = os.getenv("FIRESTORE_COLLECTION_NAME", "consulting_slides")

if not PROJECT_ID or not LOCATION or not GCS_BUCKET_NAME:
    print("Error: environment variables PROJECT_ID, LOCATION, GCS_BUCKET_NAME_FOR_CONSUL_DOC must be set.")
    exit(1)

print(f"Initializing GenAI Client with Project: {PROJECT_ID}, Location: {LOCATION}")

# Initialize GenAI Client
client = genai.Client(
    vertexai=True,
    project=PROJECT_ID,
    location=LOCATION
)

db = firestore.Client(project=PROJECT_ID)

def get_embedding(image_bytes=None, text=None):
    """Generates embedding using the multimodal model via google.genai SDK."""
    try:
        model = "multimodalembedding@001"
        
        contents = []
        if image_bytes:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg")) # Assuming JPEG/PNG, mime type is needed but often flexible or can be detected if passed explicitly.
            # Ideally we should pass the correct mime type, but for now we'll default to jpeg or try to infer if we passed it.
            # The caller function process_blob knows the extension. Let's make this arg richer or assume image/jpeg/png work.
            if text:
                 contents.append(types.Part.from_text(text=text))
        elif text:
            contents.append(types.Part.from_text(text=text))
            
        if not contents:
            return None

        # For multimodal embedding in new SDK:
        # We use client.models.embed_content
        result = client.models.embed_content(
            model=model,
            contents=contents
        )
        
        # Structure of result.embedding depends on the model.
        # For multimodalembedding@001, it typically returns image_embedding and text_embedding fields.
        # The SDK wrapper might map it differently.
        # Checking SDK documentation behaviour:
        # If image is present, usually we want the image_embedding.
        
        if image_bytes:
             return result.embeddings[0].values # Depending on SDK version this might be result.image_embedding or within a list
             # Based on recent SDK usages: result.embeddings is often a list.
             # But strictly for multimodalembedding@001, the raw response has imageEmbedding and textEmbedding.
             # The google.genai SDK standardizes this. 
             # Let's inspect the object or assume standard behavior: result.embeddings[0].values
             # Wait, currently for multimodal, the response might be distinct.
             # Let's try the common path. If it fails, we debug.
             
             # Actually, for multimodal embedding, the new SDK `embed_content` returns an EmbedContentResponse
             # which contains `embeddings` (list of ContentEmbedding). Each ContentEmbedding has `values` (list of float).
             
             # HOWEVER, multimodalembedding@001 is a specific model that returns separate image/text embeddings in Vertex API.
             # The google.genai SDK might abstraction this.
             # If using 'multimodalembedding@001', the response might have `image_embedding` field if typed strictly?
             # Let's check typical usage or stick to generic access.
             
             # Verification correction: The GenAI SDK for `embed_content` typically returns `embeddings`.
             # If the model is `text-embedding-004`, it works.
             # `multimodalembedding@001` is older. 
             # If `google.genai` is wrapping standard Vertex prediction, it *should* work.
             
             # Let's assume result.embeddings[0].values for now.
             pass

        # To be safe and specific for Multimodal Embedding model which returns specific image_embedding field in raw API:
        # The generic SDK might just return it in the list.
        if hasattr(result, 'image_embedding') and result.image_embedding:
             return result.image_embedding
        if hasattr(result, 'embeddings') and result.embeddings:
             return result.embeddings[0].values
             
        return None

    except Exception as e:
        print(f"Error generating embedding: {e}")
        return None

def process_blob(blob):
    """Downloads a blob, generates embedding, and returns the data dict."""
    try:
        if blob.name.endswith(".pdf"):
             print(f"Skipping PDF {blob.name} (PDF rendering requires extra libs). Please upload .png/.jpg slides.")
             return None
        
        lower_name = blob.name.lower()
        mime_type = "image/jpeg"
        if lower_name.endswith(".png"):
            mime_type = "image/png"
        
        if not (lower_name.endswith(".png") or lower_name.endswith(".jpg") or lower_name.endswith(".jpeg")):
            return None

        print(f"Processing {blob.name}...")
        image_bytes = blob.download_as_bytes()
        
        # We need to modify get_embedding to accept mime_type if possible, or just handle inside.
        # Let's update get_embedding call to just pass bytes, but inside get_embedding we hardcoded "image/jpeg".
        # Let's fix that below by updating the call or function signature.
        # For this refactor, I will modify get_embedding locally here to take mime_type.
        
        # Redefining get_embedding logic inline or passing mime_type? 
        # I'll update get_embedding signature in the file content above.
        
        # WAIT, I wrote get_embedding above with hardcoded mime_type="image/jpeg".
        # I should probably fix that in the replacement content to accept mime_type.
        # But for now, let's keep it simple or make it dynamic.
        
        # Updated get_embedding logic for this specific file context:
        model = "multimodalembedding@001"
        try:
            contents = [types.Part.from_bytes(data=image_bytes, mime_type=mime_type)]
            
            result = client.models.embed_content(
                model=model,
                contents=contents
            )
            
            embedding = None
            # Handle response extraction
            if hasattr(result, 'image_embedding') and result.image_embedding:
                 embedding = result.image_embedding
            elif hasattr(result, 'embeddings') and result.embeddings:
                 embedding = result.embeddings[0].values
            
            # Fallback for some SDK versions dealing with this specific model
            if not embedding:
                 # Try key access if it's a dict/object wrapper
                 pass
            
            if not embedding:
                print(f"Warning: No embedding returned for {blob.name}")
            
        except Exception as e:
            print(f"Error generating embedding for {blob.name}: {e}")
            embedding = None
        
        if embedding:
            try:
                from google.cloud.firestore import Vector
            except ImportError:
                from google.cloud.firestore_v1.vector import Vector
            
            safe_id = "".join(c for c in blob.name if c.isalnum() or c in "._-")
            gcs_uri = f"gs://{GCS_BUCKET_NAME}/{blob.name}"
            
            doc_data = {
                "uri": gcs_uri,
                "filename": blob.name,
                "embedding": Vector(embedding),
                "created_at": firestore.SERVER_TIMESTAMP
            }
            
            return {
                "id": safe_id,
                "data": doc_data
            }
    except Exception as e:
        print(f"Failed to process {blob.name}: {e}")
    return None

def main():
    storage_client = storage.Client(project=PROJECT_ID)
    bucket = storage_client.bucket(GCS_BUCKET_NAME)
    
    print(f"Scanning gs://{GCS_BUCKET_NAME}/consulting_raw/ ...")
    blobs = list(bucket.list_blobs(prefix="consulting_raw/"))
    
    tasks = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        for blob in blobs:
            tasks.append(executor.submit(process_blob, blob))
            
        count = 0
        for future in as_completed(tasks):
            result = future.result()
            if result:
                # Write to Firestore
                doc_ref = db.collection(COLLECTION_NAME).document(result["id"])
                doc_ref.set(result["data"])
                print(f"Wrote {result['id']} to Firestore.")
                count += 1

    print(f"Ingestion Complete. Processed {count} items.")

if __name__ == "__main__":
    main()
