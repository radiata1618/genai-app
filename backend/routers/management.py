from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
import os
import json
import vertexai
from vertexai.vision_models import MultiModalEmbeddingModel, Image
from google.cloud import storage
from pathlib import Path

router = APIRouter(
    tags=["management"],
)

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME")
GCS_SOURCE_FOLDER = "manual_pages"
OUTPUT_FILE = "embeddings.json"

def init_vertex():
    if not PROJECT_ID or not LOCATION:
        raise ValueError("PROJECT_ID or LOCATION not set in env")
    vertexai.init(project=PROJECT_ID, location=LOCATION)

def get_bucket_blobs(bucket_name, prefix):
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blobs = bucket.list_blobs(prefix=prefix)
    return list(blobs)

def upload_to_gcs(bucket_name, source_file_path, destination_blob_name):
    """Uploads a file to the bucket."""
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(destination_blob_name)
    blob.upload_from_filename(source_file_path)
    print(f"File {source_file_path} uploaded to {destination_blob_name}.")

from pdf2image import convert_from_bytes
import io

def process_data_task():
    """Background task to generate embeddings and upload to GCS."""
    print("Starting data preparation task...")
    try:
        if not GCS_BUCKET_NAME:
            print("Error: GCS_BUCKET_NAME not set")
            return

        print(f"Initializing Vertex AI ({PROJECT_ID}, {LOCATION})")
        init_vertex()
        
        model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")
        
        print(f"Fetching files from gs://{GCS_BUCKET_NAME}/{GCS_SOURCE_FOLDER}")
        blobs = get_bucket_blobs(GCS_BUCKET_NAME, GCS_SOURCE_FOLDER)
        
        embeddings_data = []
        for blob in blobs:
            # Case 1: Image files
            if blob.name.endswith(('.png', '.jpg', '.jpeg')):
                print(f"Processing Image: {blob.name}...")
                try:
                    image_bytes = blob.download_as_bytes()
                    image = Image(image_bytes)
                    embeddings = model.get_embeddings(image=image)
                    
                    gcs_uri = f"gs://{GCS_BUCKET_NAME}/{blob.name}"
                    record = {
                        "id": gcs_uri,
                        "embedding": embeddings.image_embedding
                    }
                    embeddings_data.append(record)
                except Exception as e:
                    print(f"Failed to process image {blob.name}: {e}")

            # Case 2: PDF files
            elif blob.name.endswith('.pdf'):
                print(f"Processing PDF: {blob.name}...")
                try:
                    pdf_bytes = blob.download_as_bytes()
                    # Convert PDF pages to images
                    # thread_count=1 to avoid multiprocessing issues in some environments if needed
                    # fmt='jpeg' for smaller size
                    pages = convert_from_bytes(pdf_bytes, fmt='jpeg')
                    
                    for i, page in enumerate(pages):
                        # Convert PIL image to bytes
                        img_byte_arr = io.BytesIO()
                        page.save(img_byte_arr, format='JPEG')
                        img_bytes = img_byte_arr.getvalue()
                        
                        # Upload this page image to GCS (so we can link to it later)
                        # Structure: manual_pages/converted/{pdf_filename}_page_{i+1}.jpg
                        base_name = blob.name.split('/')[-1].replace('.pdf', '')
                        page_filename = f"converted/{base_name}_page_{i+1}.jpg"
                        page_blob_path = f"{GCS_SOURCE_FOLDER}/{page_filename}"
                        
                        # Upload
                        upload_to_gcs_from_bytes(GCS_BUCKET_NAME, img_bytes, page_blob_path, content_type='image/jpeg')
                        
                        # Generate Embedding for this page image
                        vertex_image = Image(img_bytes)
                        embeddings = model.get_embeddings(image=vertex_image)
                        
                        gcs_uri = f"gs://{GCS_BUCKET_NAME}/{page_blob_path}"
                        record = {
                            "id": gcs_uri,
                            "embedding": embeddings.image_embedding
                        }
                        embeddings_data.append(record)
                        print(f"  Processed page {i+1} -> {gcs_uri}")
                        
                except Exception as e:
                    print(f"Failed to process PDF {blob.name}: {e}")
        
        # Save locally
        output_path = Path("/tmp") / OUTPUT_FILE
        if os.name == 'nt':
             output_path = Path("temp_embeddings.json")
        
        print(f"Saving {len(embeddings_data)} embeddings to {output_path}")
        with open(output_path, 'w') as f:
            for record in embeddings_data:
                f.write(json.dumps(record) + '\n')
        
        # Upload to GCS
        destination_blob_name = f"embeddings/{OUTPUT_FILE}"
        print(f"Uploading to gs://{GCS_BUCKET_NAME}/{destination_blob_name}")
        upload_to_gcs(GCS_BUCKET_NAME, str(output_path), destination_blob_name)
        
        print("Data preparation task completed successfully. JSON uploaded to GCS.")
        
        # Clean up local file
        if output_path.exists():
            os.remove(output_path)
            
    except Exception as e:
        print(f"Error in data preparation task: {e}")

def upload_to_gcs_from_bytes(bucket_name, data: bytes, destination_blob_name, content_type='application/octet-stream'):
    """Uploads bytes to the bucket."""
    storage_client = storage.Client()
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(destination_blob_name)
    blob.upload_from_string(data, content_type=content_type)
    # print(f"Uploaded {destination_blob_name}")

@router.post("/management/refresh_index")
async def refresh_index(background_tasks: BackgroundTasks):
    """
    Triggers the embedding generation process in the background.
    """
    background_tasks.add_task(process_data_task)
@router.get("/management/files")
async def list_files():
    """List images in the manual_pages folder."""
    try:
        if not GCS_BUCKET_NAME:
             raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME not set")
             
        blobs = get_bucket_blobs(GCS_BUCKET_NAME, GCS_SOURCE_FOLDER)
        files = []
        for blob in blobs:
             if blob.name.endswith(('.png', '.jpg', '.jpeg', '.pdf')):
                 # Generate a signed URL if we wanted to show images privately, 
                 # but for this demo, we might rely on them being public OR proxying them?
                 # Simplifying: just return name and size.
                 # Actually, for the UI to show preview, we need a way to serve them.
                 # We can add a simple proxy endpoint or generate signed URLs.
                 # Let's generate signed URL if credential allows, otherwise might fail.
                 # For simplicity in this demo, let's assume we can just list them 
                 # and maybe use a proxy endpoint to view.
                 files.append({
                     "name": blob.name,
                     "size": blob.size,
                     "updated": blob.updated.isoformat() if blob.updated else None
                 })
        return {"files": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/management/files/{filename}")
async def delete_file(filename: str):
    """Delete a file from GCS."""
    try:
        # filename passed might be just the basename, but we need full path in bucket
        # Current logic assumes files are in GCS_SOURCE_FOLDER.
        # But verify no directory traversal
        if "/" in filename or "\\" in filename:
             raise HTTPException(status_code=400, detail="Invalid filename")
             
        full_path = f"{GCS_SOURCE_FOLDER}/{filename}"
        
        storage_client = storage.Client()
        bucket = storage_client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(full_path)
        blob.delete()
        
        return {"status": "deleted", "file": full_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from fastapi import File, UploadFile

@router.post("/management/files/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file to GCS."""
    try:
        if not GCS_BUCKET_NAME:
             raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME not set")
        
        # Security check: Validate filename
        filename = file.filename
        if "/" in filename or "\\" in filename:
             raise HTTPException(status_code=400, detail="Invalid filename")

        destination_blob_name = f"{GCS_SOURCE_FOLDER}/{filename}"
        
        storage_client = storage.Client()
        bucket = storage_client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(destination_blob_name)
        
        # Upload from file-like object
        blob.upload_from_file(file.file, content_type=file.content_type)
        
        return {"status": "uploaded", "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
