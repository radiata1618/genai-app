import requests
import json
import os

# Load Environment Variables
ENV_PATH = os.path.join(os.path.dirname(__file__), ".env.local")
INTERNAL_API_KEY = "test_secret_key" # Fallback
if os.path.exists(ENV_PATH):
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("INTERNAL_API_KEY="):
                INTERNAL_API_KEY = line.split("=", 1)[1].strip().strip('"').strip("'")
                break

BASE_URL = "http://localhost:8000"
API_PREFIX = "/api/english"

HEADERS = {
    "X-INTERNAL-API-KEY": INTERNAL_API_KEY,
    "Content-Type": "application/json"
}

print(f"Using API Key: {INTERNAL_API_KEY[:4]}***")

def test_generate():
    print("\n--- Testing Generation ---")
    url = f"{BASE_URL}{API_PREFIX}/phrases/generate"
    payload = {"japanese": "お腹が空いた"}
    try:
        res = requests.post(url, json=payload, headers=HEADERS)
        if res.status_code == 200:
            print("Success!")
            data = res.json()
            print(json.dumps(data, indent=2, ensure_ascii=False))
            return data.get("suggestions", [])
        else:
            print(f"Failed: {res.status_code} {res.text}")
            return []
    except Exception as e:
        print(f"Error: {e}")
        return []

def test_create(suggestions):
    print("\n--- Testing Creation ---")
    if not suggestions:
        print("Skipping creation due to empty suggestions")
        return []
        
    url = f"{BASE_URL}{API_PREFIX}/phrases"
    # Take the first 2
    to_register = []
    for s in suggestions[:2]:
        to_register.append({
            "japanese": s["japanese"],
            "english": s["english"],
            "note": s["explanation"]
        })
        
    try:
        res = requests.post(url, json=to_register, headers=HEADERS)
        if res.status_code == 200:
            print("Success!")
            data = res.json()
            print(json.dumps(data, indent=2, ensure_ascii=False))
            return data
        else:
            print(f"Failed: {res.status_code} {res.text}")
            return []
    except Exception as e:
        print(f"Error: {e}")
        return []

def test_list():
    print("\n--- Testing List ---")
    url = f"{BASE_URL}{API_PREFIX}/phrases"
    try:
        res = requests.get(url, headers=HEADERS)
        if res.status_code == 200:
            print("Success!")
            data = res.json()
            print(f"Found {len(data)} phrases")
            if data:
                print(f"First item: {data[0]}")
            return data
        else:
            print(f"Failed: {res.status_code} {res.text}")
            import traceback
            traceback.print_exc()
            return []
    except Exception as e:
        print(f"Error: {e}")
        return []

def test_delete(phrases):
    print("\n--- Testing Delete ---")
    if not phrases:
        print("No phrases to delete")
        return
        
    target_id = phrases[0]["id"]
    url = f"{BASE_URL}{API_PREFIX}/phrases/{target_id}"
    try:
        res = requests.delete(url, headers=HEADERS)
        if res.status_code == 200:
            print(f"Deleted {target_id} Successfully!")
        else:
            print(f"Failed: {res.status_code} {res.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    params = test_generate()
    created = test_create(params)
    fetched = test_list()
    # Cleanup created ones
    if created:
        test_delete(created)
