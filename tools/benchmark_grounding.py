
import os
import time
import statistics
from dotenv import load_dotenv
from pathlib import Path
from google import genai
from google.genai import types

# Load environment variables
env_path = Path(__file__).parent.parent / '.env.local'
print(f"Loading env from: {env_path}")
load_dotenv(dotenv_path=env_path)

api_key = os.getenv("GOOGLE_CLOUD_API_KEY")
if not api_key:
    # Try getting it from key.json if env var is missing (fallback logic similar to some other scripts, or just fail)
    # The backend uses GOOGLE_CLOUD_API_KEY, so we expect it there.
    print("Error: GOOGLE_CLOUD_API_KEY not found in environment.")
    exit(1)

client = genai.Client(
    vertexai=True,
    api_key=api_key,
    http_options={'api_version': 'v1beta1'}
)

MODEL_NAME = "gemini-3-flash-preview"
PROMPT = "What is the capital of France?" # Simple query
# PROMPT = "What are the latest news about Gemini AI?" # Query that might benefit from search

def run_benchmark(use_search: bool, iterations: int = 3):
    latencies = []
    print(f"\n--- Benchmarking: Search {'ON' if use_search else 'OFF'} ---")
    
    tools = []
    if use_search:
        tools = [types.Tool(google_search=types.GoogleSearch())]
        
    config = types.GenerateContentConfig(
        tools=tools,
        temperature=0.7,
        max_output_tokens=2048,
    )

    for i in range(iterations):
        start_time = time.time()
        try:
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=PROMPT,
                config=config,
            )
            # Access text to ensure it's generated
            _ = response.text
            end_time = time.time()
            duration = end_time - start_time
            latencies.append(duration)
            print(f"Iteration {i+1}: {duration:.4f}s")
        except Exception as e:
            print(f"Iteration {i+1}: Failed - {e}")

    if latencies:
        avg_latency = statistics.mean(latencies)
        print(f"Average Latency: {avg_latency:.4f}s")
        return avg_latency
    return 0

if __name__ == "__main__":
    print(f"Model: {MODEL_NAME}")
    print(f"Prompt: {PROMPT}")
    
    # Warmup (optional, or just run)
    
    avg_no_search = run_benchmark(use_search=False, iterations=3)
    avg_search = run_benchmark(use_search=True, iterations=3)
    
    if avg_no_search > 0:
        diff = avg_search - avg_no_search
        ratio = avg_search / avg_no_search if avg_no_search > 0 else 0
        print(f"\nSummary:")
        print(f"Without Search: {avg_no_search:.4f}s")
        print(f"With Search:    {avg_search:.4f}s")
        print(f"Impact: Search adds ~{diff:.4f}s ({ratio:.1f}x slower)")
