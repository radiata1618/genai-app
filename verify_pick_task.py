
import json
import urllib.request
import urllib.error
import time
from datetime import datetime

BASE_URL = "http://localhost:8000/api"

def get_api_key():
    try:
        with open(".env.local", "r", encoding='utf-8') as f:
            for line in f:
                if line.strip().startswith("INTERNAL_API_KEY="):
                    # Remove quotes if present
                    key = line.split("=", 1)[1].strip()
                    return key.strip('"').strip("'")
    except Exception as e:
        print(f"Warning: Could not read .env.local: {e}")
    return ""

API_KEY = get_api_key()

def run_request(method, endpoint, data=None):
    url = f"{BASE_URL}{endpoint}"
    req = urllib.request.Request(url, method=method)
    req.add_header('Content-Type', 'application/json')
    if API_KEY:
        req.add_header('X-INTERNAL-API-KEY', API_KEY)
    
    if data:
        json_data = json.dumps(data).encode('utf-8')
        req.data = json_data
        
    try:
        with urllib.request.urlopen(req) as response:
            if response.status != 200:
                print(f"Error: {response.status} for {url}")
                return None
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as e:
        print(f"Request Failed: HTTP {e.code} - {url}")
        # Print body for debugging
        try:
            print(e.read().decode())
        except: pass
        return None
    except urllib.error.URLError as e:
        print(f"Request Failed: {e} - {url}")
        return None

def verify_fix():
    print("--- Starting API Verification ---")
    
    # 1. Create Backlog Item (DONE)
    print("Creating Backlog Item...")
    item_data = {
        "title": "VERIFY_API_DONE_TASK",
        "status": "DONE",
        "priority": "High",
        "category": "Verification"
    }
    created_item = run_request("POST", "/tasks/backlog", item_data)
    if not created_item:
        print("Failed to create backlog item. Is the backend running on localhost:8000?")
        return False
        
    backlog_id = created_item['id']
    print(f"Created Backlog ID: {backlog_id} (Status: {created_item.get('status')})")

    # 2. Pick Task
    print("Picking Task...")
    # Endpoint expects query params for pick? No, looking at tasks.py: 
    # @router.post("/daily/pick") def pick_from_backlog(backlog_id: str, ...)
    # It takes query params usually or body?
    # backend/routers/tasks.py Line 713: backlog_id: str, target_date...
    # Query params by default in FastAPI for primitives unless Body() is used.
    # Let's try query params.
    
    target_date = datetime.now().strftime("%Y-%m-%d")
    pick_endpoint = f"/tasks/daily/pick?backlog_id={backlog_id}&target_date={target_date}"
    
    daily_task = run_request("POST", pick_endpoint)
    
    success = False
    if daily_task:
        dt_id = daily_task.get('id')
        dt_status = daily_task.get('status')
        print(f"Daily Task Created: {dt_id}")
        print(f"Daily Task Status: {dt_status}")
        
        if dt_status == "DONE":
            print("SUCCESS: Status is DONE.")
            success = True
        else:
            print(f"FAILURE: Status is {dt_status} (Expected DONE).")
            
        # Cleanup Daily Task
        run_request("DELETE", f"/tasks/daily/{dt_id}") # Endpoint might not exist or be different?
        # Checked tasks.py... I don't see DELETE /daily/{id}. I see DELETE /backlog/{id}.
        # Wait, I checked tasks.py, I didn't see delete daily task endpoint in the snippet I read?
        # That's fine, we can leave the daily task or it's a test data.
        
    # Cleanup Backlog
    print("Cleaning up Backlog Item...")
    run_request("DELETE", f"/tasks/backlog/{backlog_id}")

    return success

if __name__ == "__main__":
    if verify_fix():
        print("VERIFICATION PASSED")
    else:
        print("VERIFICATION FAILED")
        exit(1)
