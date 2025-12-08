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

env_path = Path(__file__).parent.parent / '.env.local'
load_dotenv(dotenv_path=env_path)

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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

@app.get("/health")
async def health_check():
    return {"status": "ok"}
