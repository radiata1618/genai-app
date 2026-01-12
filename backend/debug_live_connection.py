import os
import asyncio
import traceback
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load environment variables from .env.local file in parent directory
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')
print(f"DEBUG: Loading env from {env_path}", flush=True)
load_dotenv(dotenv_path=env_path)

async def debug_live():
    project_id = os.getenv("PROJECT_ID")
    location = os.getenv("LOCATION", "us-central1")
    
    if not project_id:
        print("Error: PROJECT_ID not found in environment variables.")
        return

    print(f"DEBUG: Project: {project_id}, Location: {location}")

    # Set GOOGLE_APPLICATION_CREDENTIALS to local key.json
    key_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'key.json')
    if os.path.exists(key_path):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path
        print(f"DEBUG: Set credentials to {key_path}", flush=True)
    else:
        print(f"WARNING: key.json not found at {key_path}", flush=True)

    client = genai.Client(
        vertexai=True,
        project=project_id,
        location=location,
        http_options={'api_version': 'v1beta1'}
    )
    
    config = {
        "model": "gemini-live-2.5-flash-preview-native-audio-09-2025", 
        "response_modalities": ["AUDIO"]
    }
    
    # Match user's logs
    system_instruction = "You are a helpful English tutor. Engage in a roleplay conversation.\n\nTopic: Free Talk\nRole: English Tutor\nTarget Phrases to use/check: "
    
    
    print(f"DEBUG: Connecting to {config['model']}...", flush=True)

    try:
        async with client.aio.live.connect(
            model=config["model"],
            config=types.LiveConnectConfig(
                response_modalities=config["response_modalities"],
                system_instruction=types.Content(parts=[types.Part(text=system_instruction)]),
                # Following the user's current implementation
                session_resumption=types.SessionResumptionConfig(transparent=True)
            )
        ) as session:
            print("DEBUG: Connected to Gemini Live API Successfully", flush=True)

            # Task to send dummy audio
            async def send_dummy_audio():
                print("DEBUG: Starting to send dummy audio...", flush=True)
                # 1 second of silence at 16kHz
                dummy_audio = bytes([0] * 32000) 
                try:
                    for _ in range(5): # Send 5 chunks
                        print("DEBUG: Sending audio chunk...", flush=True)
                        await session.send_realtime_input(
                            media=types.Blob(data=dummy_audio, mime_type="audio/pcm;rate=16000")
                        )
                        await asyncio.sleep(1)
                except Exception as e:
                    print(f"Error sending audio: {e}", flush=True)

            # Run send task in background
            asyncio.create_task(send_dummy_audio())
            
            # Send initial message to provoke a response
            # Note: For initial connection text usage we might need to send it explicitly if session is new
            # But the user logs show immediate disconnection loop.
            
            async for response in session.receive():
                # print(f"DEBUG: Session received response: {response}", flush=True) 
                server_content = response.server_content
                if server_content is None:
                    continue
                
                if server_content.turn_complete:
                        print("DEBUG: Gemini indicates turn_complete", flush=True)

                model_turn = server_content.model_turn
                if model_turn is None:
                    continue
                
                print("DEBUG: Received model turn content", flush=True)
                break

    except Exception as e:
        print(f"Gemini Connection Error: {e}", flush=True)
        # traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(debug_live())
