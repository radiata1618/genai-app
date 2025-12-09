import os
import asyncio
import subprocess
from google import genai
from google.oauth2 import credentials

PROJECT_ID = "trial-project-ushikoshi"
LOCATION = "us-central1"

def get_access_token():
    try:
         return subprocess.check_output("gcloud auth print-access-token", shell=True).decode('utf-8').strip()
    except Exception as e:
        print(f"Error getting token: {e}")
        return None

async def list_models_sdk():
    token = get_access_token()
    if not token:
        print("No token")
        return

    creds = credentials.Credentials(token)
    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION, credentials=creds)
    
    print(f"Listing models for project {PROJECT_ID} in {LOCATION} via SDK...")
    
    count = 0
    try:
        # Note: The SDK might not have a direct 'list_models' on the client.models accessor in v0.4.0
        # checking documentation or standard patterns. 
        # Usually it's client.models.list() or similar. 
        # If not available, we have to rely on trial/error, but let's try standard list.
        # Based on google-genai repo, client.models.list() is not always straightforward in the unified client? 
        # Actually, for Vertex AI, using `aiplatform` library is the standard way to list.
        # But let's try to see if `google-genai` exposes it.
        # If not, I will use `google.cloud.aiplatform` to list, as that is the source of truth for Vertex.
        pass
    except Exception as e:
        print(f"Error initializing: {e}")

    # Fallback to aiplatform lib for *listing* because it's reliable for that.
    from google.cloud import aiplatform
    aiplatform.init(project=PROJECT_ID, location=LOCATION, credentials=creds)
    
    try:
        models = aiplatform.Model.list() # This lists *custom* models usually. 
        # We want *Publisher* models.
        # There isn't a simple "list publisher models" in the high level SDK consistently.
        # We will try the low-level ModelGardenService or just try generic "list" if possible.
        pass
    except Exception:
        pass

    # Actually, easiest way is to use the GAPIC client for Model Garden (PublisherModel)
    from google.cloud import aiplatform_v1
    
    api_endpoint = f"{LOCATION}-aiplatform.googleapis.com"
    client_options = {"api_endpoint": api_endpoint}
    
    # We need to manually construct the client with credentials
    
    # We will use the REST API via python requests as a fallback to be 100% sure what we receive, 
    # effectively doing what curl did but authentically.
    # But wait, curl returned 404 for the *list* endpoint too!
    # "The requested URL /v1/projects/.../publishers/google/models was not found"
    
    # Wait! The 404 in Step 56/73 on the LIST endpoint is suspicious.
    # URL used: https://us-central1-aiplatform.googleapis.com/v1/projects/$project/locations/us-central1/publishers/google/models
    # Is "us-central1" correct for the URL subdomain? Yes.
    # Is ".../publishers/google/models" correct? 
    # Documentation says: GET https://{LOCATION}-aiplatform.googleapis.com/v1/{parent}/publishers/{publisher}/models
    # where parent = projects/{project}/locations/{location}
    
    # If THAT returns 404, it means the API is disabled or the path is wrong.
    # The user says "Vertex AI API is enabled". 
    
    # Let's try to verify the active account.
    print(f"Active Account: {subprocess.check_output('gcloud config get-value account', shell=True).decode('utf-8').strip()}")
    
    # Let's try a diff region just in case? No, screenshots say us-central1.
    
    # Let's try to print the error of the list command from aiplatform logic.
    pass

if __name__ == "__main__":
    # asyncio.run(list_models_sdk())
    # SImple script to print strict context
    print(f"Active Account: {subprocess.check_output('gcloud config get-value account', shell=True).decode('utf-8').strip()}")
    print(f"Active Project: {subprocess.check_output('gcloud config get-value project', shell=True).decode('utf-8').strip()}")
    
    # Check if we can run a simple gcloud command to list models
    # `gcloud ai models list --region=us-central1` lists CUSTOM models.
    # `gcloud ml models list` is old.
    
    print("Run this to debug: gcloud curl https://us-central1-aiplatform.googleapis.com/v1/projects/trial-project-ushikoshi/locations/us-central1/publishers/google/models/gemini-1.5-pro")
