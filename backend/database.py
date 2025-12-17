import os
from google.cloud import firestore
from google.cloud import storage
from pathlib import Path

# Singleton instances
_db_client = None
_storage_client = None

def get_db():
    global _db_client
    if _db_client is not None:
        return _db_client

    current_dir = Path(__file__).parent
    # key.json is in the project root (one level up from backend)
    key_path = current_dir.parent / "key.json"
    
    if key_path.exists():
        _db_client = firestore.Client.from_service_account_json(str(key_path))
    else:
        _db_client = firestore.Client()
    
    return _db_client

def get_storage_client():
    global _storage_client
    if _storage_client is not None:
        return _storage_client

    current_dir = Path(__file__).parent
    # key.json is in the project root (one level up from backend)
    key_path = current_dir.parent / "key.json"
    
    if key_path.exists():
        _storage_client = storage.Client.from_service_account_json(str(key_path))
    else:
        _storage_client = storage.Client()
    
    return _storage_client

def get_firestore_client():
    return get_db()
