import os
import sys
from pathlib import Path

# Add backend directory to sys.path to import modules
backend_path = Path(__file__).parent.parent / "backend"
sys.path.append(str(backend_path))

from google.cloud import firestore

# Initialize Firestore
key_path = backend_path.parent / "key.json"

if key_path.exists():
    print(f"Using key file: {key_path}")
    db = firestore.Client.from_service_account_json(str(key_path))
else:
    print("Using default credentials")
    db = firestore.Client()

def patch_reviews():
    print("Fetching existing reviews...")
    coll = db.collection("english_review")
    docs = coll.stream()
    
    count = 0
    updated_count = 0
    
    for doc in docs:
        count += 1
        data = doc.to_dict()
        doc_id = doc.id
        
        print(f"Checking doc {doc_id}...", end=" ")
        
        needs_update = False
        update_data = {}
        
        if "script" not in data:
            print("MISSING script", end=" ")
            update_data["script"] = None # or ""
            needs_update = True
        
        if needs_update:
            try:
                coll.document(doc_id).update(update_data)
                print("-> UPDATED")
                updated_count += 1
            except Exception as e:
                print(f"-> FAILED: {e}")
        else:
            print("OK")
            
    print(f"Total docs: {count}")
    print(f"Updated docs: {updated_count}")

if __name__ == "__main__":
    patch_reviews()
