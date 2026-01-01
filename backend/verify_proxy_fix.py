import os
import sys

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.proxies import GenericProxyConfig
except ImportError:
    print("ERROR: youtube_transcript_api not installed or missing GenericProxyConfig.")
    sys.exit(1)

def verify_proxy():
    print("=== YouTube Transcript Proxy Verification ===")
    
    proxy_url = os.getenv("YOUTUBE_PROXY")
    
    if not proxy_url:
        print("[WARNING] Environment variable 'YOUTUBE_PROXY' is NOT set.")
        print("The script will attempt a DIRECT connection.")
        print("Note: On Cloud Run, this will likely fail with 403 Forbidden.")
        proxy_config = None
    else:
        # Handle raw format: host:port:user:pass
        if "://" not in proxy_url and proxy_url.count(":") >= 3:
            try:
                parts = proxy_url.split(":")
                if len(parts) >= 4:
                    p_host = parts[0]
                    p_port = parts[1]
                    p_user = parts[2]
                    p_pass = ":".join(parts[3:]) 
                    
                    import urllib.parse
                    p_user = urllib.parse.quote(p_user)
                    p_pass = urllib.parse.quote(p_pass)
                    
                    proxy_url = f"http://{p_user}:{p_pass}@{p_host}:{p_port}"
                    print(f"[INFO] Auto-formatted raw proxy string.")
            except Exception:
                print(f"[WARNING] Failed to parse raw proxy string, using as is.")

        print(f"[INFO] Proxy configured: {proxy_url}")
        proxy_config = GenericProxyConfig(http_url=proxy_url, https_url=proxy_url)

    # Test Video ID (Short, English)
    video_id = "Xg2TBWaXsqg"
    print(f"\nAttempting to fetch transcript for video: {video_id}...")

    try:
        ytt = YouTubeTranscriptApi(proxy_config=proxy_config)
        transcript_list = ytt.fetch(video_id, languages=['en', 'ja'])
        
        snippet = transcript_list[0].text if transcript_list else "No text"
        print("\n[SUCCESS] Transcript fetched successfully!")
        print(f"Sample: {snippet}")
        
    except Exception as e:
        print(f"\n[FAILED] Could not fetch transcript.")
        print(f"Error: {e}")
        
        if "403" in str(e) or "RequestBlocked" in str(e):
             print("\nAnalysis: The request was blocked by YouTube.")
             if not proxy_url:
                 print("-> Cause: You are likely running on a blocked IP (Cloud Run) without a proxy.")
                 print("-> Fix: Set YOUTUBE_PROXY environment variable.")
             else:
                 print("-> Cause: The configured proxy might be blocked or incorrectly configured.")

if __name__ == "__main__":
    verify_proxy()
