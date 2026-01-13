
import asyncio
import os
import sys
from dotenv import load_dotenv

# Add backend to path to import ai_shared if needed, but we try to keep it standalone
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

# Load Env from Root
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # backend/
root_dir = os.path.dirname(backend_dir) # genai-app/
env_path = os.path.join(root_dir, ".env")

print(f"Loading env from: {env_path}")
load_dotenv(env_path)

# Also try key.json if exists
key_path = os.path.join(backend_dir, "key.json")
if os.path.exists(key_path):
    print(f"Found key.json at: {key_path}")
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path
    import json
    try:
        with open(key_path, "r") as f:
            key_data = json.load(f)
            if "project_id" in key_data:
                print(f"Loaded PROJECT_ID from key.json: {key_data['project_id']}")
                os.environ["PROJECT_ID"] = key_data["project_id"]
    except Exception as e:
        print(f"Failed to parse key.json: {e}")

from google import genai
from google.genai import types

async def debug_gemini_call():
    print("--- DEBUGGING GEMINI 2.5 FLASH LITE ---")
    
    api_key = os.getenv("GOOGLE_CLOUD_API_KEY")
    project_id = os.getenv("PROJECT_ID")
    location = os.getenv("LOCATION", "us-central1")
    
    print(f"Project ID: {project_id}")
    print(f"Location: {location}")
    print(f"API Key Present: {bool(api_key)}")
    
    client = None
    mode = "Unknown"
    
    # 1. Init Client (Logic from Consulting.py)
    if api_key:
        try:
            print("Attempting Vertex AI with API Key...")
            client = genai.Client(
                vertexai=True,
                api_key=api_key,
                location=location,
                project=project_id
            )
            mode = "Vertex AI (API Key)"
        except Exception as e:
            print(f"Init Failed: {e}")
            
    if not client and project_id:
        try:
            print("Attempting Vertex AI with ADC...")
            client = genai.Client(
                vertexai=True,
                project=project_id,
                location=location
            )
            mode = "Vertex AI (ADC)"
        except Exception as e:
             print(f"Init Failed: {e}")

    if not client:
        print("CRITICAL: Could not initialize client.")
        return

    print(f"Client Initialized in mode: {mode}")
    
    # Test 1: Simple Text
    print("\n[Test 1] Simple Text 'Hello World'")
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents="Hello, are you online?",
            config=types.GenerateContentConfig(response_mime_type="text/plain")
        )
        print(f"Success! Response: {response.text}")
    except Exception as e:
        print(f"Test 1 Failed: {e}")
        import traceback
        traceback.print_exc()

    # Test 2: Image Bytes
    print("\n[Test 2] Image Bytes (Inline)")
    image_path = os.path.join(root_dir, "public", "icons", "icon-192-v3.png")
    if os.path.exists(image_path):
        try:
            with open(image_path, "rb") as f:
                img_bytes = f.read()
            print(f"Loaded image: {image_path} ({len(img_bytes)} bytes)")
            
            file_part = types.Part.from_bytes(data=img_bytes, mime_type="image/png")
            
            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash-lite",
                contents=[
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_text(text="What is this image?"),
                            file_part
                        ]
                    )
                ],
                config=types.GenerateContentConfig(response_mime_type="text/plain")
            )
            print(f"Success! Response: {response.text}")
        except Exception as e:
            print(f"Test 2 Failed: {e}")
            import traceback
            traceback.print_exc()
    else:
        print(f"Test 2 Skipped: Image not found at {image_path}")

if __name__ == "__main__":
    asyncio.run(debug_gemini_call())
