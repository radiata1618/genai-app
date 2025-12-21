
import os
from google.cloud import aiplatform

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION", "asia-northeast1")

def list_models():
    print(f"Listing models in {PROJECT_ID} / {LOCATION}...")
    aiplatform.init(project=PROJECT_ID, location=LOCATION)
    
    try:
        models = aiplatform.Model.list()
        print(f"Found {len(models)} custom models (ignoring foundation models for a moment).")
        for m in models:
            print(f"- {m.display_name} ({m.resource_name})")
            
        print("\nChecking Foundation Models via GenAI SDK...")
        # Different SDK for foundation models
        from google import genai
        client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
        # There isn't a simple list_models in genai V1Beta1 that lists foundation models easily without Model Garden API?
        # Let's try to just generate content with a known model to verify it exists
        
        test_models = ["gemini-1.5-flash", "gemini-1.5-flash-001", "gemini-1.5-pro", "gemini-2.0-flash-exp"]
        for m in test_models:
            print(f"Testing {m}...", end=" ")
            try:
                response = client.models.generate_content(model=m, contents="Hi")
                print("OK")
            except Exception as e:
                print(f"FAIL: {e}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_models()
