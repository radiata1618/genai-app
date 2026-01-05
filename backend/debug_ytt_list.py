import sys
import os
from youtube_transcript_api import YouTubeTranscriptApi

video_id = "vM8Rx9X0fmg"

try:
    ytt = YouTubeTranscriptApi()
    print(f"--- Calling ytt.list('{video_id}') ---")
    if hasattr(ytt, 'list'):
        result = ytt.list(video_id)
        print(f"Result type: {type(result)}")
        print(f"Result dir: {dir(result)}")
        
        # If it's iterable, list items
        try:
            items = list(result)
            print(f"Found {len(items)} tracks.")
            for i, item in enumerate(items):
                print(f"[{i}] Track: {item}")
                print(f"    - Type: {type(item)}")
                print(f"    - Dir: {dir(item)}")
                # Try to find language or id attributes
                for attr in ['language', 'language_code', 'id', 'is_generated']:
                    if hasattr(item, attr):
                        print(f"    - {attr}: {getattr(item, attr)}")
        except Exception as e:
            print(f"Could not iterate results: {e}")
    else:
        print("ytt has no 'list' method.")

except Exception as e:
    print(f"Error: {e}")
