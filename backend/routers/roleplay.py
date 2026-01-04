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
        await websocket.accept()
        
        while True:
            # print("DEBUG: Establishing new Gemini Live API session...", flush=True)
            try:
                # 2. Initialize Gemini Live API Session
                # Best Practice: Enable session_resumption
                async with client.aio.live.connect(
                    model=config["model"],
                    config=types.LiveConnectConfig(
                        response_modalities=config["response_modalities"],
                        system_instruction=types.Content(parts=[types.Part(text=system_instruction)]),
                        session_resumption=True
                    )
                ) as session:
                    print("DEBUG: Connected to Gemini Live API Successfully", flush=True)

                    # 3. Bi-directional Streaming Loop
                    
                    # Task to receive from Gemini and send to Client
                    async def send_to_client():
                        print("DEBUG: Starting send_to_client loop", flush=True)
                        try:
                            async for response in session.receive():
                                server_content = response.server_content
                                if server_content is None:
                                    continue
                                
                                if server_content.turn_complete:
                                     print("DEBUG: Gemini indicates turn_complete", flush=True)

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
                                message = await websocket.receive_json()
                                
                                if "audio" in message:
                                    import base64
                                    audio_data = base64.b64decode(message["audio"])
                                    
                                    if len(audio_data) == 0:
                                        continue

                                    # Basic silence check 
                                    is_silence = all(b == 0 for b in audio_data[:100])
                                    print(f"DEBUG: Received audio len={len(audio_data)}, is_silence_start={is_silence}", flush=True)

                                    # Best Practice: send_realtime_input for low-latency streaming
                                    # Best Practice: send_realtime_input for low-latency streaming
                                    try:
                                        await session.send_realtime_input(
                                            media=types.Blob(data=audio_data, mime_type="audio/pcm;rate=16000")
                                        )
                                    except Exception as send_err:
                                        print(f"Error in session.send_realtime_input: {send_err} - Closing connection", flush=True)
                                        break 
                                
                                if "control" in message:
                                     pass
                                    
                        except WebSocketDisconnect:
                             print("DEBUG: Client disconnected (WebSocketDisconnect)", flush=True)
                             raise # Propagate to trigger outer break
                        except Exception as e:
                            print(f"Error receiving from client: {e}", flush=True)
                            raise # Propagate errors to restart or exit
                        finally:
                            print("DEBUG: receive_from_client loop finished", flush=True)

                    # Run tasks
                    send_task = asyncio.create_task(send_to_client())
                    receive_task = asyncio.create_task(receive_from_client())
                    
                    done, pending = await asyncio.wait(
                        [send_task, receive_task], 
                        return_when=asyncio.FIRST_COMPLETED
                    )

                    # Cancel pending tasks
                    for task in pending:
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass
                    
                    # Check who finished
                    if receive_task in done:
                        # Client disconnected or error -> Stop everything
                        print("DEBUG: Client side closed/failed. Ending session.", flush=True)
                        break 
                    else:
                        # Gemini side closed -> Loop will continue and Reconnect
                        print("DEBUG: Gemini side closed. Reconnecting...", flush=True)
                        continue

            except Exception as gemini_err:
                 print(f"Gemini Connection Error: {gemini_err}. Reconnecting in 1s...", flush=True)
                 await asyncio.sleep(1)
                 continue # Retry loop

    except Exception as e:
        print(f"Gemini Live API Error: {e}", flush=True)
        traceback.print_exc()
    finally:
        print("DEBUG: Cleanly closing WebSocket", flush=True)
        try:
             await websocket.close()
        except:
            pass
