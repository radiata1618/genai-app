import os
import asyncio
import subprocess
from google import genai
from google.genai import types
from google.oauth2 import credentials

# New Project ID identified by the user
PROJECT_ID = "gen-lang-client-0601865996"
LOCATION = "us-central1"

def get_access_token():
    try:
         return subprocess.check_output("gcloud auth print-access-token", shell=True).decode('utf-8').strip()
    except Exception as e:
        print(f"Error getting token: {e}")
        return None

async def check_model_sdk(model_name, creds):
    print(f"Testing {model_name} in project {PROJECT_ID}...", end=" ")
    try:
        # Initialize GenAI Client for Vertex AI with explicit credentials and NEW PROJECT ID
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
    print(f"Checking Project: {PROJECT_ID}, Location: {LOCATION}")
    token = get_access_token()
    if not token:
        print("Could not get access token.")
        return
        
    creds = credentials.Credentials(token)
    print("Got access token via gcloud.")
    print("-" * 30)
    
    # Test valid models in the new project
    await check_model_sdk("gemini-3-pro-preview", creds) 
    await check_model_sdk("gemini-2.0-flash", creds)

if __name__ == "__main__":
    asyncio.run(main())
