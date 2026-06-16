import os
import json
import asyncio
import traceback
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
from config import GEMINI_LIVE_MODEL

router = APIRouter(
    prefix="/agent",
    tags=["agent"],
)

# Vertex AIの設定を読み込んでGenAIクライアントを初期化
client = genai.Client(
    vertexai=True,
    project=os.getenv("PROJECT_ID"),
    location=os.getenv("LOCATION", "us-central1"),
    http_options={'api_version': 'v1beta1'}
)

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # クライアントからのWebSocket接続を確立
    await websocket.accept()
    print("DEBUG (Agent): WebSocket connected", flush=True)

    # セッション設定（日本語音声およびテキスト出力）
    selected_model_key = "gemini-2.5"
    current_session_handle = None
    
    # 統合AIアシスタント用のシステム指示定義（日本語で動作）
    system_instruction = (
        "あなたは日本語を話す、極めて優秀で親切な統合AIアシスタントです。\n"
        "ユーザーの対話相手として、親身にかつ論理的に受け受け答えを行ってください。\n"
        "返答は自然な日本語（です・ます調）で行い、リアルタイム音声会話に適した形で、簡潔かつ明瞭に話してください。\n"
        "将来的にタスク管理やDBAの操作等の機能がここに追加される予定です。まずは親切に会話を行ってください。"
    )

    try:
        # クライアントから初期セットアップデータを受信
        init_data = await websocket.receive_json()
        print(f"DEBUG (Agent): Received setup data: {init_data}", flush=True)
        
        if init_data.get("type") == "setup":
             if init_data.get("model"):
                 selected_model_key = init_data.get("model")
             # クライアントからセッションハンドルが提供された場合、復元を試みる
             if init_data.get("session_handle"):
                 current_session_handle = init_data.get("session_handle")
                 print(f"DEBUG (Agent): Restoring session from client handle: {current_session_handle[:10]}...", flush=True)

    except Exception as e:
        print(f"Error during agent setup: {e}")
        await websocket.close()
        return

    # モデル選択の解決
    if selected_model_key == "gemini-3.1":
        model_id = "gemini-3-flash-preview"
    else:
        model_id = GEMINI_LIVE_MODEL

    config = {
        "model": model_id, 
        "response_modalities": ["AUDIO"] # Live API は AUDIO を指定するとテキストも自動的に返します
    }

    # Gemini Live API への接続と双方向中継
    try:
        while True:
            try:
                print(f"DEBUG (Agent): Connecting to Live API...", flush=True)

                if current_session_handle:
                    print(f"DEBUG (Agent): Resuming session with handle: {current_session_handle[:10]}...", flush=True)
                    session_config = types.LiveConnectConfig(
                        response_modalities=config["response_modalities"],
                        session_resumption=types.SessionResumptionConfig(handle=current_session_handle)
                    )
                else:
                    session_config = types.LiveConnectConfig(
                        response_modalities=config["response_modalities"],
                        system_instruction=types.Content(parts=[types.Part(text=system_instruction)]),
                        session_resumption=types.SessionResumptionConfig(transparent=True)
                    )

                async with client.aio.live.connect(
                    model=config["model"],
                    config=session_config
                ) as session:
                    print("DEBUG (Agent): Connected to Gemini Live API Successfully", flush=True)

                    # Geminiからの音声データ受信 → クライアントへ転送
                    async def send_to_client():
                        nonlocal current_session_handle
                        print("DEBUG (Agent): Starting send_to_client loop", flush=True)
                        try:
                            async for response in session.receive():
                                server_content = response.server_content

                                # セッション再開トークンの更新処理
                                if response.session_resumption_update:
                                    if response.session_resumption_update.new_handle:
                                        current_session_handle = response.session_resumption_update.new_handle
                                        print(f"DEBUG (Agent): Updated Session Handle: {current_session_handle[:10]}...", flush=True)
                                        # クライアントにハンドルを同期
                                        await websocket.send_json({
                                            "type": "session_update",
                                            "session_handle": current_session_handle
                                        })

                                if server_content is None:
                                    continue
                                
                                if server_content.turn_complete:
                                     print("DEBUG (Agent): Gemini indicates turn_complete", flush=True)
                                     await websocket.send_json({"type": "turn_complete"})

                                model_turn = server_content.model_turn
                                if model_turn is None:
                                    continue

                                parts = model_turn.parts
                                for part in parts:
                                    # 音声データがある場合
                                    if part.inline_data:
                                        import base64
                                        b64_audio = base64.b64encode(part.inline_data.data).decode("utf-8")
                                        await websocket.send_json({"audio": b64_audio})
                                    
                                    # テキストデータ（字幕用）がある場合
                                    if part.text:
                                        print(f"DEBUG (Agent): Text transcript from Gemini: {part.text}", flush=True)
                                        await websocket.send_json({"text": part.text})
                        except Exception as e:
                            print(f"Error sending to client in Agent: {e}", flush=True)
                        finally:
                            print("DEBUG (Agent): send_to_client loop finished", flush=True)

                    # クライアントからのマイク音声またはテキスト受信 → Geminiへ転送
                    async def receive_from_client():
                        print("DEBUG (Agent): Starting receive_from_client loop", flush=True)
                        try:
                            while True:
                                message = await websocket.receive_json()
                                
                                # ハートビート Ping への応答
                                if message.get("type") == "ping":
                                    await websocket.send_json({"type": "pong"})
                                    continue

                                # クライアントからの音声データ
                                if "audio" in message:
                                    import base64
                                    audio_data = base64.b64decode(message["audio"])
                                    
                                    if len(audio_data) == 0:
                                        continue

                                    # 送信データの低遅延転送
                                    try:
                                        await session.send_realtime_input(
                                            media=types.Blob(data=audio_data, mime_type="audio/pcm;rate=16000")
                                        )
                                    except Exception as send_err:
                                        print(f"Error in agent session.send_realtime_input: {send_err}", flush=True)
                                        break 

                                # クライアントからのテキスト入力
                                if "text" in message:
                                    print(f"DEBUG (Agent): Received text input from client: {message['text']}", flush=True)
                                    try:
                                        await session.send(
                                            input=types.Content(
                                                role="user",
                                                parts=[types.Part(text=message["text"])]
                                            ),
                                            end_of_turn=True
                                        )
                                    except Exception as send_err:
                                        print(f"Error in agent session.send (text): {send_err}", flush=True)
                                        break
                                    
                        except WebSocketDisconnect:
                             print("DEBUG (Agent): Client disconnected", flush=True)
                             raise
                        except Exception as e:
                             print(f"Error receiving from client in Agent: {e}", flush=True)
                             raise
                        finally:
                             print("DEBUG (Agent): receive_from_client loop finished", flush=True)

                    # 双方向のストリーミング処理を非同期タスクとして実行
                    send_task = asyncio.create_task(send_to_client())
                    receive_task = asyncio.create_task(receive_from_client())
                    
                    done, pending = await asyncio.wait(
                        [send_task, receive_task], 
                        return_when=asyncio.FIRST_COMPLETED
                    )

                    # 残っている非同期タスクを安全にキャンセル
                    for task in pending:
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass
                    
                    if receive_task in done:
                        # クライアント切断時
                        print("DEBUG (Agent): Client side closed/failed. Ending agent session.", flush=True)
                        break 
                    else:
                        # Gemini接続切断時、再接続ループに入る
                        print("DEBUG (Agent): Gemini side closed. Reconnecting...", flush=True)
                        continue

            except Exception as gemini_err:
                err_str = str(gemini_err)
                print(f"Gemini Connection Error (Agent): {gemini_err}", flush=True)

                # ハンドルが無効、または期限切れの場合はリセット
                if current_session_handle and (
                    "invalid" in err_str.lower() or 
                    "expired" in err_str.lower() or
                    "not found" in err_str.lower() or
                    "handle" in err_str.lower()
                ):
                    print(f"DEBUG (Agent): Session handle invalid/expired. Resetting.", flush=True)
                    current_session_handle = None
                    await asyncio.sleep(1)
                    continue

                print(f"Retrying agent connection in 2s...", flush=True)
                await asyncio.sleep(2)
                continue

    except Exception as e:
        print(f"Gemini Live API Error (Agent): {e}", flush=True)
        traceback.print_exc()
    finally:
        print("DEBUG (Agent): Cleanly closing WebSocket", flush=True)
        try:
             await websocket.close()
        except:
            pass
