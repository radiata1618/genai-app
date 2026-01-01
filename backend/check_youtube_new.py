from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import ProxyConfig
import sys
import os

# Video ID matches the one in english.py test (Xg2TBWaXsqg)
video_id = "Xg2TBWaXsqg"

print(f"Attempting to fetch transcript for video: {video_id}")

# Simulate proxy env var if needed for testing (uncomment to test mocked proxy)
# os.environ["YOUTUBE_PROXY"] = "http://user:pass@host:port"

proxy_url = os.getenv("YOUTUBE_PROXY")
proxy_config = None

if proxy_url:
    print(f"DEBUG: Using YouTube Proxy: {proxy_url}")
    proxy_config = ProxyConfig({"http": proxy_url, "https": proxy_url})
else:
    print("DEBUG: No YouTube Proxy configured, connecting directly.")

try:
    # Instantiate API with proxy config if present
    ytt = YouTubeTranscriptApi(proxy_config=proxy_config)
    transcript_list = ytt.fetch(video_id, languages=['en', 'ja'])
    
    print("SUCCESS: Transcript fetched successfully.")
    # Check if the structure matches expectation (object with .text property)
    first_item = transcript_list[0]
    print(f"First item type: {type(first_item)}")
    print(f"First item text: {first_item.text}")
    
    full_text = " ".join([t.text for t in transcript_list])
    print(f"Full text length: {len(full_text)}")
    print(f"Snippet: {full_text[:50]}...")
    
except Exception as e:
    print(f"ERROR: Failed to fetch transcript.")
    print(e)
