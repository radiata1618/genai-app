import sys
import os
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).parent
sys.path.append(str(backend_dir))

# Mock environment variables if they are missing, just to pass initial checks
os.environ["PROJECT_ID"] = "test-project"
os.environ["LOCATION_FOR_CAR_QUIZZ"] = "us-central1"
os.environ["GOOGLE_SEARCH_API_KEY"] = "test"
os.environ["GOOGLE_SEARCH_ENGINE_ID"] = "test"
os.environ["GCS_BUCKET_NAME_FOR_CAR_IMAGES"] = "test-bucket"

try:
    from main import app
    print("SUCCESS: Backend app imported successfully.")
except Exception as e:
    print(f"ERROR: Failed to import backend app: {e}")
    sys.exit(1)
