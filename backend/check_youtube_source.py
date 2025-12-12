import inspect
from youtube_transcript_api import YouTubeTranscriptApi

try:
    print(inspect.getsource(YouTubeTranscriptApi))
except Exception as e:
    print(f"Error: {e}")
