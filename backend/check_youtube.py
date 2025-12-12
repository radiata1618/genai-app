import youtube_transcript_api
print(f"Package: {youtube_transcript_api}")
from youtube_transcript_api import YouTubeTranscriptApi
print(f"Class: {YouTubeTranscriptApi}")
print(dir(YouTubeTranscriptApi))
try:
    print(YouTubeTranscriptApi.get_transcript)
except AttributeError:
    print("get_transcript not found")
