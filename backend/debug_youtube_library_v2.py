import sys
import os

try:
    import youtube_transcript_api
    from youtube_transcript_api import YouTubeTranscriptApi
    print(f"Module file: {youtube_transcript_api.__file__}")
except ImportError as e:
    print(f"ImportError: {e}")
    sys.exit(1)

video_id = "vM8Rx9X0fmg"

print("\n--- Inspecting fetch method ---")
try:
    # Mimic english.py usage
    ytt = YouTubeTranscriptApi()
    print("Called YouTubeTranscriptApi()")
    
    transcript_list = ytt.fetch(video_id, languages=['en', 'ja'])
    print(f"Fetch returned type: {type(transcript_list)}")
    
    if isinstance(transcript_list, list) and len(transcript_list) > 0:
        first_item = transcript_list[0]
        print(f"First item type: {type(first_item)}")
        print(f"First item dir: {dir(first_item)}")
        
        if hasattr(first_item, 'text'):
            print(f"First item text (preview): {first_item.text[:100]}")
        
        # Check all items languages/content
        print(f"Total items: {len(transcript_list)}")
        
        full_text = " ".join([t.text for t in transcript_list])
        print(f"Full text preview (first 500 chars): {full_text[:500]}")
    else:
        print("Transcript list is empty or not a list")

except Exception as e:
    print(f"Error during fetch inspection: {e}")

