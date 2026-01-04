import asyncio
import os
import math
import struct
import base64
import traceback
from google import genai
from google.genai import types
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

def generate_sine_wave(duration_sec=10.0, freq_hz=440.0, sample_rate=16000):
    num_samples = int(duration_sec * sample_rate)
    amplitude = 32767 * 0.5
    samples = []
    for i in range(num_samples):
        t = float(i) / sample_rate
        value = int(amplitude * math.sin(2 * math.pi * freq_hz * t))
        samples.append(struct.pack('<h', value))
    return b''.join(samples)

async def main():
    pcm_data = generate_sine_wave(duration_sec=30.0) # 30 seconds of audio
    # Split into small chunks (2048 bytes = 0.064s)
    chunk_size = 2048
    chunks = [pcm_data[i:i+chunk_size] for i in range(0, len(pcm_data), chunk_size)]
    
    config = {"response_modalities": ["AUDIO"]}
    
    print(f"Connecting to {MODEL_ID}...")
    try:
        async with client.aio.live.connect(
            model=MODEL_ID,
            config=types.LiveConnectConfig(
                response_modalities=config["response_modalities"],
                system_instruction=types.Content(parts=[types.Part(text="You are a helper. Just listen and occasionally say 'Uh huh'.")])
            )
        ) as session:
            print("Connected.")
            
            # Concurrent Tasks
            async def send_loop():
                print(f"Starting Send Loop ({len(chunks)} chunks)...")
                try:
                    # Initial Handshake
                    await session.send(input="Hello", end_of_turn=True)
                    await asyncio.sleep(1)

                    for i, chunk in enumerate(chunks):
                        realtime_input = {
                            "media_chunks": [{"mime_type": "audio/pcm;rate=16000", "data": chunk}]
                        }
                        await session.send(input=realtime_input, end_of_turn=False)
                        # Simulate real-time streaming rate
                        # 2048 bytes / 2 bytes/sample / 16000 Hz = 0.064s
                        await asyncio.sleep(0.06) 
                    
                    print("Send Loop Finished.")
                except Exception as e:
                    print(f"Send Loop Error: {e}")
                    traceback.print_exc()

            async def receive_loop():
                print("Starting Receive Loop...")
                try:
                    async for response in session.receive():
                        if response.server_content:
                            print(".", end="", flush=True) # visual heartbeat
                            # model_turn = response.server_content.model_turn
                            # if model_turn:
                            #     print("R", end="", flush=True)
                except Exception as e:
                    print(f"\nReceive Loop Error: {e}")
                finally:
                    print("\nReceive Loop Terminated.")

            # Run concurrently
            await asyncio.gather(send_loop(), receive_loop())

    except Exception as e:
        print(f"Main Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
