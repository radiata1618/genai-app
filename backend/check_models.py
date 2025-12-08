
import os
import vertexai
from vertexai.generative_models import GenerativeModel
from google.cloud import aiplatform
from dotenv import load_dotenv
from pathlib import Path

# Setup Credentials (mimicking main.py)
backend_dir = Path(__file__).parent
env_path = backend_dir.parent / '.env.local'
load_dotenv(dotenv_path=env_path)

def list_models():
    project_id = os.getenv("PROJECT_ID")
    location = os.getenv("LOCATION_FOR_CAR_QUIZZ") or "us-central1"
    
    if not project_id:
        print("Error: PROJECT_ID not found in .env.local")
        return

    print(f"Initializing Vertex AI for project: {project_id} in {location}")
    try:
        vertexai.init(project=project_id, location=location)
        aiplatform.init(project=project_id, location=location)
    except Exception as e:
        print(f"Init failed: {e}")
        return

    print("\n--- Verifying Gemini Models ---")
    
    candidates = [
        "gemini-experimental",
        "gemini-3.0-pro-preview",
        "gemini-2.0-flash", # Known working from reference
        "gemini-1.5-pro",
        "gemini-1.5-flash"
    ]
    
    for name in candidates:
        try:
            print(f"Testing {name}...", end=" ")
            model = GenerativeModel(name)
            # Try a lightweight generation to confirm 404 vs success
            response = model.generate_content("Hello", stream=False)
            print(f"✅ Success")
        except Exception as e:
            msg = str(e)
            if "404" in msg:
                print(f"❌ 404 Not Found")
            else:
                print(f"❌ Error: {msg[:100]}...")

if __name__ == "__main__":
    list_models()
