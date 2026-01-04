import asyncio
import os
import math
import struct
import base64
import traceback
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load env variables
load_dotenv(dotenv_path='.env.local')
if not os.getenv("GOOGLE_CLOUD_API_KEY"):
    load_dotenv(dotenv_path='../.env.local')

PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION", "us-central1")
MODEL_ID = "gemini-live-2.5-flash-preview-native-audio-09-2025"

print(f"DEBUG: Project: {PROJECT_ID}, Location: {LOCATION}, Model: {MODEL_ID}")

client = genai.Client(
    vertexai=True,
    project=PROJECT_ID,
    location=LOCATION,
    http_options={'api_version': 'v1beta1'}
)

# Generate Sine Wave Audio (16kHz, Mono, 16-bit PCM)
def generate_sine_wave(duration_sec=3.0, freq_hz=440.0, sample_rate=16000):
    print(f"Generating {duration_sec}s sine wave at {freq_hz}Hz...")
    num_samples = int(duration_sec * sample_rate)
    amplitude = 32767 * 0.5 # 50% volume
    samples = []
    for i in range(num_samples):
        t = float(i) / sample_rate
        value = int(amplitude * math.sin(2 * math.pi * freq_hz * t))
        samples.append(struct.pack('<h', value))
    return b''.join(samples)

async def main():
    pcm_data = generate_sine_wave()
    chunks = [pcm_data[i:i+4096] for i in range(0, len(pcm_data), 4096)]
    
    config = {"response_modalities": ["AUDIO"]}
    
    output_filename = "gemini_response.pcm"
    
    print(f"Connecting to {MODEL_ID}...")
    try:
        async with client.aio.live.connect(
            model=MODEL_ID,
            config=types.LiveConnectConfig(
                response_modalities=config["response_modalities"],
                system_instruction=types.Content(parts=[types.Part(text="You are a helpful assistant. Please say 'Hello, I received your audio' clearly.")])
            )
        ) as session:
            print("Connected.")
            
            # 0. Test Text Input (Handshake)
            print("Sending Text Handshake 'Hello'...")
            try:
                # Some versions accept string directly, or explicit Content
                await session.send(input="Hello", end_of_turn=True)
                print("Text handshake sent.")
            except Exception as e:
                print(f"Text handshake failed: {e}")

            # 1. Send Audio Chunks
            print(f"Sending {len(chunks)} chunks of audio...")
            for i, chunk in enumerate(chunks):
                realtime_input = {
                    "media_chunks": [
                        {
                            "mime_type": "audio/pcm;rate=16000",
                            "data": chunk
                        }
                    ]
                }
                await session.send(input=realtime_input, end_of_turn=(i == len(chunks) - 1))
                # Slight delay to simulate real streaming
                await asyncio.sleep(0.01)
            
            print("Finished sending. Waiting for response...")
            
            # 2. Receive Response
            with open(output_filename, "wb") as f:
                async for response in session.receive():
                    if response.server_content:
                        model_turn = response.server_content.model_turn
                        if model_turn:
                            for part in model_turn.parts:
                                if part.inline_data:
                                    # Write raw PCM data to file
                                    f.write(part.inline_data.data)
                                    print(f"Received audio chunk: {len(part.inline_data.data)} bytes")
                        
                        if response.server_content.turn_complete:
                            print("Turn complete.")
                            break
                            
            print(f"Response saved to {output_filename}")
            
            # Check file size
            if os.path.exists(output_filename):
                size = os.path.getsize(output_filename)
                print(f"Total Output Size: {size} bytes")
                if size > 0:
                    print("SUCCESS: Valid audio response received.")
                else:
                    print("FAILED: Output file is empty.")
            else:
                print("FAILED: Output file not created.")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
