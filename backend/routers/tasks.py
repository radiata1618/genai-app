from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from pydantic import BaseModel, Field
from datetime import date, datetime
import uuid
import enum
from google.cloud import firestore
from database import get_firestore_client

router = APIRouter(
    prefix="/tasks",
    tags=["tasks"],
)

# --- Enums & Pydantic Models ---

class RoutineType(str, enum.Enum):
    ACTION = "ACTION"
    MINDSET = "MINDSET"

class SourceType(str, enum.Enum):
    BACKLOG = "BACKLOG"
    ROUTINE = "ROUTINE"

class TaskStatus(str, enum.Enum):
    TODO = "TODO"
    DONE = "DONE"
    CARRY_OVER = "CARRY_OVER"

# Backlog
class BacklogItemCreate(BaseModel):
    title: str
    category: str = "General"
    estimated_effort: int = 1

class BacklogItemResponse(BacklogItemCreate):
    id: str
    created_at: datetime
    is_archived: bool

# Routine
class FrequencyType(str, enum.Enum):
    DAILY = "DAILY"
    WEEKLY = "WEEKLY"
    MONTHLY = "MONTHLY"

class FrequencyConfig(BaseModel):
    type: FrequencyType = FrequencyType.DAILY
    weekdays: List[int] = [] # 0=Mon, 6=Sun
    month_days: List[int] = [] # 1-31

class RoutineCreate(BaseModel):
    title: str
    routine_type: RoutineType
    # Replaced cron with structural config
    frequency: Optional[FrequencyConfig] = None
    icon: Optional[str] = None

class RoutineResponse(RoutineCreate):
    id: str
    created_at: datetime



# Daily Task
class DailyTaskResponse(BaseModel):
    id: str
    source_id: str
    source_type: SourceType
    status: TaskStatus
    target_date: str # Firestore stores dates as timestamps/strings usually, keeping simple for JSON
    title: Optional[str] = None
    completed_at: Optional[datetime] = None


# --- Helper Functions ---

def get_db():
    return get_firestore_client()

# --- API Endpoints: Backlog ---
# ... (Backlog endpoints remain same) ...

# --- API Endpoints: Routines ---

@router.post("/routines", response_model=RoutineResponse)
def create_routine(routine: RoutineCreate, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("routines").document()
    data = routine.dict()
    # Pydantic to dict might need custom encoder for Enums if not automatic, 
    # but FastAPI/Pydantic usually handles it. Firestore needs strings for enums.
    # We explicitly convert enums to value for storage safety.
    data['routine_type'] = routine.routine_type.value
    if routine.frequency:
        data['frequency'] = routine.frequency.dict()
        data['frequency']['type'] = routine.frequency.type.value
    
    data.update({
        "id": doc_ref.id,
        "created_at": datetime.now()
    })
    doc_ref.set(data)
    return data

@router.get("/routines", response_model=List[RoutineResponse])
def get_routines(type: Optional[RoutineType] = None, db: firestore.Client = Depends(get_db)):
    query = db.collection("routines")
    if type:
        query = query.where("routine_type", "==", type.value)
        
    docs = query.stream()
    routines = []
    for doc in docs:
        d = doc.to_dict()
        # Handle legacy data or missing frequency
        if 'frequency' not in d or d['frequency'] is None:
             d['frequency'] = {"type": "DAILY", "weekdays": [], "month_days": []}
        routines.append(d)
    return routines

# --- API Endpoints: Daily Tasks ---

@router.post("/generate-daily")
def generate_daily_tasks(target_date: date = date.today(), db: firestore.Client = Depends(get_db)):
    target_date_str = target_date.isoformat()
    weekday = target_date.weekday() # 0=Mon, 6=Sun
    day_of_month = target_date.day
    
    # 1. Get all ACTION routines
    routines_stream = db.collection("routines").where("routine_type", "==", RoutineType.ACTION.value).stream()
    routines = [d.to_dict() for d in routines_stream]
    
    created_count = 0
    batch = db.batch()
    
    for r in routines:
        # Check Frequency
        freq = r.get('frequency', {})
        f_type = freq.get('type', 'DAILY')
        
        should_run = False
        if f_type == 'DAILY':
            should_run = True
        elif f_type == 'WEEKLY':
            if weekday in freq.get('weekdays', []):
                should_run = True
        elif f_type == 'MONTHLY':
            if day_of_month in freq.get('month_days', []):
                should_run = True
                
        if not should_run:
            continue

        # Use deterministic ID to prevent duplicates
        doc_id = f"{r['id']}_{target_date_str}"
        doc_ref = db.collection("daily_tasks").document(doc_id)
        
        snapshot = doc_ref.get()
        if not snapshot.exists:
            new_task = {
                "id": doc_id,
                "source_id": r['id'],
                "source_type": SourceType.ROUTINE.value,
                "target_date": target_date_str,
                "status": TaskStatus.TODO.value,
                "created_at": datetime.now()
            }
            batch.set(doc_ref, new_task)
            created_count += 1
            
    batch.commit()
    return {"message": f"Generated {created_count} tasks from routines", "date": target_date_str}

@router.get("/daily", response_model=List[DailyTaskResponse])
def get_daily_tasks(target_date: date = date.today(), db: firestore.Client = Depends(get_db)):
    target_date_str = target_date.isoformat()
    docs = db.collection("daily_tasks").where("target_date", "==", target_date_str).stream()
    
    tasks = []
    # Note: This N+1 query pattern is slow but acceptable for MVP
    # Optimization: perform batch get or keep titles in daily_tasks
    
    for doc in docs:
        t = doc.to_dict()
        title = "Unknown"
        
        # Fetch Source Title
        if t['source_type'] == SourceType.BACKLOG.value:
            src_doc = db.collection("backlog_items").document(t['source_id']).get()
            if src_doc.exists: title = src_doc.to_dict().get('title', 'Unknown')
        elif t['source_type'] == SourceType.ROUTINE.value:
            src_doc = db.collection("routines").document(t['source_id']).get()
            if src_doc.exists: title = src_doc.to_dict().get('title', 'Unknown')
            
        t['title'] = title
        tasks.append(t)
        
    return tasks

@router.post("/daily/pick")
def pick_from_backlog(backlog_id: str, target_date: date = date.today(), db: firestore.Client = Depends(get_db)):
    target_date_str = target_date.isoformat()
    
    # Verify backlog item
    item_ref = db.collection("backlog_items").document(backlog_id)
    if not item_ref.get().exists:
        raise HTTPException(status_code=404, detail="Backlog item not found")
        
    # Use deterministic ID
    doc_id = f"{backlog_id}_{target_date_str}"
    doc_ref = db.collection("daily_tasks").document(doc_id)
    
    if doc_ref.get().exists:
         return {"message": "Already picked"}

    new_task = {
        "id": doc_id,
        "source_id": backlog_id,
        "source_type": SourceType.BACKLOG.value,
        "target_date": target_date_str,
        "status": TaskStatus.TODO.value,
        "created_at": datetime.now()
    }
    doc_ref.set(new_task)
    return new_task

@router.patch("/daily/{task_id}/complete")
def complete_daily_task(task_id: str, completed: bool = True, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("daily_tasks").document(task_id)
    snapshot = doc_ref.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Task not found")
    
    updates = {
        "status": TaskStatus.DONE.value if completed else TaskStatus.TODO.value,
        "completed_at": datetime.now() if completed else None
    }
    doc_ref.update(updates)
    return {**snapshot.to_dict(), **updates}
