import sys
import os
from youtube_transcript_api import YouTubeTranscriptApi

video_id = "vM8Rx9X0fmg"

def list_tracks(vid):
    try:
        print(f"--- Listing all transcript tracks for {vid} ---")
        # Note: YouTubeTranscriptApi.list_transcripts(vid) is the standard way
        # But we saw earlier that this environment's library is weird.
        # Let's try the standard method first, then fallback to inspecting the ytt object.
        
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(vid)
            for t in transcript_list:
                print(f"Language: {t.language} ({t.language_code})")
                print(f"  - Generated: {t.is_generated}")
                print(f"  - Is translatable: {t.is_translatable}")
                print(f"  - Translation languages: {len(t.translation_languages) if t.is_translatable else 0}")
        except Exception as e:
            print(f"Standard list_transcripts failed: {e}")
            
        print("\n--- Fallback: Inspecting custom ytt object ---")
        ytt = YouTubeTranscriptApi()
        # In english.py, it uses ytt.fetch(video_id, languages=['en', 'ja'])
        # Let's see what happens if we fetch without language filter or check internal state
        print(f"ytt methods: {dir(ytt)}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_tracks(video_id)
