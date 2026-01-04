
from google.cloud import firestore
import os

key_path = "c:\\programing\\genai-app\\backend\\key.json"
if os.path.exists(key_path):
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path

project_id = os.getenv('PROJECT_ID', 'trial-project-ushikoshi')
try:
    db = firestore.Client(project=project_id)
except Exception as e:
    print(f"Failed to init Firestore: {e}")
    exit(1)

print("--- Inspecting hobbies_photos (All) ---")
try:
    # Get all docs, ordered by created_at DESC
    docs = db.collection("hobbies_photos").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
    
    count = 0
    for doc in docs:
        count += 1
        data = doc.to_dict()
        print(f"ID: {doc.id}")
        print(f"  filename: {data.get('filename')}")
        print(f"  created_at: {data.get('created_at')}")
        print(f"  gcs_path: {data.get('gcs_path')}")
        
        if not data.get('gcs_path'):
             print("  WARNING: gcs_path IS MISSING")

        print("-" * 20)
    
    print(f"Total documents found: {count}")

except Exception as e:
    print(f"Error querying Firestore: {e}")
