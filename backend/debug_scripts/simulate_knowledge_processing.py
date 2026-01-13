
import asyncio
import os
import sys
import unittest.mock
from unittest.mock import MagicMock

# Setup Path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # backend/
sys.path.append(backend_dir)
root_dir = os.path.dirname(backend_dir)

# Load Env
from dotenv import load_dotenv
env_path = os.path.join(root_dir, ".env")
load_dotenv(env_path)

# Load Key
key_path = os.path.join(backend_dir, "key.json")
if os.path.exists(key_path):
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path
    import json
    with open(key_path, "r") as f:
        data = json.load(f)
        if "project_id" in data:
            os.environ["PROJECT_ID"] = data["project_id"]

# Force specific vars for test if missing
if not os.getenv("GCS_BUCKET_NAME_FOR_CONSUL_DOC"):
    os.environ["GCS_BUCKET_NAME_FOR_CONSUL_DOC"] = "knowledge-bank-for-genai"
    os.environ["GCS_BUCKET_NAME"] = "knowledge-bank-for-genai" # For script usage
if not os.getenv("LOCATION"):
    os.environ["LOCATION"] = "us-central1"

# Import Function after setting env
from routers.consulting import process_knowledge_worker
from services.ai_shared import get_storage_client, GCS_BUCKET_NAME
# Reload ai_shared to pick up new env vars if it was already imported? 
# sys.modules check or reload might be needed but simpler to just trust it if not imported yet.
import importlib
import services.ai_shared
importlib.reload(services.ai_shared)
from services.ai_shared import get_storage_client, GCS_BUCKET_NAME

async def run_e2e_simulation():
    print("--- E2E SIMULATION: Knowledge Worker ---")
    
    if not GCS_BUCKET_NAME:
        print("CRITICAL: GCS_BUCKET_NAME not set.")
        return

    # 1. Upload Test Image to GCS
    print("[Step 1] Uploading test image...")
    image_path = os.path.join(root_dir, "public", "icons", "icon-192-v3.png")
    if not os.path.exists(image_path):
        print(f"Test image not found at {image_path}")
        return
        
    gcs_filename = "debug_e2e_test.png"
    storage_client = get_storage_client()
    bucket = storage_client.bucket(GCS_BUCKET_NAME)
    blob = bucket.blob(f"knowledge/{gcs_filename}")
    blob.upload_from_filename(image_path, content_type="image/png")
    gcs_uri = f"gs://{GCS_BUCKET_NAME}/knowledge/{gcs_filename}"
    print(f"Uploaded to: {gcs_uri}")

    # 2. Mock Firestore
    print("[Step 2] Mocking Firestore...")
    mock_db = MagicMock()
    mock_doc = MagicMock()
    # Mock update to print what would happen
    mock_doc.update.side_effect = lambda x: print(f"  [DB UPDATE]: {x}")
    mock_db.collection.return_value.document.return_value = mock_doc
    
    # Patch get_firestore_client in consulting.py
    with unittest.mock.patch('routers.consulting.get_firestore_client', return_value=mock_db):
        
        # 3. Run Worker
        print("\n[Step 3] Running process_knowledge_worker...")
        try:
            # We bypass the start_knowledge_processing wrapper and call worker directly
            # Worker signature: doc_id, gcs_uri, file_type
            await process_knowledge_worker("test_doc_id_123", gcs_uri, "image/png")
            print("\n--- PASSED: Worker finished without error ---")
        except Exception as e:
            print(f"\n--- FAILED: Worker crashed: {e} ---")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(run_e2e_simulation())
