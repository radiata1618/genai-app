from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from google.cloud import firestore
from database import get_db
import os
from google.genai import types
from services.ai_shared import get_genai_client
import uuid

router = APIRouter(
    prefix="/ai-chat",
    tags=["ai-chat"],
)

# Client is obtained via get_genai_client() inside endpoints or globally
client = get_genai_client()

# --- Models ---
class ChatMessage(BaseModel):
    role: str  # "user" or "model"
    content: str
    timestamp: Optional[datetime] = None
    grounding_metadata: Optional[dict] = None  # Using dict to store raw dynamic structure, or define specific Pydantic model

class ChatSessionCreate(BaseModel):
    title: Optional[str] = "New Chat"

class ChatSession(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    last_message: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    model: str = "gemini-3-flash-preview"
    image: Optional[str] = None # Base64 string
    mimeType: Optional[str] = None
    use_grounding: bool = True

# --- Endpoints ---

@router.post("/sessions", response_model=ChatSession)
async def create_session(req: ChatSessionCreate, db: firestore.Client = Depends(get_db)):
    session_id = str(uuid.uuid4())
    now = datetime.now()
    
    session_data = {
        "id": session_id,
        "title": req.title,
        "created_at": now,
        "updated_at": now,
        "last_message": None
    }
    
    db.collection("ai_chat_sessions").document(session_id).set(session_data)
    return ChatSession(**session_data)

@router.get("/sessions", response_model=List[ChatSession])
async def get_sessions(db: firestore.Client = Depends(get_db)):
    docs = db.collection("ai_chat_sessions").order_by("updated_at", direction=firestore.Query.DESCENDING).limit(50).stream()
    sessions = []
    for d in docs:
        sessions.append(ChatSession(**d.to_dict()))
    return sessions

@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, db: firestore.Client = Depends(get_db)):
    # Delete session and messages
    batch = db.batch()
    session_ref = db.collection("ai_chat_sessions").document(session_id)
    batch.delete(session_ref)
    
    messages = db.collection("ai_chat_sessions").document(session_id).collection("messages").stream()
    for m in messages:
        batch.delete(m.reference)
    
    batch.commit()
    return {"status": "deleted"}

@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessage])
async def get_messages(session_id: str, db: firestore.Client = Depends(get_db)):
    docs = db.collection("ai_chat_sessions").document(session_id).collection("messages").order_by("timestamp").stream()
    messages = []
    for d in docs:
        messages.append(ChatMessage(**d.to_dict()))
    return messages

@router.post("/sessions/{session_id}/messages")
async def send_message(session_id: str, req: ChatRequest, db: firestore.Client = Depends(get_db)):
    print(f"DEBUG: send_message started for session {session_id}, model {req.model}")
    session_ref = db.collection("ai_chat_sessions").document(session_id)
    session_doc = session_ref.get()
    if not session_doc.exists:
        print(f"DEBUG: Session {session_id} not found")
        raise HTTPException(status_code=404, detail="Session not found")

    # 1. Save User Message
    user_msg_id = str(uuid.uuid4())
    user_msg = {
        "role": "user",
        "content": req.message,
        "timestamp": datetime.now()
    }
    session_ref.collection("messages").document(user_msg_id).set(user_msg)
    print(f"DEBUG: User message saved: {user_msg_id}")

    # 2. Prepare History for Gemini (Latest 20 messages)
    history_docs = session_ref.collection("messages").order_by("timestamp", direction=firestore.Query.DESCENDING).limit(20).get()
    
    # Needs to be chronologically ordered for Gemini
    history_list = list(reversed(list(history_docs)))
    
    contents = []
    for d in history_list:
        m = d.to_dict()
        contents.append(types.Content(
            role=m["role"],
            parts=[types.Part.from_text(text=m["content"])]
        ))
    print(f"DEBUG: Prepared {len(contents)} messages for Gemini. Last role: {contents[-1].role if contents else 'N/A'}")

    # 3. Call Gemini
    try:
        client = get_genai_client()
        if not client:
            raise HTTPException(status_code=500, detail="AI Client not initialized. Check environment variables.")

        # Prepare system instruction
        system_instruction = "あなたは有能で親切なAIアシスタントです。ユーザーの質問に対して正確かつ丁寧に回答してください。"
        
        # Prepare Tools
        tools = []
        if req.use_grounding:
            tools.append(types.Tool(google_search=types.GoogleSearch()))
            print("DEBUG: Google Search Grounding enabled")

        # Handle Image in the current message if provided
        if req.image and req.mimeType:
            import base64
            try:
                image_data = base64.b64decode(req.image)
                # Add image part to the LAST message (which should be the user's current query)
                if contents and contents[-1].role == "user":
                    contents[-1].parts.append(types.Part.from_bytes(data=image_data, mime_type=req.mimeType))
                    print(f"DEBUG: Image attached to current message ({req.mimeType})")
            except Exception as img_e:
                print(f"DEBUG: Failed to decode image: {img_e}")

        print(f"DEBUG: Calling Gemini {req.model} (Async)...")
        import time
        start_ai = time.time()
        response = await client.aio.models.generate_content(
            model=req.model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
                tools=tools if tools else None
            )
        )
        model_content = response.text or "(No response)"
        
        # Extract Grounding Metadata
        grounding_metadata_dict = None
        if response.candidates and response.candidates[0].grounding_metadata:
            gm = response.candidates[0].grounding_metadata
            
            # Manually convert likely fields to dict
            grounding_metadata_dict = {}
            
            # 1. Grounding Chunks (Web Sources)
            if hasattr(gm, 'grounding_chunks') and gm.grounding_chunks:
                chunks_list = []
                for chunk in gm.grounding_chunks:
                    c_dict = {}
                    if hasattr(chunk, 'web') and chunk.web:
                        c_dict["web"] = {
                            "uri": chunk.web.uri,
                            "title": chunk.web.title,
                            "domain": getattr(chunk.web, "domain", "") # domain might be optional
                        }
                    chunks_list.append(c_dict)
                grounding_metadata_dict["grounding_chunks"] = chunks_list

            # 2. Search Entry Point (Widget HTML)
            if hasattr(gm, 'search_entry_point') and gm.search_entry_point:
                sep = gm.search_entry_point
                grounding_metadata_dict["search_entry_point"] = {
                    "rendered_content": sep.rendered_content
                }
            
            # 3. Web Search Queries (Optional but good to have)
            if hasattr(gm, 'web_search_queries') and gm.web_search_queries:
                grounding_metadata_dict["web_search_queries"] = gm.web_search_queries

            print(f"DEBUG: Grounding Metadata extracted: {list(grounding_metadata_dict.keys())}")

        ai_duration = time.time() - start_ai
        print(f"DEBUG: Gemini response received in {ai_duration:.2f}s: {len(model_content)} chars")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Gemini AI Chat Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # 4. Save Model Response
    model_msg_id = str(uuid.uuid4())
    model_msg = {
        "role": "model",
        "content": model_content,
        "timestamp": datetime.now(),
        "grounding_metadata": grounding_metadata_dict
    }
    session_ref.collection("messages").document(model_msg_id).set(model_msg)
    print(f"DEBUG: Model message saved: {model_msg_id}")

    # 5. Update Session (last message, updated_at, maybe auto-title)
    update_data = {
        "updated_at": datetime.now(),
        "last_message": req.message[:100]
    }
    
    # Auto-title if "New Chat"
    if session_doc.to_dict().get("title") == "New Chat":
        update_data["title"] = req.message[:30] + ("..." if len(req.message) > 30 else "")
    
    session_ref.update(update_data)
    print(f"DEBUG: Session updated")

    return {"response": model_content, "grounding_metadata": grounding_metadata_dict}
