
import sys
import os
from datetime import datetime, timedelta, date

# Add current dir to path
sys.path.append(os.getcwd())

# Mock Firestore if needed, but we want real integration test?
# We need to rely on the environment having credentials. User has key.json in backend.
# The database.py likely uses it.

try:
    from database import get_db
    from routers.tasks import generate_daily_tasks
except ImportError as e:
    print(f"Import Error: {e}")
    sys.exit(1)

def test_stock_pickup():
    print("Initializing DB...")
    # get_db returns client directly based on inspection
    db = get_db()

         
    if not db:
        print("Failed to get DB client")
        return

    # 1. Create a Stock item scheduled for Yesterday
    yesterday = datetime.now().date() - timedelta(days=1)
    print(f"Creating stock item for {yesterday}")
    
    new_ref = db.collection("backlog_items").document()
    item_id = new_ref.id
    new_ref.set({
        "id": item_id,
        "title": "VERIFY_STOCK_FIX_TEST",
        "status": "STOCK",
        "scheduled_date": datetime.combine(yesterday, datetime.min.time()),
        "created_at": datetime.now(),
        "is_archived": False,
        "priority": "Medium",
        "category": "Research"
    })
    print(f"Created backlog item {item_id}")
    
    today_str = datetime.now().date().isoformat()
    daily_id = f"{item_id}_{today_str}"
    
    try:
        # Check if daily task already exists (it shouldn't)
        if db.collection("daily_tasks").document(daily_id).get().exists:
            print("WARNING: Daily task already exists, deleting for test...")
            db.collection("daily_tasks").document(daily_id).delete()

        # 2. Run generate_daily_tasks for Today
        print("Running generate_daily_tasks for Today...")
        # Note: generate_daily_tasks might need 'db' as arg if it's a Depends.
        # routers/tasks.py: def generate_daily_tasks(target_date=..., db=Depends(get_db))
        # We can pass db manually.
        
        result = generate_daily_tasks(target_date=datetime.now().date(), db=db)
        print(f"Result: {result}")
        
        # 3. Verify it was picked up
        daily_snap = db.collection("daily_tasks").document(daily_id).get()
        
        if daily_snap.exists:
            print("SUCCESS: Task was picked up!")
            print(daily_snap.to_dict())
            
            # Clean up daily
            print("Cleaning up daily...")
            db.collection("daily_tasks").document(daily_id).delete()
        else:
            print("FAILURE: Task was NOT picked up.")
            
    except Exception as e:
        print(f"Error during test: {e}")
        import traceback
        traceback.print_exc()
        
    finally:
        # Clean up backlog
        print("Cleaning up backlog item...")
        db.collection("backlog_items").document(item_id).delete()

if __name__ == "__main__":
    test_stock_pickup()
