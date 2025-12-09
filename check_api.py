import subprocess
import json
import urllib.request
import urllib.error
import sys

# Force utf-8 for stdout if possible, but simpler to just avoid fancy chars
# sys.stdout.reconfigure(encoding='utf-8')

def get_gcloud_output(cmd_list):
    try:
        return subprocess.check_output(cmd_list, shell=True).decode('utf-8').strip()
    except Exception as e:
        print(f"Error running {' '.join(cmd_list)}: {e}")
        return None

def check_model(project, token, model_name):
    url = f"https://us-central1-aiplatform.googleapis.com/v1/projects/{project}/locations/us-central1/publishers/google/models/{model_name}:generateContent"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    data = {
        "contents": [{"role": "user", "parts": [{"text": "Hello"}]}]
    }
    
    print(f"Testing {model_name}...", end=" ")
    try:
        req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), headers=headers)
        with urllib.request.urlopen(req) as response:
            print(f"SUCCESS ({response.status})")
            return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"404 Not Found")
        else:
            print(f"Error {e.code}: {e.read().decode('utf-8')[:100]}")
        return False
    except Exception as e:
        print(f"Exception: {e}")
        return False

def main():
    print("Getting token...")
    token = get_gcloud_output(["gcloud", "auth", "print-access-token"])
    print("Getting project...")
    project = get_gcloud_output(["gcloud", "config", "get-value", "project"])
    
    if not token or not project:
        print("Failed to get token or project.")
        return

    models_to_test = [
        "gemini-1.5-pro",
        "gemini-1.5-flash-001",
        "gemini-3-pro-preview",
        "gemini-3.0-pro-preview",
        "gemini-experimental"
    ]
    
    print(f"Project: {project}")
    print("-" * 20)
    
    for m in models_to_test:
        check_model(project, token, m)

if __name__ == "__main__":
    main()
