import sys
from youtube_transcript_api import YouTubeTranscriptApi

video_id = "vM8Rx9X0fmg"

try:
    print(f"--- Fetching transcript for {video_id} ---")
    ytt = YouTubeTranscriptApi()
    transcript_object = ytt.fetch(video_id, languages=['en', 'ja'])
    
    print(f"Returned object type: {type(transcript_object)}")
    print(f"Is iterable? {hasattr(transcript_object, '__iter__')}")
    
    items = list(transcript_object)
    print(f"Number of items: {len(items)}")
    
    if len(items) > 0:
        first = items[0]
        print(f"First item type: {type(first)}")
        print(f"First item dir: {dir(first)}")
        if hasattr(first, 'text'):
            print(f"First item text: {repr(first.text)}")
        if hasattr(first, 'start'):
            print(f"First item start: {first.start}")
        if hasattr(first, 'duration'):
            print(f"First item duration: {first.duration}")

    # Inspect a few lines to see if they are "correct"
    print("\n--- First 5 lines ---")
    for i, item in enumerate(items[:5]):
        print(f"[{i}] {repr(item.text)}")

    print("\n--- Last 5 lines ---")
    for i, item in enumerate(items[-5:]):
        print(f"[{i}] {repr(item.text)}")

except Exception as e:
    print(f"Error: {e}")
