from google import genai
import os
from dotenv import load_dotenv

load_dotenv()

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")

print(f"Checking models for Project: {PROJECT_ID}, Location: {LOCATION}")

try:
    client = genai.Client(
        vertexai=True,
        project=PROJECT_ID,
        location=LOCATION,
        http_options={'api_version': 'v1beta1'}
    )
    
    # List models
    print("\n--- Available Gemini Models ---")
    for m in client.models.list(config={"page_size": 100}):
        if "gemini" in m.name:
            print(f"Name: {m.name}, Display: {m.display_name}, Version: {m.version}")

except Exception as e:
    print(f"Error listing models: {e}")
