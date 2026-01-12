import os
import sys

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')

# Load .env.local manually from project root
# Script is in backend/, root is one level up
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(root_dir, '.env.local')

if os.path.exists(env_path):
    print(f"Loading env from {env_path}")
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' in line:
                k, v = line.split('=', 1)
                # Don't overwrite if already set (though typically not set in this shell)
                if k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip().strip('"').strip("'")

# Also set GOOGLE_APPLICATION_CREDENTIALS to key.json if exists
key_path = os.path.join(root_dir, 'key.json')
if os.path.exists(key_path):
    print(f"Setting GOOGLE_APPLICATION_CREDENTIALS to {key_path}")
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = key_path

from services.ai_shared import get_genai_client
from google.genai import types

def main():
    client = get_genai_client()
    if not client:
        print("Failed to init client - extract check env vars")
        # Print debug info
        print(f"PROJECT_ID: {os.getenv('PROJECT_ID')}")
        print(f"LOCATION: {os.getenv('LOCATION')}")
        return

    model_name = "gemini-2.0-flash-exp" 
    print(f"Sending request to {model_name} with Google Search Grounding...")
    
    tools = [types.Tool(google_search=types.GoogleSearch())]
    
    try:
        response = client.models.generate_content(
            model=model_name,
            contents="What is the latest Google Pixel phone price in Japan?",
            config=types.GenerateContentConfig(
                tools=tools
            )
        )
        
        print("\n--- Response Text ---")
        print(response.text)
        
        print("\n--- Grounding Metadata ---")
        if response.candidates:
            cand = response.candidates[0]
            if hasattr(cand, 'grounding_metadata') and cand.grounding_metadata:
                gm = cand.grounding_metadata
                print(f"Type: {type(gm)}")
                print(gm)
                
                # Check for specific attributes typical in Vertex AI / GenAI SDK
                if hasattr(gm, 'grounding_chunks'):
                    print("\nGrounding Chunks found!")
                    for chunk in gm.grounding_chunks:
                        print(chunk)
                
                if hasattr(gm, 'search_entry_point'):
                    print("\nSearch Entry Point found!")
                    print(gm.search_entry_point)
                    
            else:
                print("No grounding_metadata found on candidate.")
        else:
            print("No candidates found.")
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
