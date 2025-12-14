
import os
from google import genai
from dotenv import load_dotenv

load_dotenv(dotenv_path='backend/.env.local')

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")

print(f"Project: {PROJECT_ID}, Location: {LOCATION}")

def list_models():
    try:
        client = genai.Client(
            vertexai=True,
            project=PROJECT_ID,
            location=LOCATION,
            http_options={'api_version': 'v1beta1'}
        )
        
        print("--- Listing Models ---")
        for m in client.models.list(config={"page_size": 50}):
            if "gemini" in m.name or "embedding" in m.name:
                print(f"Model: {m.name} | Display: {m.display_name}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_models()
