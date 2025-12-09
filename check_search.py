import os
import time
from googleapiclient.discovery import build
from pathlib import Path
from dotenv import load_dotenv

# Load env
env_path = Path(__file__).parent / '.env.local'
load_dotenv(dotenv_path=env_path)

def test_search():
    developer_key = os.getenv("GOOGLE_SEARCH_API_KEY")
    cx = os.getenv("GOOGLE_SEARCH_ENGINE_ID")
    
    if not developer_key or not cx:
        print("Error: Missing credentials in .env.local")
        print(f"Key: {developer_key[:5] if developer_key else 'None'}...")
        print(f"CX: {cx}")
        return

    try:
        service = build("customsearch", "v1", developerKey=developer_key)
        
        # Test 5 sequential searches to simulate load
        print("Starting 5 sequential searches...")
        start_time = time.time()
        
        queries = ["Toyota Corolla", "Honda Civic", "Ford Mustang", "Tesla Model 3", "BMW 3 Series"]
        
        for q in queries:
            print(f"Searching for {q}...", end=" ", flush=True)
            res = service.cse().list(
                q=f"{q} 外観",
                cx=cx,
                searchType="image",
                fileType="jpg",
                num=3, 
                safe="off"
            ).execute()
            
            items = res.get("items", [])
            print(f"Found {len(items)} images.")
            
        duration = time.time() - start_time
        print(f"Completed 5 searches in {duration:.2f} seconds.")
        print(f"Average: {duration/5:.2f}s per search.")
        
    except Exception as e:
        print(f"\nFATAL ERROR: {e}")

if __name__ == "__main__":
    test_search()
