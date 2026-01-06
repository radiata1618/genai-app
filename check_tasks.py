import os
import json
from google.cloud import firestore

# Set credentials
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "key.json"

db = firestore.Client()

def check_tasks():
    print("Checking daily_tasks for 2026-01-06...")
    tasks_ref = db.collection('daily_tasks')
    # Use target_date instead of scheduled_date for daily_tasks
    query = tasks_ref.where('target_date', '==', '2026-01-06').stream()
    
    count = 0
    tasks = []
    for doc in query:
        count += 1
        data = doc.to_dict()
        tasks.append(f"- [{data.get('status')}] {data.get('title')} (ID: {doc.id})")
    
    for t in sorted(tasks):
        print(t)
    print(f"Found {count} tasks.")

    print("\nChecking recent backlog_items...")
    backlog_ref = db.collection('backlog_items')
    query = backlog_ref.order_by('created_at', direction=firestore.Query.DESCENDING).limit(10).stream()
    
    for doc in query:
        data = doc.to_dict()
        print(f"- {data.get('title')} (Status: {data.get('status')}, Created: {data.get('created_at')})")

if __name__ == "__main__":
    check_tasks()
