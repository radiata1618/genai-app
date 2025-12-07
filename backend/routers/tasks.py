from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from pydantic import BaseModel
from datetime import date, datetime
import enum
from google.cloud import firestore
from database import get_db

router = APIRouter(
    prefix="/tasks",
    tags=["tasks"],
)

# --- Enums & Models ---

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

# Routine & Frequency
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
    target_date: str 
    title: Optional[str] = None
    completed_at: Optional[datetime] = None

# --- API Endpoints ---

@router.post("/backlog", response_model=BacklogItemResponse)
def create_backlog_item(item: BacklogItemCreate, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("backlog_items").document()
    data = item.dict()
    data.update({
        "id": doc_ref.id,
        "created_at": datetime.now(),
        "is_archived": False
    })
    doc_ref.set(data)
    return data

@router.get("/backlog", response_model=List[BacklogItemResponse])
def get_backlog_items(limit: int = 100, db: firestore.Client = Depends(get_db)):
    docs = db.collection("backlog_items").where("is_archived", "==", False).limit(limit).stream()
    items = []
    for doc in docs:
        items.append(doc.to_dict())
    return items

@router.patch("/backlog/{item_id}/archive")
def archive_backlog_item(item_id: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("backlog_items").document(item_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Item not found")
    doc_ref.update({"is_archived": True})
    return {"status": "archived"}

@router.post("/routines", response_model=RoutineResponse)
def create_routine(routine: RoutineCreate, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("routines").document()
    data = routine.dict()
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
        if 'frequency' not in d or d['frequency'] is None:
             d['frequency'] = {"type": "DAILY", "weekdays": [], "month_days": []}
        routines.append(d)
    return routines

@router.post("/generate-daily")
def generate_daily_tasks(target_date: date = date.today(), db: firestore.Client = Depends(get_db)):
    target_date_str = target_date.isoformat()
    weekday = target_date.weekday()
    day_of_month = target_date.day
    
    routines_stream = db.collection("routines").where("routine_type", "==", RoutineType.ACTION.value).stream()
    routines = [d.to_dict() for d in routines_stream]
    
    created_count = 0
    batch = db.batch()
    
    for r in routines:
        freq = r.get('frequency', {})
        f_type = freq.get('type', 'DAILY')
        
        should_run = False
        if f_type == 'DAILY': should_run = True
        elif f_type == 'WEEKLY':
            if weekday in freq.get('weekdays', []): should_run = True
        elif f_type == 'MONTHLY':
            if day_of_month in freq.get('month_days', []): should_run = True
            
        if not should_run: continue

        doc_id = f"{r['id']}_{target_date_str}"
        doc_ref = db.collection("daily_tasks").document(doc_id)
        
        if not doc_ref.get().exists:
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
    return {"message": f"Generated {created_count} tasks", "date": target_date_str}

@router.get("/daily", response_model=List[DailyTaskResponse])
def get_daily_tasks(target_date: date = date.today(), db: firestore.Client = Depends(get_db)):
    target_date_str = target_date.isoformat()
    docs = db.collection("daily_tasks").where("target_date", "==", target_date_str).stream()
    
    tasks = []
    for doc in docs:
        t = doc.to_dict()
        title = "Unknown"
        if t['source_type'] == SourceType.BACKLOG.value:
            src = db.collection("backlog_items").document(t['source_id']).get()
            if src.exists: title = src.to_dict().get('title', 'Unknown')
        elif t['source_type'] == SourceType.ROUTINE.value:
            src = db.collection("routines").document(t['source_id']).get()
            if src.exists: title = src.to_dict().get('title', 'Unknown')
        t['title'] = title
        tasks.append(t)
    return tasks

@router.post("/daily/pick")
def pick_from_backlog(backlog_id: str, target_date: date = date.today(), db: firestore.Client = Depends(get_db)):
    target_date_str = target_date.isoformat()
    item_ref = db.collection("backlog_items").document(backlog_id)
    if not item_ref.get().exists:
        raise HTTPException(status_code=404, detail="Backlog item not found")
        
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
    snap = doc_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Task not found")
    
    updates = {
        "status": TaskStatus.DONE.value if completed else TaskStatus.TODO.value,
        "completed_at": datetime.now() if completed else None
    }
    doc_ref.update(updates)
    return {**snap.to_dict(), **updates}
