import os
import json
import vertexai
from vertexai.vision_models import MultiModalEmbeddingModel, Image
from google.cloud import storage
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
env_path = Path(__file__).parent.parent / '.env.local' # Assuming script is in backend/scripts/
if not env_path.exists():
    env_path = Path(__file__).parent.parent.parent / '.env.local' 
load_dotenv(dotenv_path=env_path)

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME") # User needs to set this
GCS_SOURCE_FOLDER = "manual_pages" # Folder in bucket containing images
OUTPUT_FILE = "embeddings.json"

def init_vertex():
    if not PROJECT_ID or not LOCATION:
        raise ValueError("PROJECT_ID or LOCATION not set in .env.local")
    vertexai.init(project=PROJECT_ID, location=LOCATION)

def get_bucket_blobs(bucket_name, prefix):
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blobs = bucket.list_blobs(prefix=prefix)
    return list(blobs)

def generate_embeddings():
    print(f"Initializing Vertex AI with Project: {PROJECT_ID}, Location: {LOCATION}")
    init_vertex()
    
    model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")
    
    print(f"Listing images from gs://{GCS_BUCKET_NAME}/{GCS_SOURCE_FOLDER}...")
    try:
        blobs = get_bucket_blobs(GCS_BUCKET_NAME, GCS_SOURCE_FOLDER)
    except Exception as e:
        print(f"Error accessing GCS bucket: {e}")
        return

    embeddings_data = []
    
    for blob in blobs:
        if blob.name.endswith(('.png', '.jpg', '.jpeg')):
            print(f"Processing {blob.name}...")
            
            # Download image to memory or temp file? 
            # Vertex AI SDK can read from GCS URI directly if supported, or we pass bytes.
            # MultiModalEmbeddingModel.get_embeddings(image=Image.load_from_file(path))
            # Or Image(gcs_uri=...) if supported? 
            # Vertex AI SDK `Image` class supports local path or bytes. 
            # Let's check if it supports load_from_uri. If not, we download.
            # Usually Image.load_from_file is for local.
            # We will interpret the image as bytes.
            
            try:
                # 1. Download bytes
                image_bytes = blob.download_as_bytes()
                image = Image(image_bytes)
                
                # 2. Generate Embedding
                embeddings = model.get_embeddings(image=image)
                vector = embeddings.image_embedding
                
                # 3. Format for Vector Search (id, embedding)
                # ID can be the GCS URI
                gcs_uri = f"gs://{GCS_BUCKET_NAME}/{blob.name}"
                
                record = {
                    "id": gcs_uri,
                    "embedding": vector,
                    # Optional: "restricts": [...]
                }
                embeddings_data.append(record)
                
            except Exception as e:
                print(f"Failed to process {blob.name}: {e}")

    # Save to local JSONL file
    output_path = Path(__file__).parent / OUTPUT_FILE
    print(f"Saving {len(embeddings_data)} embeddings to {output_path}...")
    with open(output_path, 'w') as f:
        for record in embeddings_data:
            f.write(json.dumps(record) + '\n')
            
    print("Done! Now you need to:")
    print(f"1. Upload {OUTPUT_FILE} to GCS.")
    print("2. Create a Vector Search Index from this file.")
    print("3. Deploy the Index to an Endpoint.")

if __name__ == "__main__":
    if not GCS_BUCKET_NAME:
        print("Error: GCS_BUCKET_NAME environment variable is not set.")
    else:
        generate_embeddings()
