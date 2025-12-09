import os
import asyncio
import subprocess
from google import genai
from google.genai import types
from google.oauth2 import credentials

# Set project and location explicitly as they might not be picked up from env environment in this standalone script
PROJECT_ID = "trial-project-ushikoshi"
LOCATION = "us-central1"

def get_access_token():
    try:
         return subprocess.check_output("gcloud auth print-access-token", shell=True).decode('utf-8').strip()
    except Exception as e:
        print(f"Error getting token: {e}")
        return None

async def check_model_sdk(model_name, creds):
    print(f"Testing {model_name} with google-genai SDK...", end=" ")
    try:
        # Initialize GenAI Client for Vertex AI with explicit credentials
        # Note: google-genai 0.x might accept 'credentials' or might rely on google.auth
        # Documentation suggests 'credentials' arg is supported in Client init.
        client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION, credentials=creds)
        
        response = client.models.generate_content(
            model=model_name,
            contents="Hello, simply reply 'OK'.",
            config=types.GenerateContentConfig(
                max_output_tokens=10,
                temperature=0.0
            )
        )
        print(f"SUCCESS. Response: {response.text.strip() if response.text else 'Empty'}")
        return True
    except Exception as e:
        print(f"FAILED.")
        print(f"Error details: {e}")
        return False

async def main():
    print(f"Project: {PROJECT_ID}, Location: {LOCATION}")
    token = get_access_token()
    if not token:
        print("Could not get access token.")
        return
        
    creds = credentials.Credentials(token)
    print("Got access token via gcloud.")
    print("-" * 30)
    
    # Test variants
    await check_model_sdk("gemini-3-pro-preview", creds) 
    await check_model_sdk("gemini-3.0-pro-preview", creds) 
    
    # Test Control
    await check_model_sdk("gemini-1.5-pro", creds)

if __name__ == "__main__":
    asyncio.run(main())
