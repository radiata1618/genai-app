from youtube_transcript_api import YouTubeTranscriptApi
import sys

# Video ID from the screenshot: Xg2TBWaXsqg
video_id = "Xg2TBWaXsqg"

print(f"Attempting to fetch transcript for video: {video_id}")

try:
    # Using the syntax found in english.py and confirmed by check_youtube.py
    ytt = YouTubeTranscriptApi()
    transcript_list = ytt.fetch(video_id, languages=['en', 'ja'])
    
    print("SUCCESS: Transcript fetched successfully.")
    print(f"First few lines: {transcript_list[0] if transcript_list else 'Empty'}")
except Exception as e:
    print(f"ERROR: Failed to fetch transcript.")
    print(e)
