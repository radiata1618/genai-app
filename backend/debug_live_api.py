import asyncio
import os
import traceback
from google.genai import types
from google import genai
from dotenv import load_dotenv
from pathlib import Path

# Load Env
env_path = Path(__file__).parent.parent / '.env.local'
load_dotenv(dotenv_path=env_path)

def get_local_client():
    api_key = os.getenv("GOOGLE_CLOUD_API_KEY")
    return genai.Client(
        vertexai=True,
        api_key=api_key,
        http_options={'api_version': 'v1beta1'}
    )

async def test_live_api_connect():
    print("--- Testing Gemini Live API Connection (v2.0 Flash Exp) ---")
    client = get_local_client()
    
    model = "gemini-2.0-flash-exp"
    config = types.LiveConnectConfig(
        response_modalities=["TEXT"],
        system_instruction=types.Content(parts=[types.Part(text="Hello, are you active?")])
    )

    try:
        print(f"Attempting to connect to {model} with TEXT modality...")
        async with client.aio.live.connect(model=model, config=config) as session:
            print("Successfully connected!")
            print("Waiting for initial response...")
            await asyncio.sleep(2)
            print("Connection held open. Test Passed.")
            return True

    except Exception as e:
        print(f"Connection Failed: {e}")
        # traceback.print_exc()
        return False

async def test_standard_streaming():
    print("\n--- Testing Gemini 3 Flash Preview Standard Streaming ---")
    client = get_local_client()
    
    model = "gemini-3-flash-preview"
    prompt = "Hello, this is a test."
    
    try:
        print(f"Sending request to {model}...")
        response = await client.aio.models.generate_content(
            model=model,
            contents=prompt
        )
        print(f"Response: {response.text}")
        print("Standard API Test Passed.")
        return True
    except Exception as e:
        print(f"Standard API Failed: {e}")
        return False

async def main():
    # live_result = await test_live_api_connect()
    # if not live_result:
    #     print("!!! Live API (v2.0) Failed. You might need to use Standard Streaming. !!!")
    
    # Just test standard streaming for now as Live API is likely blocked
    await test_standard_streaming()

if __name__ == "__main__":
    asyncio.run(main())
