
import os
import json
import base64
import time
import uuid
from google.cloud import storage
from google.cloud import firestore
import vertexai
from vertexai.vision_models import MultiModalEmbeddingModel, Image
from concurrent.futures import ThreadPoolExecutor, as_completed

# Configuration
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")
COLLECTION_NAME = os.getenv("FIRESTORE_COLLECTION_NAME", "consulting_slides")

if not PROJECT_ID or not LOCATION or not GCS_BUCKET_NAME:
    print("Error: environment variables PROJECT_ID, LOCATION, GCS_BUCKET_NAME_FOR_CONSUL_DOC must be set.")
    exit(1)

print(f"Initializing Vertex AI with Project: {PROJECT_ID}, Location: {LOCATION}")
vertexai.init(project=PROJECT_ID, location=LOCATION)
db = firestore.Client(project=PROJECT_ID)

def get_embedding(image_bytes=None, text=None):
    """Generates embedding using the multimodal model."""
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
        print(f"Error generating embedding: {e}")
        return None

def process_blob(blob):
    """Downloads a blob, generates embedding, and returns the data dict."""
    try:
        if blob.name.endswith(".pdf"):
             print(f"Skipping PDF {blob.name} (PDF rendering requires extra libs). Please upload .png/.jpg slides.")
             return None
        
        if not (blob.name.lower().endswith(".png") or blob.name.lower().endswith(".jpg") or blob.name.lower().endswith(".jpeg")):
            return None

        # Check if already exists in Firestore? (Optional optimization)
        # For simplicity, we process all.

        print(f"Processing {blob.name}...")
        image_bytes = blob.download_as_bytes()
        
        embedding = get_embedding(image_bytes=image_bytes)
        
        if embedding:
            from google.cloud.firestore import Vector
            
            # Create a document
            doc_id = str(uuid.uuid4())
            gcs_uri = f"gs://{GCS_BUCKET_NAME}/{blob.name}"
            
            doc_data = {
                "uri": gcs_uri,
                "filename": blob.name,
                "embedding": Vector(embedding), # Store as Firestore Vector
                "created_at": firestore.SERVER_TIMESTAMP
            }
            
            # Using filename as ID or random? Using hash of URI might be better for dedup, 
            # but filename is simple enough for now if we assume unique names.
            # Let's use a safe-url-encoded filename as ID to allow updates
            safe_id = "".join(c for c in blob.name if c.isalnum() or c in "._-")
            
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
