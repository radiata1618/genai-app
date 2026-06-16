import os
import json
import asyncio
import traceback
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import genai
from google.genai import types
from google.cloud.firestore import FieldFilter
from config import GEMINI_LIVE_MODEL
from services.ai_shared import get_firestore_client

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

async def get_dab_context():
    """FirestoreからDABのアクティブトピックとユーザーの長期記憶を読み込み、スピーキング用の文脈を作成する"""
    try:
        db = get_firestore_client()
        # ACTIVEなトピックの取得
        topics_ref = db.collection("dab_hot_topics").where(filter=FieldFilter("status", "==", "ACTIVE")).stream()
        topics = []
        for doc in topics_ref:
            data = doc.to_dict()
            topics.append(f"- {data.get('name', 'Untitled')}: {data.get('description', '')}")
        topics_str = "\n".join(topics) if topics else "特に登録されていません。"

        # ユーザーメモリの取得
        memory_ref = db.collection("dab_user_memory").document("default_user").get()
        learning_goals = "設定されていません。"
        known_concepts_str = "登録されていません。"
        if memory_ref.exists:
            mem_data = memory_ref.to_dict()
            learning_goals = mem_data.get("learning_goals", "設定されていません。")
            known_concepts = mem_data.get("known_concepts", [])
            if known_concepts:
                known_concepts_str = ", ".join(known_concepts)

        return {
            "topics": topics_str,
            "learning_goals": learning_goals,
            "known_concepts": known_concepts_str
        }
    except Exception as e:
        print(f"Error fetching DAB context: {e}")
        return {
            "topics": "取得エラー",
            "learning_goals": "取得エラー",
            "known_concepts": "取得エラー"
        }

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # クライアントからのWebSocket接続を確立
    await websocket.accept()
    print("DEBUG (Agent): WebSocket connected", flush=True)

    # セッション設定
    selected_model_key = "gemini-2.5"
    current_session_handle = None
    language = "ja"
    mode = "normal"
    mic_mode = "hands-free"  # "hands-free" | "push-to-talk" | "muted"

    try:
        # クライアントから初期セットアップデータを受信
        init_data = await websocket.receive_json()
        print(f"DEBUG (Agent): Received setup data: {init_data}", flush=True)
        
        if init_data.get("type") == "setup":
             if init_data.get("model"):
                 selected_model_key = init_data.get("model")
             if init_data.get("language"):
                 language = init_data.get("language")
             if init_data.get("mode"):
                 mode = init_data.get("mode")
             # マイクモードの取得（PTTモードではVADを無効化する）
             if init_data.get("mic_mode"):
                 mic_mode = init_data.get("mic_mode")
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
        "response_modalities": ["AUDIO"] 
    }

    # 動的なシステムプロンプト（system_instruction）の構築
    if mode == "dab":
        dab_data = await get_dab_context()
        if language == "en":
            system_instruction = (
                "You are a professional IT & Data Architecture expert and an English speaking coach.\n"
                "You will conduct a technology discussion and roleplay with the user about their active Tech topics and learning goals.\n\n"
                f"User's Learning Goals:\n{dab_data['learning_goals']}\n\n"
                f"Current Active Tech Topics:\n{dab_data['topics']}\n\n"
                f"User's Known Concepts:\n{dab_data['known_concepts']}\n\n"
                "Role: Engage in a highly interactive discussion. Ask sharp, expert-level questions to the user about these topics to test their understanding or let them explain the architecture. Speak strictly in English.\n"
                "Keep your responses concise and natural for a realtime audio conversation."
            )
        else:  # "ja"
            system_instruction = (
                "あなたはデータアーキテクチャおよび最新技術の専門家であり、ユーザーの学習を支援する優秀なメンターです。\n"
                "ユーザーが登録している以下のDABアクティブトピックや学習目標について、技術的なディスカッションを行ってください。\n\n"
                f"ユーザーの学習目標:\n{dab_data['learning_goals']}\n\n"
                f"現在のアクティブトピック:\n{dab_data['topics']}\n\n"
                f"ユーザーの既知概念:\n{dab_data['known_concepts']}\n\n"
                "役割: ユーザーに対してこれらのトピックに関する質問を投げかけ、アーキテクチャの解説や意見を求めてください。会話はすべて日本語（です・ます調）で行い、リアルタイム音声対話に適した形で簡潔かつ明瞭に話してください。"
            )
    else:  # normal
        if language == "en":
            system_instruction = (
                "You are a friendly and professional English conversation partner.\n"
                "Engage in a natural, friendly chat with the user on any topic they bring up.\n"
                "Speak strictly in English. Keep your responses concise and clear, suitable for real-time audio conversation. "
                "If the user makes grammatical errors, gently correct them or suggest better phrasing if appropriate, but keep the conversation flowing."
            )
        else:  # "ja"
            system_instruction = (
                "あなたは日本語を話す、極めて優秀で親切な統合AIアシスタントです。\n"
                "ユーザーの対話相手として、親身にかつ論理的に受け受け答えを行ってください。\n"
                "返答は自然な日本語（です・ます調）で行い、リアルタイム音声会話に適した形で、簡潔かつ明瞭に話してください。\n"
                "将来的にタスク管理やDBAの操作等の機能がここに追加される予定です。まずは親切に会話を行ってください。"
            )

    # 過去の会話履歴をコンテキストとして追加
    history = init_data.get("history", []) if 'init_data' in locals() else []
    if history:
        history_lines = []
        for h in history:
            sender = "User" if h.get("sender") == "user" else "AI"
            text = h.get("text", "")
            if text:
                history_lines.append(f"{sender}: {text}")
        if history_lines:
            history_str = "\n".join(history_lines)
            system_instruction += f"\n\n[Previous Conversation History]\n{history_str}\n\nPlease continue the conversation based on the previous conversation history above."
            print(f"DEBUG (Agent): Injected history ({len(history_lines)} lines) into system instruction", flush=True)

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
                    # PTTモードの場合はAutomatic VADを無効化し、ActivityStart/Endで発話区区を明示的に制御する
                    if mic_mode == "push-to-talk":
                        realtime_input_config = types.RealtimeInputConfig(
                            automatic_activity_detection=types.AutomaticActivityDetection(
                                disabled=True  # PTTモード時はVADを無効化
                            )
                        )
                        print("DEBUG (Agent): PTT mode - Automatic VAD disabled", flush=True)
                    else:
                        realtime_input_config = types.RealtimeInputConfig(
                            automatic_activity_detection=types.AutomaticActivityDetection(
                                disabled=False  # Hands-Freeモード時はVADを有効化
                            )
                        )
                        print(f"DEBUG (Agent): {mic_mode} mode - Automatic VAD enabled", flush=True)

                    session_config = types.LiveConnectConfig(
                        response_modalities=config["response_modalities"],
                        system_instruction=types.Content(parts=[types.Part(text=system_instruction)]),
                        session_resumption=types.SessionResumptionConfig(transparent=True),
                        realtime_input_config=realtime_input_config
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

                                # 割り込みの検出 (ユーザーがモデルの返答中に発話した場合)
                                if server_content is not None and getattr(server_content, "interrupted", False):
                                    print("DEBUG (Agent): Gemini indicates interrupted (user speech detected)", flush=True)
                                    await websocket.send_json({
                                        "type": "interrupted"
                                    })

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

                                # PTT開始: GeminiにActivityStartを通知（発話開始シグナル）
                                if message.get("type") == "ptt_start":
                                    try:
                                        await session.send_realtime_input(
                                            activity_start=types.ActivityStart()
                                        )
                                        print("DEBUG (Agent): Sent ActivityStart to Gemini", flush=True)
                                    except Exception as e:
                                        print(f"Error sending ActivityStart: {e}", flush=True)
                                    continue

                                # PTT終了: GeminiにActivityEndを通知（発話終了シグナル）
                                # これにより、無音状態でもGeminiが「ユーザーの発話が終わった」と認識して即座に返答する
                                if message.get("type") == "ptt_end":
                                    try:
                                        await session.send_realtime_input(
                                            activity_end=types.ActivityEnd()
                                        )
                                        print("DEBUG (Agent): Sent ActivityEnd to Gemini", flush=True)
                                    except Exception as e:
                                        print(f"Error sending ActivityEnd: {e}", flush=True)
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
