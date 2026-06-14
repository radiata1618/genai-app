import requests
import os
from pathlib import Path
from dotenv import load_dotenv

# Env読み込み
env_path = Path(__file__).parent.parent / '.env.local'
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("INTERNAL_API_KEY", "").strip()
headers = {
    "X-INTERNAL-API-KEY": api_key
}

url_settings = "http://localhost:8000/api/consulting/training/sidebar/settings"
url_analyze = "http://localhost:8000/api/consulting/training/live-gemini/analyze"

print(f"Testing local FastAPI endpoints with X-INTERNAL-API-KEY: {api_key[:4]}***")

try:
    print(f"GET {url_settings} ...")
    res1 = requests.get(url_settings, headers=headers)
    print(f"Status: {res1.status_code}, Response: {res1.text}")
except Exception as e:
    print(f"Failed setting request: {e}")

try:
    print(f"POST {url_analyze} with dummy file...")
    files = {'file': ('test.webm', b'dummy_audio_content', 'audio/webm')}
    res2 = requests.post(url_analyze, headers=headers, files=files)
    print(f"Status: {res2.status_code}, Response: {res2.text}")
except Exception as e:
    print(f"Failed analyze request: {e}")
