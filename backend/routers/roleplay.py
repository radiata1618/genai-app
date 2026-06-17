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
# from services.ai_shared import get_genai_client
from config import GEMINI_LIVE_MODEL

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
        "model": GEMINI_LIVE_MODEL, 
        "response_modalities": ["AUDIO"]
    }
    
    # 1. 初期セットアップフェーズ
    current_session_handle = None
    system_instruction = "You are a helpful English tutor. Engage in a roleplay conversation."
    mic_mode = "hands-free"

    try:
        # クライアントから設定を受信
        # フォーマット: { "type": "setup", "config": { ... }, "context": { ... }, "history": [ ... ] }
        init_data = await websocket.receive_json()
        print(f"DEBUG: Received setup data: {init_data}", flush=True)
        
        if init_data.get("type") == "setup":
             # クライアントからモデル指定があれば設定を上書き
             if init_data.get("model"):
                 config["model"] = init_data["model"]
                 print(f"DEBUG: Using model from client: {config['model']}", flush=True)

             # コンテキストに基づいてシステム指示を構築
             context = init_data.get("context", {})
             if context.get("prompt"):
                 # フロントエンドから個別のシステムプロンプトが指定された場合はそれを優先
                 system_instruction = context["prompt"]
                 print(f"DEBUG: Using custom system instruction from client: {system_instruction[:50]}...", flush=True)
             else:
                 if context.get("topic"):
                     system_instruction += f"\n\nTopic: {context['topic']}"
                 if context.get("role"):
                     system_instruction += f"\nRole: {context['role']}"
                 if context.get("phrases"):
                     phrases_str = ", ".join([p.get('english', '') for p in context['phrases']])
                     system_instruction += f"\n\nTarget Phrases to use/check: {phrases_str}"

             # 過去の会話履歴をコンテキストとして追加
             history = init_data.get("history", [])
             if history:
                 history_lines = []
                 for h in history:
                     sender = "User" if h.get("sender") == "user" else "AI"
                     text = h.get("text", "")
                     if text:
                         history_lines.append(f"{sender}: {text}")
                 if history_lines:
                     history_str = "\n".join(history_lines)
                     system_instruction += f"\n\n[Previous Conversation History]\n{history_str}\n\nPlease continue the roleplay based on the previous conversation history above."
                     print(f"DEBUG: Injected history ({len(history_lines)} lines) into system instruction", flush=True)
             
             # クライアントからセッションハンドルが提供された場合、復元を試みる
             if init_data.get("session_handle"):
                 current_session_handle = init_data.get("session_handle")
                 print(f"DEBUG: Restoring session from client handle: {current_session_handle[:10]}...", flush=True)

             # マイクモードの取得
             if init_data.get("mic_mode"):
                 mic_mode = init_data.get("mic_mode")
                 print(f"DEBUG: Mic mode from client: {mic_mode}", flush=True)

    except Exception as e:
        print(f"Error during setup: {e}")
        await websocket.close()
        return

    # 2. Gemini Live API への接続
    try:
        # current_session_handle は上記で初期化済み（提供された場合）

        while True:
            try:
                # Gemini Live API セッションを初期化
                print(f"DEBUG: Connecting to Live API...", flush=True)

                if current_session_handle:
                    print(f"DEBUG: Resuming session with handle: {current_session_handle[:10]}...", flush=True)
                    session_config = types.LiveConnectConfig(
                        response_modalities=config["response_modalities"],
                        session_resumption=types.SessionResumptionConfig(handle=current_session_handle),
                        output_audio_transcription=types.AudioTranscriptionConfig(),
                        input_audio_transcription=types.AudioTranscriptionConfig()
                    )
                else:
                    realtime_input_config = None
                    try:
                        if mic_mode == "push-to-talk":
                            realtime_input_config = types.RealtimeInputConfig(
                                automatic_activity_detection=types.AutomaticActivityDetection(
                                    disabled=True  # PTTモード時はVADを無効化
                                )
                            )
                            print("DEBUG: PTT mode - Automatic VAD disabled", flush=True)
                        else:
                            realtime_input_config = types.RealtimeInputConfig(
                                automatic_activity_detection=types.AutomaticActivityDetection(
                                    disabled=False  # Hands-Freeモード時はVADを有効化
                                )
                            )
                            print(f"DEBUG: {mic_mode} mode - Automatic VAD enabled", flush=True)
                    except (AttributeError, TypeError) as vad_err:
                        print(f"DEBUG: VAD config not supported by SDK: {vad_err}", flush=True)
                        realtime_input_config = None

                    thinking_enabled = init_data.get("thinking_enabled", True)
                    connect_config_kwargs = {
                        "response_modalities": config["response_modalities"],
                        "system_instruction": types.Content(parts=[types.Part(text=system_instruction)]),
                        "session_resumption": types.SessionResumptionConfig(transparent=True),
                        "output_audio_transcription": types.AudioTranscriptionConfig(),
                        "input_audio_transcription": types.AudioTranscriptionConfig()
                    }
                    if not thinking_enabled:
                        connect_config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
                        print("DEBUG: Thinking process disabled in roleplay session", flush=True)

                    if realtime_input_config is not None:
                        connect_config_kwargs["realtime_input_config"] = realtime_input_config

                    session_config = types.LiveConnectConfig(**connect_config_kwargs)

                async with client.aio.live.connect(
                    model=config["model"],
                    config=session_config
                ) as session:
                    print("DEBUG: Connected to Gemini Live API Successfully", flush=True)

                    # 3. 双方向ストリーミングループ
                    
                    # Geminiからの受信 → クライアントへ転送
                    async def send_to_client():
                        nonlocal current_session_handle
                        print("DEBUG: Starting send_to_client loop", flush=True)
                        try:
                            async for response in session.receive():
                                server_content = response.server_content

                                # 割り込みの検出 (ユーザーがモデルの返答中に発話した場合)
                                if server_content is not None and getattr(server_content, "interrupted", False):
                                    print("DEBUG: Gemini indicates interrupted (user speech detected)", flush=True)
                                    await websocket.send_json({
                                        "type": "interrupted"
                                    })

                                # セッション再開トークンの更新
                                if response.session_resumption_update:
                                    if response.session_resumption_update.new_handle:
                                        current_session_handle = response.session_resumption_update.new_handle
                                        print(f"DEBUG: Updated Session Handle: {current_session_handle[:10]}...", flush=True)
                                        # クライアントにハンドルを同期
                                        await websocket.send_json({
                                            "type": "session_update",
                                            "session_handle": current_session_handle
                                        })

                                # ユーザー音声文字起こし(input_audio_transcription)の処理
                                if hasattr(response, "input_audio_transcription") and response.input_audio_transcription:
                                    user_text = response.input_audio_transcription.text
                                    if user_text:
                                        print(f"DEBUG: User Transcript: {user_text}", flush=True)
                                        await websocket.send_json({
                                            "type": "user_transcript",
                                            "text": user_text
                                        })

                                if server_content is None:
                                    continue
                                
                                # モデル音声文字起こし(output_transcription)の処理
                                if hasattr(server_content, "output_transcription") and server_content.output_transcription:
                                    model_text = server_content.output_transcription.text
                                    if model_text:
                                        print(f"DEBUG: Model Transcript: {model_text}", flush=True)
                                        await websocket.send_json({
                                            "type": "model_transcript",
                                            "text": model_text
                                        })

                                if server_content.turn_complete:
                                     print("DEBUG: Gemini indicates turn_complete", flush=True)
                                     await websocket.send_json({
                                         "type": "turn_complete"
                                     })

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
                                    # 予備として parts 内の text も処理
                                    if part.text:
                                        await websocket.send_json({
                                            "type": "model_transcript",
                                            "text": part.text
                                        })
                        except Exception as e:
                            print(f"Error sending to client: {e}", flush=True)
                        finally:
                            print("DEBUG: send_to_client loop finished - Server likely closed stream", flush=True)

                    # クライアントからの受信 → Geminiへ転送
                    async def receive_from_client():
                        print("DEBUG: Starting receive_from_client loop", flush=True)
                        try:
                            while True:
                                message = await websocket.receive_json()
                                
                                # ハートビート Ping への応答
                                if message.get("type") == "ping":
                                    await websocket.send_json({"type": "pong"})
                                    continue

                                # PTT開始: GeminiにActivityStartを通知（発話開始シグナル）
                                if message.get("type") == "ptt_start":
                                    try:
                                        await session.send_realtime_input(
                                            activity_start=types.ActivityStart()
                                        )
                                        print("DEBUG: Sent ActivityStart to Gemini", flush=True)
                                    except Exception as e:
                                        print(f"Error sending ActivityStart: {e}", flush=True)
                                    continue

                                # PTT終了: GeminiにActivityEndを通知（発話終了シグナル）
                                if message.get("type") == "ptt_end":
                                    try:
                                        await session.send_realtime_input(
                                            activity_end=types.ActivityEnd()
                                        )
                                        print("DEBUG: Sent ActivityEnd to Gemini", flush=True)
                                    except Exception as e:
                                        print(f"Error sending ActivityEnd: {e}", flush=True)
                                    continue

                                if "audio" in message:
                                    import base64
                                    audio_data = base64.b64decode(message["audio"])
                                    
                                    if len(audio_data) == 0:
                                        continue

                                    # 無音チェック
                                    is_silence = all(b == 0 for b in audio_data[:100])
                                    print(f"DEBUG: Received audio len={len(audio_data)}, is_silence_start={is_silence}", flush=True)

                                    # 低遅延ストリーミング送信 (クライアントの8000Hz化に合わせてrate=8000に変更)
                                    try:
                                        await session.send_realtime_input(
                                            media=types.Blob(data=audio_data, mime_type="audio/pcm;rate=8000")
                                        )
                                    except Exception as send_err:
                                        print(f"Error in session.send_realtime_input: {send_err} - Closing connection", flush=True)
                                        break 

                                if "control" in message:
                                     pass
                                    
                        except WebSocketDisconnect:
                             print("DEBUG: Client disconnected (WebSocketDisconnect)", flush=True)
                             raise # 上位に伝播してループを抜ける
                        except Exception as e:
                            print(f"Error receiving from client: {e}", flush=True)
                            raise # エラーを上位に伝播
                        finally:
                            print("DEBUG: receive_from_client loop finished", flush=True)

                    # タスク実行
                    send_task = asyncio.create_task(send_to_client())
                    receive_task = asyncio.create_task(receive_from_client())
                    
                    done, pending = await asyncio.wait(
                        [send_task, receive_task], 
                        return_when=asyncio.FIRST_COMPLETED
                    )

                    # ペンディングタスクをキャンセル
                    for task in pending:
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass
                    
                    # 終了したタスクの確認
                    if receive_task in done:
                        # クライアント切断またはエラー → 処理終了
                        print("DEBUG: Client side closed/failed. Ending session.", flush=True)
                        break 
                    else:
                        # Gemini側が切断 → 再接続ループへ
                        print("DEBUG: Gemini side closed. Reconnecting...", flush=True)
                        continue

            except Exception as gemini_err:
                err_str = str(gemini_err)
                print(f"Gemini Connection Error: {gemini_err}", flush=True)

                # セッションハンドルが無効・失効した場合はリセットして新規接続にフォールバック
                if current_session_handle and (
                    "invalid" in err_str.lower() or 
                    "expired" in err_str.lower() or
                    "not found" in err_str.lower() or
                    "handle" in err_str.lower()
                ):
                    print(f"DEBUG: Session handle invalid/expired. Resetting to new session.", flush=True)
                    current_session_handle = None
                    await asyncio.sleep(1)
                    continue  # 新規セッションで再試行

                print(f"Retrying in 2s...", flush=True)
                await asyncio.sleep(2)
                continue  # 接続リトライ

    except Exception as e:
        print(f"Gemini Live API Error: {e}", flush=True)
        traceback.print_exc()
    finally:
        print("DEBUG: Cleanly closing WebSocket", flush=True)
        try:
             await websocket.close()
        except:
            pass
