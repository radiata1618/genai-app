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

def get_local_client():
    api_key = os.getenv("GOOGLE_CLOUD_API_KEY")
    return genai.Client(
        vertexai=False,
        api_key=api_key,
        http_options={'api_version': 'v1beta'}
    )

async def test_live_api_model(model_name):
    print(f"\n--- Testing Live API: {model_name} ---")
    client = get_local_client()
    
    config = types.LiveConnectConfig(
        response_modalities=["TEXT"],
        system_instruction=types.Content(parts=[types.Part(text="Hello, respond with TEXT if you can hear me.")])
    )

    try:
        print(f"Connecting to {model_name}...")
        async with client.aio.live.connect(model=model_name, config=config) as session:
            print(f"SUCCESS: Connected to {model_name}!")
            
            # Send a dummy message to trigger response
            print("Sending text input...")
            await session.send("Hello?", end_of_turn=True)
            
            print("Waiting for response...")
            async for response in session.receive():
                if response.server_content and response.server_content.model_turn:
                    print(f"Received Response from {model_name}:")
                    for part in response.server_content.model_turn.parts:
                        print(f" - {part.text}")
                    break
            
            return True

    except Exception as e:
        print(f"FAILED {model_name}: {e}")
        return False

async def main():
    models_to_test = [
        "gemini-2.0-flash-exp",
        "gemini-2.0-flash-001",
        "gemini-3-flash-preview",
        "gemini-1.5-flash-002",
        "gemini-1.5-pro-002"
    ]
    
    results = {}
    for model in models_to_test:
        success = await test_live_api_model(model)
        results[model] = "OK" if success else "FAIL"
        await asyncio.sleep(1)
        
    print("\n\n=== SUMMARY ===")
    for m, res in results.items():
        print(f"{m}: {res}")

if __name__ == "__main__":
    asyncio.run(main())
