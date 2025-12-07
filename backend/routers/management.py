from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File
import sys
import os
from pathlib import Path
from typing import List
from google.cloud import storage

# Add the scripts directory to path to import prep_data
sys.path.append(str(Path(__file__).parent.parent / "scripts"))

# Import the logic function. 
from scripts import prep_data

router = APIRouter(
    tags=["management"],
)

GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME")

def get_storage_client():
    # Use same key logic as Firestore if possible, or default
    key_path = Path(__file__).parent.parent / "key.json"
    if key_path.exists():
        return storage.Client.from_service_account_json(str(key_path))
    else:
        return storage.Client()

def run_prep_data_task():
    print("Starting data preparation task...")
    try:
        prep_data.generate_embeddings()
        print("Data preparation task completed successfully.")
    except Exception as e:
        print(f"Data preparation task failed: {e}")

@router.post("/management/refresh_index")
async def refresh_index(background_tasks: BackgroundTasks):
    """
    Triggers the data preparation script in the background.
    """
    try:
        background_tasks.add_task(run_prep_data_task)
        return {"status": "accepted", "message": "Data refresh task started in background."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- File Management (GCS) ---

@router.get("/management/files")
def list_files():
    if not GCS_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME not configured")
    
    try:
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        # Use delimiter to emulate directory listing
        blobs = bucket.list_blobs(prefix="manual_pages/", delimiter="/")
        
        # We must iterate over blobs to populate prefixes (folders)
        files = []
        for blob in blobs:
            if blob.name == "manual_pages/": continue
            files.append({
                "type": "file",
                "name": blob.name.replace("manual_pages/", ""),
                "full_path": blob.name,
                "size": blob.size,
                "updated": blob.updated,
                "media_link": blob.media_link
            })
            
        # Add folders (prefixes)
        for prefix in blobs.prefixes:
            # prefix is like "manual_pages/subfolder/"
            folder_name = prefix.replace("manual_pages/", "").rstrip("/")
            files.append({
                "type": "folder",
                "name": folder_name,
                "full_path": prefix,
                "size": 0,
                "updated": None,
                "media_link": None
            })
            
        return files
    except Exception as e:
        print(f"List files error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/management/files")
async def upload_file(file: UploadFile = File(...)):
    if not GCS_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME not configured")
        
    try:
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(f"manual_pages/{file.filename}")
        
        # Upload from file-like object
        blob.upload_from_file(file.file, content_type=file.content_type)
        
        return {"filename": file.filename, "message": "Uploaded successfully"}
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/management/files/{filename}")
def delete_file(filename: str):
    if not GCS_BUCKET_NAME:
        raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME not configured")
        
    try:
        client = get_storage_client()
        bucket = client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(f"manual_pages/{filename}")
        
        if not blob.exists():
            raise HTTPException(status_code=404, detail="File not found")
            
        blob.delete()
        return {"message": f"Deleted {filename}"}
    except Exception as e:
        print(f"Delete error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
