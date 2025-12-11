from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
import vertexai
from dotenv import load_dotenv
from pathlib import Path
from routers import generate
from routers import generate_genai 
from routers import rag
from routers import management
from routers import tasks
from routers import car_quiz
from routers import projects

env_path = Path(__file__).parent.parent / '.env.local'
load_dotenv(dotenv_path=env_path)

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all for public access, auth handled by App
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Security Middleware ---
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip check for health check or OPTIONS requests
        if request.url.path == "/health" or request.method == "OPTIONS":
            return await call_next(request)

        # Retrieve API Key from header
        api_key = request.headers.get("X-INTERNAL-API-KEY")
        # Verify API Key (Trim whitespace to prevent Secret Manager newline issues)
        expected_key = os.getenv("INTERNAL_API_KEY", "").strip()
        request_key = request.headers.get("X-INTERNAL-API-KEY", "").strip()
        
        if not expected_key or request_key != expected_key:
            print(f"Auth Failed: Header={request_key}, Expected={expected_key[:4]}***") # Log masked key for debug
            return JSONResponse(status_code=403, content={"detail": "Forbidden: Invalid API Key"})
        
        response = await call_next(request)
        return response

from fastapi.responses import JSONResponse
from middleware import PerformanceMiddleware

app.add_middleware(PerformanceMiddleware)
app.add_middleware(APIKeyMiddleware)
# ---------------------------

# Initialize Vertex AI
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION_FOR_CAR_QUIZZ")

# Check if environment variables are set
if not PROJECT_ID or not LOCATION:
    print("Warning: PROJECT_ID or LOCATION environment variables are not set.")

try:
    vertexai.init(project=PROJECT_ID, location=LOCATION)
except Exception as e:
    print(f"Error initializing Vertex AI: {e}")

# Include routers
app.include_router(generate.router, prefix="/api", tags=["generate"])
app.include_router(generate_genai.router, prefix="/api", tags=["generate_genai"])
app.include_router(rag.router, prefix="/api", tags=["rag"])
app.include_router(management.router, prefix="/api", tags=["management"])
app.include_router(tasks.router, prefix="/api", tags=["tasks"])
app.include_router(car_quiz.router, prefix="/api", tags=["car_quiz"])
app.include_router(projects.router, prefix="/api", tags=["projects"])

@app.get("/health")
async def health_check():
    return {"status": "ok"}
