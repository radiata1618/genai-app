import os
import json
import asyncio
from dotenv import load_dotenv

# 環境変数のロード
load_dotenv(dotenv_path="../.env.local")

import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.ai_shared import get_genai_client
from config import GEMINI_FLASH_MODEL
from google.genai import types
from routers.consulting_training import MtgTrainingResultSchema

async def main():
    print("Initializing GenAI Client...")
    client = get_genai_client()
    
    prompt = """
以下の会話テキストを解析し、コンサルタントとしての会話能力を詳細かつ定量的に評価してください。
【会議のテキスト】
牛越: 本日はAIモデルの精度向上に関する前処理について説明します。ええと、特徴量エンジニアリングをちょっと重点的にやりたいですね。
クライアント: なるほど、具体的にどう進めるのですか？
牛越: はい、そうですね。まずはデータのクレンジングから行い、その後に特徴量の抽出を行います。

【指示】
1. 会話全体について、各指標4つのチェックリスト(checklist)についてTrue/Falseを判定してください。
2. total_words_estimate と filler_density を計算してください。
3. detected_fillers の一覧を作成してください。
4. full_transcript を作成してください。
"""

    print("Sending request to Gemini...")
    try:
        response = await client.aio.models.generate_content(
            model=GEMINI_FLASH_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=MtgTrainingResultSchema,
                temperature=0.1
            )
        )
        print("Response received:")
        print(response.text)
    except Exception as e:
        print("Error occurred:")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
