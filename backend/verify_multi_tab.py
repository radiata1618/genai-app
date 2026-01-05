import asyncio
import os
from google.cloud import firestore
from routers.english import create_youtube_prep, YouTubePrepRequest

# Mock database
import database
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "service-account.json" # If needed

async def test_multi_tab():
    db = firestore.Client()
    req = YouTubePrepRequest(url="https://www.youtube.com/watch?v=vM8Rx9X0fmg")
    
    print("Starting generation for NBC video...")
    try:
        task = await create_youtube_prep(req, db)
        print("\n--- Generation Success! ---")
        print(f"ID: {task.id}")
        print(f"Manual Raw Length: {len(task.script_manual or '')}")
        print(f"Auto Raw Length: {len(task.script_auto or '')}")
        print(f"Manual Augmented: {'YES' if task.script_manual_augmented else 'NO'}")
        print(f"Auto Augmented: {'YES' if task.script_auto_augmented else 'NO'}")
        
        # Check for duplication in manual raw (should be cleaned)
        print(f"\nManual Raw Sample: {task.script_manual[:200]}...")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_multi_test())
