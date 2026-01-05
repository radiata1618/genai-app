
import requests
import json
import os
from dotenv import load_dotenv

load_dotenv(".env.local")


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

HEADERS = {
    "X-INTERNAL-API-KEY": INTERNAL_API_KEY,
    "Content-Type": "application/json"
}


def test_generate_phrases_english():
    print("Testing /api/english/phrases/generate with English input...")
    
    payload = {
        "japanese": "Build a robust foundation" # Inputting English as if it were the "japanese" field (backend checks content)
    }
    
    try:
        response = requests.post(f"{BASE_URL}/api/english/phrases/generate", json=payload, headers=HEADERS)
        response.raise_for_status()
        
        data = response.json()
        print("\nResponse Status:", response.status_code)
        print("Suggestions:")
        for s in data["suggestions"]:
            print(f"- Type: {s['type']}")
            print(f"  English: {s['english']}")
            print(f"  Explanation: {s['explanation'][:100]}...") # Truncate for display
            print(f"  Japanese Field: {s['japanese']}")

    except Exception as e:
        print(f"FAILED: {e}")
        if 'response' in locals():
            print(response.text)

if __name__ == "__main__":
    test_generate_phrases_english()
