
from google.cloud import firestore
from google.oauth2 import service_account
import os

# Initialize Firestore
cred_path = 'key.json'
if not os.path.exists(cred_path):
    print(f"Error: {cred_path} not found.")
    exit(1)

credentials = service_account.Credentials.from_service_account_file(cred_path)
db = firestore.Client(credentials=credentials)

def migrate_status():
    print("Checking for backlog items missing 'status' field...")
    
    collection_ref = db.collection('backlog_items')
    # Use list() to fetch all since stream() is similar but list allows easier counting if needed, though stream is better for mem.
    docs = collection_ref.where('is_archived', '==', False).stream()
    
    count = 0
    updated_count = 0
    
    batch = db.batch()
    batch_size = 0
    BATCH_LIMIT = 400
    
    for doc in docs:
        data = doc.to_dict()
        count += 1
        
        if 'status' not in data:
            # print(f"Doc {doc.id} missing status. Title: {data.get('title', 'Unknown')}")
            ref = collection_ref.document(doc.id)
            batch.update(ref, {'status': 'STOCK'})
            updated_count += 1
            batch_size += 1
            
            if batch_size >= BATCH_LIMIT:
                batch.commit()
                batch = db.batch()
                batch_size = 0
                print(f"Committed batch of {BATCH_LIMIT} updates...")

    if batch_size > 0:
        batch.commit()
        print(f"Committed final batch of {batch_size} updates.")

    print(f"Total active items checked: {count}")
    print(f"Items updated (missing status -> 'STOCK'): {updated_count}")

if __name__ == '__main__':
    migrate_status()
