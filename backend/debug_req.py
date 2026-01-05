import requests
import re

video_id = "vM8Rx9X0fmg"
url = f"https://www.youtube.com/watch?v={video_id}"

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,ja;q=0.8"
}

try:
    print(f"Fetching URL: {url}")
    res = requests.get(url, headers=headers)
    print(f"Status Code: {res.status_code}")
    
    # Simple regex to find title
    title_match = re.search(r'<title>(.*?)</title>', res.text)
    if title_match:
        print(f"Page Title: {title_match.group(1)}")
    else:
        print("Title not found in HTML")

    # Check for player response
    if "ytInitialPlayerResponse" in res.text:
        print("Found 'ytInitialPlayerResponse' in HTML (Good!)")
    else:
        print("Did NOT find 'ytInitialPlayerResponse' (Bad - maybe hydration?)")

except Exception as e:
    print(f"Request failed: {e}")
