import os
import json
import asyncio
import traceback
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
from database import get_db
# Helper to fetch context
from routers.english import PreparationTask, Phrase

router = APIRouter(
    prefix="/roleplay",
    tags=["roleplay"],
)

client = genai.Client(
    vertexai=True,
    project=os.getenv("PROJECT_ID"),
    location=os.getenv("LOCATION", "us-central1"),
    http_options={'api_version': 'v1beta1'}
)

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("DEBUG: WebSocket connected", flush=True)

    # Session Config
    config = {
        "model": "gemini-live-2.5-flash-preview-native-audio-09-2025", 
        "response_modalities": ["AUDIO"]
    }
    
    # 1. Initial Setup Phase
    try:
        # Wait for client to send configuration/context
        # Message format: { "type": "setup", "config": { ... }, "context": { ... } }
        init_data = await websocket.receive_json()
        print(f"DEBUG: Received setup data: {init_data}", flush=True)
        
        system_instruction = "You are a helpful English tutor. Engage in a roleplay conversation."
        
        if init_data.get("type") == "setup":
             # Build System Instruction based on context
             context = init_data.get("context", {})
             if context.get("topic"):
                 system_instruction += f"\n\nTopic: {context['topic']}"
             if context.get("role"):
                 system_instruction += f"\nRole: {context['role']}"
             if context.get("phrases"):
                 phrases_str = ", ".join([p.get('english', '') for p in context['phrases']])
                 system_instruction += f"\n\nTarget Phrases to use/check: {phrases_str}"

    except Exception as e:
        print(f"Error during setup: {e}")
        await websocket.close()
        return

    # 2. Connect to Gemini Live API
    try:
        print(f"DEBUG: Attempting to connect to Gemini Live API with model: {config['model']}", flush=True)
        async with client.aio.live.connect(
            model=config["model"],
            config=types.LiveConnectConfig(
                response_modalities=config["response_modalities"],
                system_instruction=types.Content(parts=[types.Part(text=system_instruction)])
            )
        ) as session:
            print("DEBUG: Connected to Gemini Live API Successfully", flush=True)

            # 3. Bi-directional Streaming Loop
            
            # Task to receive from Gemini and send to Client
            async def send_to_client():
                print("DEBUG: Starting send_to_client loop", flush=True)
                try:
                    async for response in session.receive():
                        # print("DEBUG: Received response from Gemini", flush=True) 
                        server_content = response.server_content
                        if server_content is None:
                            continue
                        
                        model_turn = server_content.model_turn
                        if model_turn is None:
                            continue

                        parts = model_turn.parts
                        for part in parts:
                            if part.inline_data:
                                print(f"DEBUG: Sending audio chunk to client (len={len(part.inline_data.data)})", flush=True)
                                import base64
                                b64_audio = base64.b64encode(part.inline_data.data).decode("utf-8")
                                await websocket.send_json({"audio": b64_audio})
                except Exception as e:
                    print(f"Error sending to client: {e}", flush=True)
                finally:
                    print("DEBUG: send_to_client loop finished", flush=True)

            # Task to receive from Client and send to Gemini
            async def receive_from_client():
                print("DEBUG: Starting receive_from_client loop", flush=True)
                try:
                    while True:
                        # print("DEBUG: Waiting for client message", flush=True) 
                        message = await websocket.receive_json()
                        
                        if "audio" in message:
                            # Forward to Gemini
                            import base64
                            audio_data = base64.b64decode(message["audio"])
                            
                            # print(f"DEBUG: Received audio from client (len={len(audio_data)})", flush=True)
                            
                            if len(audio_data) == 0:
                                print("DEBUG: Received empty audio chunk", flush=True)
                                continue

                            # Basic silence check (first 100 bytes)
                            is_silence = all(b == 0 for b in audio_data[:100])
                            print(f"DEBUG: Received audio len={len(audio_data)}, is_silence_start={is_silence}", flush=True)

                            # Send using standard session.send with LiveClientRealtimeInput structure
                            # Content object failed, so we use the specific dict structure for verify Live API input.
                            try:
                                await session.send(input={"media_chunks": [{"mime_type": "audio/pcm;rate=16000", "data": audio_data}]}, end_of_turn=False)
                            except Exception as send_err:
                                print(f"Error in session.send: {send_err}", flush=True)
                        
                        if "control" in message:
                            pass
                            
                except WebSocketDisconnect:
                     print("DEBUG: Client disconnected (WebSocketDisconnect)", flush=True)
                except Exception as e:
                    print(f"Error receiving from client: {e}", flush=True)
                finally:
                    print("DEBUG: receive_from_client loop finished", flush=True)

            # Run tasks
            await asyncio.gather(send_to_client(), receive_from_client())

    except Exception as e:
        print(f"Gemini Live API Error: {e}", flush=True)
        traceback.print_exc()
    finally:
        print("DEBUG: Cleanly closing WebSocket", flush=True)
        try:
             await websocket.close()
        except:
            pass
