import requests
import os
import re

video_id = "vM8Rx9X0fmg"
url = f"https://www.youtube.com/watch?v={video_id}"

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9"
}

print(f"--- Debugging Network for {url} ---")

# 1. Check Proxy Env Vars
print("--- Environment Variables (Proxy related) ---")
for key, val in os.environ.items():
    if "PROXY" in key.upper():
        print(f"{key}: {val}")

# 2. Check Redirects and final URL
try:
    print(f"\n--- Requesting URL ---")
    res = requests.get(url, headers=headers, allow_redirects=True, timeout=10)
    print(f"Final Status Code: {res.status_code}")
    print(f"Final URL: {res.url}")
    
    if res.history:
        print("Redirect History:")
        for resp in res.history:
            print(f" - {resp.status_code} -> {resp.url}")
    else:
        print("No redirects.")

    # 3. Check Content again
    title_match = re.search(r'<title>(.*?)</title>', res.text)
    if title_match:
        print(f"Page Title: {title_match.group(1)}")
    else:
        print("Title not found in HTML")

    # 4. Dump first few lines of Response to see if it's a block page
    print(f"Response start: {res.text[:300]}")

except Exception as e:
    print(f"Request failed: {e}")
