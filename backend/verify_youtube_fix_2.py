from youtube_transcript_api import YouTubeTranscriptApi

try:
    video_id = "FWHLJJBCM1I" 
    ytt = YouTubeTranscriptApi()
    fetched = ytt.fetch(video_id, languages=['en', 'ja'])
    
    print(f"Is iterable? {hasattr(fetched, '__iter__')}")
    
    # Try iterating
    count = 0
    for item in fetched:
        print(f"Item type: {type(item)}")
        print(f"Item dir: {dir(item)}")
        # Check if it has .text
        if hasattr(item, 'text'):
            print(f"Text: {item.text}")
        else:
            print("No text attr")
            
        # Check if it supports subscript
        try:
            print(f"Dict access: {item['text']}")
        except Exception as e:
            print(f"Dict access failed: {e}")
            
        count += 1
        if count > 0: break
    
except Exception as e:
    print(f"Failed: {e}")
