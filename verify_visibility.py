
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

def check_visibility(target_id):
    print(f"Checking visibility for ID: {target_id}")
    
    # Simulate the query used in app/actions/backlog.js
    # filters = { excludeCompleted: true, excludePending: true } -> status in ['STOCK']
    
    statuses = ['STOCK'] 
    
    print(f"Querying with status in {statuses}...")
    
    try:
        query = db.collection('backlog_items') \
            .where('is_archived', '==', False) \
            .where('status', 'in', statuses) \
            .order_by('order', direction=firestore.Query.ASCENDING) \
            .limit(2000)
            
        docs = list(query.stream())
        
        found = False
        for doc in docs:
            if doc.id == target_id:
                found = True
                data = doc.to_dict()
                print(f"FAILED? No, FOUND! Item is in the list.")
                print(f"Data: {data}")
                break
        
        if not found:
            print("Item NOT found in the query results.")
            print(f"Total items returned: {len(docs)}")
            
            # Check if it exists at all
            doc_ref = db.collection('backlog_items').document(target_id)
            doc = doc_ref.get()
            if doc.exists:
                print("Item exists in DB but was not returned by query.")
                print(f"Item Data: {doc.to_dict()}")
                if doc.to_dict().get('is_archived'):
                    print("Reason: is_archived is True")
                elif doc.to_dict().get('status') not in statuses:
                    print(f"Reason: Status '{doc.to_dict().get('status')}' is not in {statuses}")
            else:
                print("Item does not exist in DB.")
                
    except Exception as e:
        print(f"Error executing query: {e}")

if __name__ == '__main__':
    check_visibility('ymkkYFFV8VD1MNaY4nYL')
