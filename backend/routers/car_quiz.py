from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional
import os

from google import genai
from google.genai import types

from googleapiclient.discovery import build
from database import get_firestore_client, get_storage_client
import uuid
import json
import asyncio

router = APIRouter()

# Data Models
class Car(BaseModel):
    id: Optional[str] = None
    manufacturer: str
    name: str
    model_code: str
    body_type: str
    image_urls: List[str] = []
    is_published: bool = False

class GenerationRequest(BaseModel):
    prompt: str

class ImageCollectionRequest(BaseModel):
    cars: List[Car]

# Utilities
def get_custom_search_service():
    developer_key = os.getenv("GOOGLE_SEARCH_API_KEY")
    cx = os.getenv("GOOGLE_SEARCH_ENGINE_ID")
    if not developer_key or not cx:
        raise HTTPException(status_code=500, detail="Custom Search API credentials not configured.")
    return build("customsearch", "v1", developerKey=developer_key), cx

# Endpoints

@router.post("/car-quiz/generate-list")
async def generate_car_list(request: GenerationRequest):
    """Generates a list of cars using Google GenAI SDK (Gemini 1.5 Pro) based on the prompt."""
    try:
        project_id = os.getenv("PROJECT_ID")
        location = os.getenv("LOCATION_FOR_CAR_QUIZZ") or os.getenv("LOCATION") or "us-central1"
        
        if not project_id:
            print("Warning: PROJECT_ID not found in env, using default or implicit.")

        client = genai.Client(vertexai=True, project=project_id, location=location) 

        full_prompt = f"""
        Rank the following request and generate a list of cars in JSON format.
        Request: {request.prompt}
        
        Refrence Firestore for existing cars to avoid duplicates if possible (Note: I cannot directly access Firestore here, so just generate based on knowledge).
        
        IMPORTANT: If the request is very broad (e.g. "all cars", "market list"), select 20-30 representative popular models from major manufacturers to avoid overwhelming the response. Do not try to list everything.
        
        Output Schema:
        [
            {{
                "manufacturer": "Toyota",
                "name": "Harrier",
                "model_code": "80系",
                "body_type": "SUV"
            }}
        ]
        
        Only return the JSON array.
        """
        
        try:
            response = client.models.generate_content(
                model="gemini-3-pro-preview",
                contents=full_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    max_output_tokens=8192,
                    temperature=0.5,
                    top_p=0.95,
                ),
            )
        except Exception:
            # Fallback to 2.0 Flash silently if 3.0 fails (1.5 Pro also failed, but 2.0 passed in RAG)
            # print(f"Gemini 3.0 failed: {e}") # Removed to avoid UnicodeEncodeError
            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=full_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    max_output_tokens=8192,
                    temperature=0.5,
                    top_p=0.95,
                ),
            )
        
        # Parse JSON from response
        try:
            text = response.text
            # Basic cleanup if markdown backticks are present
            if "```json" in text:
                text = text.split("```json")[1].split("```")[0]
            elif "```" in text:
                text = text.split("```")[1].split("```")[0]
            
            car_list = json.loads(text)
            return car_list
        except Exception as parse_error:
            # print(f"Failed to parse JSON: {parse_error}")
            raise HTTPException(status_code=500, detail="Failed to parse AI response.")

    except Exception as e:
        # print(f"GenAI Error: {e}")
        # Return a safe error message
        raise HTTPException(status_code=500, detail=f"AI Generation Failed: {str(e)[:100]}")

@router.post("/car-quiz/collect-images")
async def collect_images(request: ImageCollectionRequest):
    """Collects images for the given list of cars using Google Custom Search."""
    service, cx = get_custom_search_service()
    updated_cars = []

    # Note: Sequential processing for now to avoid hitting rate limits too hard
    # In production, might want a task queue or controlled concurrency
    for car in request.cars:
        query = f"{car.manufacturer} {car.name} {car.model_code} 外観"
        try:
            res = service.cse().list(
                q=query,
                cx=cx,
                searchType="image",
                fileType="jpg",
                num=3, # Get top 3 images
                safe="off"
            ).execute()

            found_images = []
            if "items" in res:
                for item in res["items"]:
                    found_images.append(item["link"])
            
            # Update car with found images (temporary URLs for review)
            car.image_urls = found_images
            updated_cars.append(car)
            
        except Exception as e:
            print(f"Search failed for {car.name}: {e}")
            updated_cars.append(car) # Return without images if failed

    return updated_cars

@router.get("/car-quiz/fetch-list")
async def fetch_car_list():
    """Fetches all cars from Firestore for the admin list."""
    try:
        db = get_firestore_client()
        docs = db.collection("cars").order_by("created_at", direction=firestore.Query.DESCENDING).stream()
        cars = [doc.to_dict() for doc in docs]
        return cars
    except Exception as e:
        print(f"Error fetching list: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/car-quiz/save-car")
async def save_car(car: Car):
    """Approves a car, saves images to GCS, and data to Firestore."""
    db = get_firestore_client()
    storage_client = get_storage_client()
    bucket_name = os.getenv("GCS_BUCKET_NAME_FOR_CAR_IMAGES") # Should be defined in env
    
    if not bucket_name:
         # Fallback or error
         raise HTTPException(status_code=500, detail="GCS_BUCKET_NAME_FOR_CAR_IMAGES not set.")
    
    bucket = storage_client.bucket(bucket_name)

    # 1. Generate ID if not present
    if not car.id:
        car.id = str(uuid.uuid4())

    # 2. Process Images (Download and Upload to GCS)
    # This part requires downloading content from the external URL and uploading to GCS.
    # Since we only have URLs, we need to fetch them.
    # Importing httpx or requests inside the function or file
    import httpx
    
    permanent_urls = []
    
    async with httpx.AsyncClient() as client:
        for i, img_url in enumerate(car.image_urls):
            try:
                # We expect the frontend to pass the list of 'approved' URLs here
                # If these are already GCS URLs, skip. If external, download/upload.
                if "storage.googleapis.com" in img_url:
                    permanent_urls.append(img_url)
                    continue

                resp = await client.get(img_url)
                if resp.status_code == 200:
                    blob_path = f"cars/{car.id}/{i}.jpg"
                    blob = bucket.blob(blob_path)
                    blob.upload_from_string(resp.content, content_type="image/jpeg", timeout=600)
                    # Make public or use signed URLs? Requirement says GCS.
                    # Assuming public read or checking permissions. 
                    # For simplicity, we store the gs:// or public https:// link.
                    # Let's use the public link if the bucket is public, or authenticated link.
                    # Using public-read for this app context might be easiest, or just keeping the GS path and signing it on read.
                    # Let's store GS path or standard HTTP URL.
                    # blob.make_public() -> requires permission
                    permanent_urls.append(blob.public_url) # Or specific URL format
            except Exception as e:
                print(f"Failed to process image {img_url}: {e}")

    car.image_urls = permanent_urls
    car.is_published = True
    car.created_at = firestore.SERVER_TIMESTAMP

    # 3. Save to Firestore
    doc_ref = db.collection("cars").document(car.id)
    doc_ref.set(car.dict(exclude={'created_at'}), merge=True)
    # Add created_at separately or included in set if mapped correctly
    doc_ref.update({"created_at": firestore.SERVER_TIMESTAMP})

    return {"status": "success", "id": car.id}

@router.get("/car-quiz/questions")
async def get_quiz_questions(manufacturer: Optional[str] = None, body_type: Optional[str] = None, limit: int = 5):
    """Generates quiz questions."""
    db = get_firestore_client()
    cars_ref = db.collection("cars").where("is_published", "==", True)
    
    if manufacturer:
        cars_ref = cars_ref.where("manufacturer", "==", manufacturer)
    if body_type:
        cars_ref = cars_ref.where("body_type", "==", body_type)
        
    docs = cars_ref.stream()
    all_cars = [doc.to_dict() for doc in docs]
    
    if not all_cars:
        return []

    import random
    
    # Select cars for questions
    # If fewer cars than limit, return all
    selected_cars = random.sample(all_cars, min(len(all_cars), limit))
    
    questions = []
    for car in selected_cars:
        # Create distractors (wrong answers)
        # Try to find same manufacturer or body type
        distractors = [c for c in all_cars if c['name'] != car['name']]
        
        # Prioritize similar cars
        similar_distractors = [c for c in distractors if c['manufacturer'] == car['manufacturer'] or c['body_type'] == car['body_type']]
        if len(similar_distractors) >= 3:
             options_pool = similar_distractors
        else:
             options_pool = distractors
             
        if len(options_pool) < 3:
            # Not enough data for distractors
            current_options = [c['name'] for c in options_pool]
            # Fill with generic placeholders if absolutely necessary or just duplicate?
            # Ideally we have enough data. For now, just take what we have.
            pass
        
        wrong_options = random.sample(options_pool, min(len(options_pool), 3))
        options = [o['name'] for o in wrong_options]
        options.append(car['name'])
        random.shuffle(options)
        
        questions.append({
            "correct_answer": car['name'],
            "options": options,
            "image_url": car['image_urls'][0] if car['image_urls'] else None,
            "car_data": car # Optional: send full data for frontend context
        })
        
    return questions
