
import os
import sys
from google.cloud import firestore
from pathlib import Path
import datetime

# Setup path to import backend modules
current_dir = Path(__file__).parent
backend_dir = current_dir.parent
sys.path.append(str(backend_dir))

def get_db():
    key_path = backend_dir.parent / "key.json"
    if key_path.exists():
        return firestore.Client.from_service_account_json(str(key_path))
    else:
        print("Warning: key.json not found, attempting default credentials...")
        return firestore.Client()

def main():
    try:
        db = get_db()
    except Exception as e:
        print(f"Failed to initialize Firestore: {e}")
        return

    print("Starting migration: Denormalization of Daily Tasks...")
    
    # 1. Fetch all Daily Tasks
    daily_tasks_ref = db.collection("daily_tasks")
    docs = daily_tasks_ref.stream()
    
    updated_count = 0
    skipped_count = 0
    error_count = 0
    
    batch = db.batch()
    BATCH_SIZE = 400 
    batch_counter = 0

    print("Fetching tasks...")
    
    for doc in docs:
        task = doc.to_dict()
        task_id = doc.id
        
        source_id = task.get('source_id')
        source_type = task.get('source_type')
        
        if not source_id or not source_type:
            skipped_count += 1
            continue
            
        try:
            source_data = {}
            if source_type == "BACKLOG":
                source_doc = db.collection("backlog_items").document(source_id).get()
                if source_doc.exists:
                    source_data = source_doc.to_dict()
            elif source_type == "ROUTINE":
                source_doc = db.collection("routines").document(source_id).get()
                if source_doc.exists:
                    source_data = source_doc.to_dict()
            
            if source_data:
                updates = {}
                
                # Title
                source_title = source_data.get('title')
                if source_title and source_title != task.get('title'):
                    updates['title'] = source_title
                    
                # Highlight
                source_highlight = source_data.get('is_highlighted', False)
                if 'is_highlighted' not in task or task['is_highlighted'] != source_highlight:
                    updates['is_highlighted'] = source_highlight
                    
                if updates:
                    batch.update(doc.reference, updates)
                    updated_count += 1
                    batch_counter += 1
                    # print(f"Queued update for {task_id}")
                else:
                    skipped_count += 1
            else:
                 skipped_count += 1

            if batch_counter >= BATCH_SIZE:
                print(f"Committing batch of {batch_counter}...")
                batch.commit()
                batch = db.batch()
                batch_counter = 0
                
        except Exception as e:
            print(f"Error processing {task_id}: {e}")
            error_count += 1

    if batch_counter > 0:
        print(f"Committing final batch of {batch_counter}...")
        batch.commit()

    print(f"Migration Complete.")
    print(f"Updated: {updated_count}")
    print(f"Skipped: {skipped_count}")
    print(f"Errors: {error_count}")

if __name__ == "__main__":
    main()
