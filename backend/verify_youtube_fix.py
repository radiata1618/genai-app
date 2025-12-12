from youtube_transcript_api import YouTubeTranscriptApi

try:
    video_id = "FWHLJJBCM1I" 
    ytt = YouTubeTranscriptApi()
    result = ytt.fetch(video_id, languages=['en', 'ja'])
    print(f"Type: {type(result)}")
    print(f"Dir: {dir(result)}")
    print(f"Repr: {result}")
except Exception as e:
    print(f"Failed: {e}")
