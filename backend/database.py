import os
from google.cloud import firestore
from pathlib import Path

# Note: Authentication is handled automatically by google-cloud-firestore
# It looks for GOOGLE_APPLICATION_CREDENTIALS env var or 'key.json' if configured.
# We ensure key.json is available in the environment.

def get_firestore_client():
    # If key.json exists in root/backend, simple init might work.
    # But usually explicit path is safer for local.
    
    # Try to find key.json relative to this file
    current_dir = Path(__file__).parent
    key_path = current_dir / "key.json"
    
    if key_path.exists():
        return firestore.Client.from_service_account_json(str(key_path))
    else:
        # Fallback to default auth (e.g. Cloud Run identity)
        # Or look for env variable
        return firestore.Client()
