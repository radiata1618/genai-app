
import requests
import datetime
import json

BASE_URL = "http://localhost:8000/api"

def create_temp_routine():
    print("Creating temporary routine...")
    data = {
        "title": "Temp Routine for Verification",
        "routine_type": "ACTION",
        "frequency": {"type": "DAILY"}
    }
    res = requests.post(f"{BASE_URL}/tasks/routines", json=data)
    if res.status_code != 200:
        print(f"Failed to create routine: {res.text}")
        return None
    return res.json()

def generate_daily():
    print("Generating daily tasks...")
    res = requests.post(f"{BASE_URL}/tasks/generate-daily")
    if res.status_code != 200:
        print(f"Failed to generate daily tasks: {res.text}")

def get_today_tasks():
    print("Fetching today's tasks...")
    res = requests.get(f"{BASE_URL}/tasks/daily")
    if res.status_code != 200:
        print(f"Failed to fetch daily tasks: {res.text}")
        return []
    return res.json()

def delete_routine(routine_id):
    print(f"Deleting routine {routine_id}...")
    res = requests.delete(f"{BASE_URL}/tasks/routines/{routine_id}")
    if res.status_code != 200:
        print(f"Failed to delete routine: {res.text}")

def verify():
    # 1. Create Routine
    routine = create_temp_routine()
    if not routine: return

    # 2. Generate Daily Task
    generate_daily()

    # 3. Verify it exists
    tasks_before = get_today_tasks()
    found = any(t['source_id'] == routine['id'] for t in tasks_before)
    if not found:
        print("ERROR: Task not generated for the temporary routine.")
        # Cleanup
        delete_routine(routine['id'])
        return

    print("Task successfully generated.")

    # 4. Delete Routine
    delete_routine(routine['id'])

    # 5. Verify it is gone from Today's list (The Bug Fix)
    tasks_after = get_today_tasks()
    found_after = any(t['source_id'] == routine['id'] for t in tasks_after)
    
    if found_after:
        print("FAILURE: Orphaned task NOT filtered out. Validation failed.")
    else:
        print("SUCCESS: Orphaned task was filtered out. Validation passed.")

if __name__ == "__main__":
    verify()
