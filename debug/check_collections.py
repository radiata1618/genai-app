
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

collections_to_check = ["photos", "english_photos", "english_review", "hobbies_photos"]

print(f"--- Checking Collections in {project_id} ---")

for col_name in collections_to_check:
    try:
        docs = list(db.collection(col_name).limit(5).stream())
        print(f"Collection '{col_name}': {len(docs)} docs found (limit 5)")
        for doc in docs:
             print(f"  - {doc.id} : {doc.to_dict().keys()}")
    except Exception as e:
        print(f"Error checking {col_name}: {e}")
    print("-" * 20)
