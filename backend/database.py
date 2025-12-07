import os
from google.cloud import firestore
from pathlib import Path

def get_db():
    current_dir = Path(__file__).parent
    key_path = current_dir / "key.json"
    
    if key_path.exists():
        return firestore.Client.from_service_account_json(str(key_path))
    else:
        return firestore.Client()

def get_firestore_client():
    return get_db()
