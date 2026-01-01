from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import os
from google import genai
from google.genai import types

router = APIRouter()


class GenerateRequest(BaseModel):
    query: Optional[str] = None
    image: Optional[str] = None
    mimeType: Optional[str] = None


@router.post("/generate")
async def generate_content(request: GenerateRequest):
    try:
        api_key = os.getenv("GOOGLE_CLOUD_API_KEY")
        if api_key:
            api_key = api_key.strip()

        client = genai.Client(
            vertexai=True,
            api_key=api_key,
            http_options={'api_version': 'v1beta1'}
        )

        model = "gemini-3.0-flash-exp"

        # Google Search Grounding Tool
        search_tool = types.Tool(
            google_search=types.GoogleSearch()
        )

        contents = []
        if request.query:
            contents.append(request.query)

        if request.image and request.mimeType:
             # Assuming naive pass-through or similar handling if needed. 
             # But the original code used Part.from_data. 
             # genai SDK prefers Part.from_bytes or similar if we have base64.
             # However, the input 'image' is likely base64 string from frontend.
             import base64
             try:
                image_bytes = base64.b64decode(request.image)
                contents.append(types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=request.mimeType
                ))
             except Exception:
                 pass # Ignore invalid image data for now or handle error

        if not contents:
            return {"answer": "(no content to generate)"}

        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(
                tools=[search_tool],
            ),
        )

        text = response.text or "(no text response)"
        return {"answer": text}

    except Exception as e:
        print(f"Error generating content: {e}")
        raise HTTPException(status_code=500, detail=str(e))