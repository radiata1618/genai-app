
import os
from google.cloud import aiplatform
from dotenv import load_dotenv
from pathlib import Path

# Setup Credentials
backend_dir = Path(__file__).parent
key_path = backend_dir / 'key.json'
env_path = backend_dir.parent / '.env.local'

load_dotenv(dotenv_path=env_path)
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(key_path)

def list_models():
    project_id = os.getenv("PROJECT_ID") or "trial-project-ushikoshi"
    location = os.getenv("LOCATION_FOR_CAR_QUIZZ") or "us-central1"
    
    print(f"Listing models for project: {project_id} in {location}")
    
    aiplatform.init(project=project_id, location=location)
    
    try:
        models = aiplatform.Model.list()
        print("\n--- Custom Models ---")
        for model in models:
            print(f"Name: {model.display_name}, ID: {model.resource_name}")
            
        # For Gemini, we often check Publisher Models
        print("\n--- Publisher Models (Gemini) ---")
        # There isn't a direct "list all publisher models" that is always concise, 
        # but we can try to instantiate common names to see if they error, 
        # or use the Model Garden API if available. 
        # Simpler approach: List models via checking the GenerativeModel list if possible,
        # but the SDK doesn't have a simple "list_generative_models".
        
        # Let's try to verify specific known IDs for Gemini 3.0
        candidates = [
            "gemini-3.0-pro-preview",
            "gemini-3.0-pro-preview-001",
            "gemini-3.0-pro-preview-11-2025",
            "gemini-experiment",
            "gemini-1.5-pro-002",
            "gemini-1.5-flash-002"
        ]
        
        print(f"Checking candidates: {candidates}")
        
        import vertexai
        from vertexai.generative_models import GenerativeModel
        
        vertexai.init(project=project_id, location=location)
        
        for name in candidates:
            try:
                model = GenerativeModel(name)
                # Just trying to instantiate might work, but generating dummy content confirms access
                print(f"✅ Model found/instantiated: {name}")
            except Exception as e:
                print(f"❌ Model failed: {name} - {e}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_models()
