import os
import asyncio
import traceback
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load environment variables
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')
if os.path.exists(env_path):
    print(f"DEBUG: Loading env from {env_path}")
    load_dotenv(dotenv_path=env_path)

# Verify Credentials
key_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'key.json')
if os.path.exists(key_path):
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path

async def test_audio_transcription_config():
    model_name = "gemini-live-2.5-flash-preview-native-audio-09-2025"
    print(f"\n--- Testing Model: {model_name} with Audio+Transcription ---")
    
    # Use Vertex AI Client (as in the app)
    project_id = os.getenv("PROJECT_ID")
    location = os.getenv("LOCATION", "us-central1")
    
    if not project_id:
        print("ERROR: PROJECT_ID not found in env")
        return

    client = genai.Client(
        vertexai=True,
        project=project_id,
        location=location,
        http_options={'api_version': 'v1beta1'}
    )

    try:
        # Config: Audio Modality + Output Transcription + Session Resumption
        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(parts=[types.Part(text="Output ONLY in Japanese. Say 'Hello' once, then wait.")]),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            session_resumption=types.SessionResumptionConfig(transparent=True)
        )

        print(f"DEBUG: Connecting (Vertex AI Mode)...")
        async with client.aio.live.connect(model=model_name, config=config) as session:
            print("DEBUG: Connected! Sending hello...")
            await session.send(input="Hello", end_of_turn=True)
            
            # Keep connection alive
            print("DEBUG: Entering keep-alive loop (10 seconds)...")
            
            async def send_keepalive():
                for i in range(10):
                    await asyncio.sleep(1)
                    print(f"DEBUG: Sending keepalive {i}...", flush=True)
                    # Send empty input or silence to keep session active?
                    # Or just wait. The session should not close immediately if idle.
                    # Let's verify if IDLE causes disconnect.
            
            async def receive_loop():
                async for response in session.receive():
                    server_content = response.server_content
                    if server_content:
                        if hasattr(server_content, "output_transcription") and server_content.output_transcription:
                             text_part = server_content.output_transcription.text
                             if text_part:
                                 print(f"SUCCESS: Transcript: '{text_part}'")
                        if server_content.turn_complete:
                            print("DEBUG: Turn Complete")
                print("DEBUG: receive_loop exited unexpectedly!")

            await asyncio.gather(send_keepalive(), receive_loop())

                
    except Exception as e:
        print(f"ERROR: Connection or Runtime Failed: {e}")
        traceback.print_exc()

async def test_silence_connection():
    model_name = "gemini-live-2.5-flash-preview-native-audio-09-2025"
    print(f"\n--- Testing Model: {model_name} (Silence / Idle Test) ---")
    
    project_id = os.getenv("PROJECT_ID")
    location = os.getenv("LOCATION", "us-central1")
    
    client = genai.Client(
        vertexai=True,
        project=project_id,
        location=location,
        http_options={'api_version': 'v1beta1'}
    )

    try:
        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(parts=[types.Part(text="Output ONLY in Japanese. Say 'Hello' once.")]),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            session_resumption=types.SessionResumptionConfig(transparent=True)
        )

        print(f"DEBUG: Connecting (Vertex AI Mode)...")
        async with client.aio.live.connect(model=model_name, config=config) as session:
            print("DEBUG: Connected! DOING NOTHING (Silence test)...")
            
            # Do NOT send any input. Just wait.
            start_time = asyncio.get_event_loop().time()
            
            try:
                # Wait for 10 seconds or until disconnect
                async for response in session.receive():
                    print(f"DEBUG: Received something: {response}")
                    if response.server_content and response.server_content.turn_complete:
                         print("DEBUG: Turn Complete")
            except Exception as e:
                print(f"DEBUG: Exception during receive: {e}")
            finally:
                end_time = asyncio.get_event_loop().time()
                print(f"DEBUG: Session ended after {end_time - start_time:.2f} seconds")

    except Exception as e:
        print(f"ERROR: Connection Failed: {e}")

if __name__ == "__main__":
    # asyncio.run(test_audio_transcription_config())
    asyncio.run(test_silence_connection())
