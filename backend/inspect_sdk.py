import asyncio
import os
import inspect
from google import genai
from dotenv import load_dotenv

load_dotenv(dotenv_path='.env.local')
if not os.getenv("GOOGLE_CLOUD_API_KEY"):
    load_dotenv(dotenv_path='../.env.local')

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION", "us-central1")
MODEL_ID = "gemini-live-2.5-flash-preview-native-audio-09-2025"

client = genai.Client(
    vertexai=True,
    project=PROJECT_ID,
    location=LOCATION,
    http_options={'api_version': 'v1beta1'}
)

async def main():
    print(f"Inspecting SDK for Model: {MODEL_ID}")
    config = {"response_modalities": ["AUDIO"]}
    
    try:
        async with client.aio.live.connect(
            model=MODEL_ID,
            config=config # Trying simplified config
        ) as session:
            print(f"Session Type: {type(session)}")
            
            if hasattr(session, 'send_realtime_input'):
                method = session.send_realtime_input
                print(f"\n--- send_realtime_input found ---")
                print(f"Signature: {inspect.signature(method)}")
                print(f"Docstring: {method.__doc__}")
            else:
                print("send_realtime_input NOT found on session object.")

            if hasattr(session, 'send_input'):
                print(f"\n--- send_input found ---")
                print(f"Signature: {inspect.signature(session.send_input)}")
            
            # Keep alive briefly
            await asyncio.sleep(1)

    except Exception as e:
        print(f"Connection Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
