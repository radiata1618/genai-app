# backend/routers/generate_genai.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from google import genai
from google.genai import types
import base64
import os

# ---- FastAPI router ----
router = APIRouter(
    tags=["google-genai"],
)

# ---- Pydantic model (既存と同じでOK) ----
class GenerateRequest(BaseModel):
    query: Optional[str] = None
    image: Optional[str] = None      # base64 文字列想定
    mimeType: Optional[str] = None   # "image/png" など


# ---- google-genai クライアント ----
# Explicitly initialize with Vertex AI settings
# Ensure PROJECT_ID is set in Cloud Run environment variables
api_key = os.getenv("GOOGLE_CLOUD_API_KEY")
if api_key:
    api_key = api_key.strip()

client = genai.Client(
    vertexai=True,
    api_key=api_key,
    http_options={'api_version': 'v1beta1'}
)


def build_contents(req: GenerateRequest) -> List[types.Part | str]:
    """テキスト + 画像から google-genai 用 contents を組み立てるヘルパー"""
    parts: List[types.Part | str] = []

    if req.query:
        # 単なる str でも OK。SDK 側で text パートに変換してくれる。:contentReference[oaicite:3]{index=3}
        parts.append(req.query)

    if req.image and req.mimeType:
        try:
            image_bytes = base64.b64decode(req.image)
        except Exception:
            # 画像が base64 で来ていない場合は無視してテキストだけで生成
            return parts

        parts.append(
            types.Part.from_bytes(
                data=image_bytes,
                mime_type=req.mimeType,
            )
        )

    return parts


@router.post("/generate_genai")
async def generate_with_google_genai(request: GenerateRequest):
    """
    google-genai + Gemini 2.x で生成する新エンドポイント
    - Google Search grounding を有効化（google_search フィールド）
    """
    try:
        contents = build_contents(request)
        if not contents:
            return {"answer": "(no content to generate)"}

        # Google Search grounding 用のツール設定
        # docs: types.Tool(google_search=types.GoogleSearch()) :contentReference[oaicite:4]{index=4}
        search_tool = types.Tool(
            google_search=types.GoogleSearch()
        )

        config = types.GenerateContentConfig(
            tools=[search_tool],
            # 必要に応じてパラメータをここに
            temperature=0.7,
            max_output_tokens=2048,
            # safety_settings=[
            #     types.SafetySetting(
            #         category=types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            #         threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH
            #     ),
            #     types.SafetySetting(
            #         category=types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            #         threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH
            #     ),
            #     types.SafetySetting(
            #         category=types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            #         threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH
            #     ),
            #     types.SafetySetting(
            #         category=types.HarmCategory.HARM_CATEGORY_HARASSMENT,
            #         threshold=types.HarmBlockThreshold.BLOCK_ONLY_HIGH
            #     ),
            # ]
        )

        # モデル名はお好みで変更可能（2.0 / 2.5 など）
        # 例: "gemini-2.5-flash" / "gemini-2.5-pro" :contentReference[oaicite:5]{index=5}
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=contents,
            config=config,
        )

        if response.text:
            text = response.text
        else:
            # Check if there's a reason for blocking
            reason = "Unknown"
            if response.candidates and response.candidates[0].finish_reason:
                reason = str(response.candidates[0].finish_reason)
            text = f"(no text response, finish_reason: {reason})"

        return {"answer": text}

    except Exception as e:
        print(f"[google-genai] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
