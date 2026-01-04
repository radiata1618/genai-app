import asyncio
import os
import traceback
import base64
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load env
load_dotenv(dotenv_path='.env.local')
if not os.getenv("GOOGLE_CLOUD_API_KEY"):
    load_dotenv(dotenv_path='../.env.local')

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION", "us-central1")

print(f"DEBUG: Project: {PROJECT_ID}, Location: {LOCATION}")

client = genai.Client(
    vertexai=True,
    project=PROJECT_ID,
    location=LOCATION,
    http_options={'api_version': 'v1beta1'}
)

MODEL_ID = "gemini-live-2.5-flash-preview-native-audio-09-2025"

# Dummy 16kHz PCM Audio (1 second of silence)
# 16000 samples * 2 bytes/sample = 32000 bytes
dummy_audio_bytes = b'\x00' * 32000

async def test_input_format(session, description, input_data):
    print(f"\n--- Testing: {description} ---")
    try:
        # Test send_realtime_input as recommended by warning
        if hasattr(session, 'send_realtime_input'):
            print("Using send_realtime_input...")
            await session.send_realtime_input(input_data)
        else:
            print("Using session.send (fallback)...")
            await session.send(input=input_data, end_of_turn=False)
            
        print("SUCCESS: Send executed without immediate exception.")
        
        # Wait a bit to see if server closes connection or sends error
        # In a real loop we would wait for receive, but here just sleep briefly
        await asyncio.sleep(1) 
        print("SUCCESS: No disconnect after send.")
        return True
    except Exception as e:
        print(f"FAILED: {description}")
        print(f"Error: {e}")
        traceback.print_exc()
        return False

async def main():
    config = {"response_modalities": ["AUDIO"]}
    
    print(f"Connecting to {MODEL_ID}...")
    try:
        async with client.aio.live.connect(
            model=MODEL_ID,
            config=types.LiveConnectConfig(
                response_modalities=config["response_modalities"],
                system_instruction=types.Content(parts=[types.Part(text="You are a helper.")])
            )
        ) as session:
            print("Connected.")

            # Test 1: Content Object (What failed before)
            # part = types.Part.from_bytes(data=dummy_audio_bytes, mime_type="audio/pcm;rate=16000")
            # await test_input_format(session, "types.Content wrapper", types.Content(parts=[part]))

            # Test 2: List of Parts (Also failed)
            # await test_input_format(session, "List of Parts", [part])
            
            # Test 3: LiveClientRealtimeInput Dict Structure
            # This follows the expected proto structure for realtime input
            realtime_input = {
                "media_chunks": [
                    {
                        "mime_type": "audio/pcm;rate=16000",
                        "data": dummy_audio_bytes
                    }
                ]
            }
            await test_input_format(session, "Dict: media_chunks", realtime_input)
            
            # Test 4: Flat Dict (Another possibility seen in docs)
            # flat_input = {"mime_type": "audio/pcm;rate=16000", "data": dummy_audio_bytes}
            # await test_input_format(session, "Flat Dict", flat_input)

            # Receive loop to keep alive and see server responses
            print("Listening for server responses...")
            async for response in session.receive():
                if response.server_content:
                    print("Received server content.")
                    break # Exit after first response to prove it works
                
    except Exception as e:
        print(f"Connection/Session Error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
