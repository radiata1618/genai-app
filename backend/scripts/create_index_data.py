
import os
import json
import base64
import time
from google.cloud import storage
import vertexai
from vertexai.vision_models import MultiModalEmbeddingModel, Image
from concurrent.futures import ThreadPoolExecutor, as_completed

# Configuration
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC")

if not PROJECT_ID or not LOCATION or not GCS_BUCKET_NAME:
    print("Error: environment variables PROJECT_ID, LOCATION, GCS_BUCKET_NAME_FOR_CONSUL_DOC must be set.")
    exit(1)

print(f"Initializing Vertex AI with Project: {PROJECT_ID}, Location: {LOCATION}")
vertexai.init(project=PROJECT_ID, location=LOCATION)

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
             # TODO: For PDF, we ideally need to convert to image first or use a model that supports PDF directly if available.
             # multi-modal-embedding@001 usually takes Image or Text. 
             # For this script we will skip PDF strictly and focus on images if any, 
             # OR we need a way to render PDF. 
             # As a workaround for this environment, we will assume images OR we can try to treat it as text if we extract it?
             # For "Logic Mapper" aiming for visual structure, we really want Image.
             # If the user only has PDFs, we should warn.
             print(f"Skipping PDF {blob.name} (PDF rendering requires extra libs). Please upload .png/.jpg slides.")
             return None
        
        if not (blob.name.lower().endswith(".png") or blob.name.lower().endswith(".jpg") or blob.name.lower().endswith(".jpeg")):
            return None

        print(f"Processing {blob.name}...")
        image_bytes = blob.download_as_bytes()
        
        # We can add a "concept" text hint if available, but for now just Visual
        embedding = get_embedding(image_bytes=image_bytes)
        
        if embedding:
            # Vector Search JSONL format: {"id": "gs://...", "embedding": [...]}
            # We use the GCS info as ID
            return {
                "id": f"gs://{GCS_BUCKET_NAME}/{blob.name}",
                "embedding": embedding
            }
    except Exception as e:
        print(f"Failed to process {blob.name}: {e}")
    return None

def main():
    storage_client = storage.Client(project=PROJECT_ID)
    bucket = storage_client.bucket(GCS_BUCKET_NAME)
    
    print(f"Scanning gs://{GCS_BUCKET_NAME}/consulting_raw/ ...")
    blobs = list(bucket.list_blobs(prefix="consulting_raw/"))
    
    output_data = []
    
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(process_blob, blob) for blob in blobs]
        for future in as_completed(futures):
            result = future.result()
            if result:
                output_data.append(result)

    print(f"Generated {len(output_data)} embeddings.")
    
    if not output_data:
        print("No embeddings generated. Please check if you have .png/.jpg files in 'consulting_raw/' folder.")
        return

    # Save to JSONL
    output_filename = "embeddings.jsonl"
    with open(output_filename, "w") as f:
        for entry in output_data:
            f.write(json.dumps(entry) + "\n")
    
    # Upload to GCS
    target_blob_name = "consulting_index_data/embeddings.jsonl"
    blob = bucket.blob(target_blob_name)
    blob.upload_from_filename(output_filename)
    
    print(f"Uploaded index data to gs://{GCS_BUCKET_NAME}/{target_blob_name}")
    
    # Clean up local file
    os.remove(output_filename)

if __name__ == "__main__":
    main()
