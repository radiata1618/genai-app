import asyncio
import os
import math
import struct
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
    print(f"Testing send_realtime_input on {MODEL_ID}")
    pcm_data = generate_sine_wave(duration_sec=30.0) 
    chunk_size = 2048 # Matches Frontend
    chunks = [pcm_data[i:i+chunk_size] for i in range(0, len(pcm_data), chunk_size)]
    
    try:
        async with client.aio.live.connect(
            model=MODEL_ID,
            config=types.LiveConnectConfig(response_modalities=["AUDIO"])
        ) as session:
            print("Connected.")
            
            async def send_loop():
                print(f"Starting Send Loop ({len(chunks)} chunks)...")
                try:
                    for i, chunk in enumerate(chunks):
                        # Use send_realtime_input
                        await session.send_realtime_input(
                            media=types.Blob(data=chunk, mime_type="audio/pcm;rate=16000")
                        )
                        await asyncio.sleep(0.06) 
                    print("Send Loop Finished.")
                except Exception as e:
                    print(f"Send Loop Error: {e}")
                    traceback.print_exc()

            async def receive_loop():
                print("Starting Receive Loop...")
                try:
                    async for response in session.receive():
                        server_content = response.server_content
                        if server_content:
                            if server_content.turn_complete:
                                print(f" [Turn Complete] ", end="", flush=True)
                            if server_content.model_turn:
                                print("R", end="", flush=True)
                except Exception as e:
                    print(f"\nReceive Loop Error: {e}")
                finally:
                    print("\nReceive Loop EXITING - Session Closed or Iterator Stopped.")

            # Run concurrently
            await asyncio.gather(send_loop(), receive_loop())

    except Exception as e:
        print(f"Main Error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
