import os
import sys
try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:
    print("youtube_transcript_api not installed")
    sys.exit(1)

video_id = "vM8Rx9X0fmg"

print("--- YouTubeTranscriptApi Inspection ---")
print(dir(YouTubeTranscriptApi))

print("\n--- Attempting get_transcript ---")
try:
    # Try standard static method
    transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'ja'])
    print(f"Successfully fetched transcript (first 100 chars): {str(transcript)[:100]}")
except Exception as e:
    print(f"get_transcript failed: {e}")

print("\n--- Attempting instance creation (as in english.py) ---")
try:
    # Mimic english.py usage
    ytt = YouTubeTranscriptApi()
    print("Instance created successfully")
    if hasattr(ytt, 'fetch'):
        print("Instance has 'fetch' method")
    else:
        print("Instance does NOT have 'fetch' method")
except Exception as e:
    print(f"Instance creation failed: {e}")

print("\n--- Attempting list_transcripts ---")
try:
    transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
    print("list_transcripts successful")
    for t in transcript_list:
        print(f"Language: {t.language} ({t.language_code}) - Generated: {t.is_generated}")
except Exception as e:
    print(f"list_transcripts failed: {e}")
