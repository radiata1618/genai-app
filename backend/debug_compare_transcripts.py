import sys
import os
from youtube_transcript_api import YouTubeTranscriptApi

video_id = "vM8Rx9X0fmg"

def compare_transcripts(vid):
    try:
        ytt = YouTubeTranscriptApi()
        transcript_list = ytt.list(vid)
        
        manual_text = ""
        auto_text = ""
        
        for t in transcript_list:
            print(f"Fetching: {t.language} (Generated: {t.is_generated})")
            data = t.fetch()
            # The library returns FetchTranscriptSnippet objects with .text attribute
            text = " ".join([item.text for item in data])
            if t.is_generated:
                auto_text = text
            else:
                manual_text = text
        
        print(f"\nManual length: {len(manual_text)}")
        print(f"Auto length: {len(auto_text)}")
        
        # Word list for precise checking
        words_to_check = ["Venezuela", "Manhattan", "arrested", "leader", "prisons", "overnight", "raid"]
        print("\n--- Word Count Comparison ---")
        for word in words_to_check:
            m_count = manual_text.lower().count(word.lower())
            a_count = auto_text.lower().count(word.lower())
            print(f"'{word}': Manual={m_count}, Auto={a_count} {'(DIFF!)' if m_count != a_count else ''}")
            
        print("\n--- Manual Sample (first 300 chars) ---")
        print(manual_text[:300])
        print("\n--- Auto Sample (first 300 chars) ---")
        print(auto_text[:300])

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    compare_transcripts(video_id)
