from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

import vertexai
from vertexai.preview.generative_models import GenerativeModel, Part, Tool, grounding
# ↑ GoogleSearchRetrieval は grounding サブモジュールから使う

router = APIRouter()


class GenerateRequest(BaseModel):
    query: Optional[str] = None
    image: Optional[str] = None
    mimeType: Optional[str] = None


@router.post("/generate")
async def generate_content(request: GenerateRequest):
    try:
        # 必要ならどこかで init 済みか確認:
        # vertexai.init(project="YOUR_PROJECT_ID", location="us-central1")

        model = GenerativeModel("gemini-2.0-flash-001")

        # Google Search Grounding 用ツール設定
        search_tool = Tool.from_google_search_retrieval(
            google_search_retrieval=grounding.GoogleSearchRetrieval()
        )

        parts = []
        if request.query:
            parts.append(Part.from_text(request.query))

        if request.image and request.mimeType:
            parts.append(Part.from_data(data=request.image, mime_type=request.mimeType))

        if not parts:
            return {"answer": "(no content to generate)"}

        response = model.generate_content(
            parts,
            tools=[search_tool],
        )

        text = response.text or "(no text response)"
        return {"answer": text}

    except Exception as e:
        print(f"Error generating content: {e}")
        raise HTTPException(status_code=500, detail=str(e))