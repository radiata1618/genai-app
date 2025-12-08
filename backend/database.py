import os
from google.cloud import firestore
from google.cloud import storage
from pathlib import Path

def get_db():
    current_dir = Path(__file__).parent
    # key.json is in the project root (one level up from backend)
    key_path = current_dir.parent / "key.json"
    
    if key_path.exists():
        return firestore.Client.from_service_account_json(str(key_path))
    else:
        return firestore.Client()

def get_storage_client():
    current_dir = Path(__file__).parent
    # key.json is in the project root (one level up from backend)
    key_path = current_dir.parent / "key.json"
    
    if key_path.exists():
        return storage.Client.from_service_account_json(str(key_path))
    else:
        return storage.Client()

def get_firestore_client():
    return get_db()
