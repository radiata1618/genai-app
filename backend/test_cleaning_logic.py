import sys
from youtube_transcript_api import YouTubeTranscriptApi

def clean_roll_up_captions(transcript_items) -> str:
    if not transcript_items:
        return ""
    
    lines = []
    prev_text = ""
    
    for item in transcript_items:
        text = item.text.replace("\n", " ").strip()
        text = text.replace(">>>", "").strip()
        
        if not text:
            continue
            
        if not prev_text:
            lines.append(text)
            prev_text = text
            continue
            
        words = text.split()
        overlap_found = False
        for i in range(len(words), 0, -1):
            prefix = " ".join(words[:i])
            if prev_text.endswith(prefix):
                remaining = " ".join(words[i:])
                if remaining:
                    lines.append(remaining)
                overlap_found = True
                break
        
        if not overlap_found:
            lines.append(text)
            
        prev_text = text
        
    return " ".join(lines)

def test_cleaning():
    video_id = "vM8Rx9X0fmg"
    ytt = YouTubeTranscriptApi()
    track_list = ytt.list(video_id)
    
    manual_track = None
    for t in track_list:
        if not t.is_generated and t.language_code.startswith('en'):
            manual_track = t
            break
            
    if manual_track:
        items = manual_track.fetch()
        print(f"Raw first 200: {' '.join([i.text for i in items[:10]])}")
        cleaned = clean_roll_up_captions(items)
        print(f"\nCleaned first 200: {cleaned[:200]}")
        
if __name__ == "__main__":
    test_cleaning()
