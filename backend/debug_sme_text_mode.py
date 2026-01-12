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
        # Config: Audio Modality + Output Transcription
        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=types.Content(parts=[types.Part(text="Output ONLY in Japanese. Say 'Hello'.")]),
            output_audio_transcription=types.AudioTranscriptionConfig()
        )

        print(f"DEBUG: Connecting (Vertex AI Mode)...")
        async with client.aio.live.connect(model=model_name, config=config) as session:
            print("DEBUG: Connected! Sending dummy text input...")
            
            # Send simple text input to trigger response
            await session.send(input="Hello", end_of_turn=True)
            
            print("DEBUG: Waiting for response...")
            received_transcription = False
            
            async for response in session.receive():
                server_content = response.server_content
                if server_content:
                    # Check for Transcription
                    if hasattr(server_content, "output_transcription") and server_content.output_transcription:
                         text_part = server_content.output_transcription.text
                         if text_part:
                             print(f"SUCCESS: Received Transcript Chunk: '{text_part}'")
                             received_transcription = True

                    if server_content.turn_complete:
                        print("DEBUG: Turn Complete")
                        break
            
            if received_transcription:
                print("RESULT: OK - Transcription received")
            else:
                print("RESULT: FAIL - No transcription received (only audio probably)")
                
    except Exception as e:
        print(f"ERROR: Connection or Runtime Failed: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_audio_transcription_config())
