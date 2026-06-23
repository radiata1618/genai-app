import asyncio
import os
import sys

# パス追加
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.dab_ingestion import run_ingestion_pipeline

async def main():
    # 環境変数の読み込み
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')
    if os.path.exists(env_path):
        print(f"Loading env from {env_path}")
        load_dotenv(env_path)
    else:
        print(".env.local not found")
        
    print("=== DAB Ingestion Verification Start ===")
    try:
        await run_ingestion_pipeline()
        print("=== DAB Ingestion Verification Success ===")
    except Exception as e:
        print(f"=== DAB Ingestion Verification Error: {e} ===")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
