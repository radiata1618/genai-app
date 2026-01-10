import asyncio
import os
import traceback
from google import genai
from google.genai import types
from dotenv import load_dotenv
from pathlib import Path

# Load Env
env_path = Path(__file__).parent.parent / '.env.local'
load_dotenv(dotenv_path=env_path)

# Credentials Setup (Mimic ai_shared.py)
if os.getenv("GOOGLE_APPLICATION_CREDENTIALS") == "/app/key.json":
    if not os.path.exists("/app/key.json"):
        current_dir = os.path.dirname(os.path.abspath(__file__))
        local_key_path = os.path.join(current_dir, "key.json")
        if os.path.exists(local_key_path):
            print(f"Auto-fixing CREDENTIALS path to local: {local_key_path}")
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = local_key_path

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = "us-central1" # User suggested us-central1 should work with new IDs

def get_vertex_client():
    print(f"Initializing Vertex AI Client for Project: {PROJECT_ID}, Location: {LOCATION}")
    return genai.Client(
        vertexai=True,
        project=PROJECT_ID,
        location=LOCATION,
        http_options={'api_version': 'v1beta1'}
    )

async def list_available_models():
    print(f"\n--- Listing Available Models (Vertex AI @ {LOCATION}) ---")
    client = get_vertex_client()
    try:
        # Fix: await the list() call if it's a coroutine
        pager = await client.aio.models.list()
        async for model in pager:
            # Filter for likely Live API candidates
            if "gemini" in model.name.lower() and "flash" in model.name.lower():
                print(f"Model: {model.name} (DisplayName: {model.display_name})")
    except Exception as e:
        print(f"List Models Error: {e}")
        # Fallback inspection if await fails (SDK version dependent)
        # try:
        #     async for model in client.aio.models.list(): ...
        # except: pass

async def test_live_api_text_modality():
    # Last resort: The Audio-Native model, but with Transcription enabled.
    model_name = "gemini-live-2.5-flash-preview-native-audio-09-2025"
    print(f"\n--- Testing Live API: {model_name} (AUDIO Modality + Transcription @ {LOCATION}) ---")
    
    client = get_vertex_client()

    try:
        # Configure matches what works for connection + attempt transcription
        config_dict = {
            "response_modalities": ["AUDIO"], # MUST be AUDIO for this model
            "system_instruction": types.Content(parts=[types.Part(text="Hello. Respond with text.")]),
        }
        
        if hasattr(types, "AudioTranscriptionConfig"):
            print("Enabling AudioTranscriptionConfig...")
            config_dict["output_audio_transcription"] = types.AudioTranscriptionConfig()
            # input_audio_transcription is for USER audio. We are sending text trigger now, but eventually user sends audio.
            config_dict["input_audio_transcription"] = types.AudioTranscriptionConfig()
        
        # Test session_resumption
        config_dict["session_resumption"] = types.SessionResumptionConfig(transparent=True)
        
        config = types.LiveConnectConfig(**config_dict)

        print(f"Connecting to {model_name}...")
        async with client.aio.live.connect(model=model_name, config=config) as session:
            print(f"SUCCESS: Connected to {model_name}!")
            
            # Send trigger
            await session.send(input="Hello", end_of_turn=True)
            
            print("Waiting for response...")
            async for response in session.receive():
                server_content = response.server_content
                
                # Check Transcript explicitly (ServerContent level)
                if hasattr(server_content, "output_transcription") and server_content.output_transcription:
                     print(f"!!! OUTPUT TRANSCRIPTION FOUND !!!: {server_content.output_transcription}")
                
                # Also check inside model_turn parts just in case text slips in?
                if server_content and server_content.model_turn:
                     for part in server_content.model_turn.parts:
                        if part.text:
                            print(f" - TEXT PART: {part.text}")
                        if part.inline_data:
                            print(f" - AUDIO DATA: {len(part.inline_data.data)} bytes")

                if server_content and server_content.turn_complete:
                    print("Turn Complete")
                    break
            
            return True

    except Exception as e:
        print(f"FAILED {model_name}: {e}")
        return False

if __name__ == "__main__":
    asyncio.run(list_available_models())
    asyncio.run(test_live_api_text_modality())
