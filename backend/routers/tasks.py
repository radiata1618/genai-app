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
    SKIPPED = "SKIPPED"
    CARRY_OVER = "CARRY_OVER"

# Backlog
class BacklogItemCreate(BaseModel):
    title: str
    category: str = "Research" # Changed default to one of the new keys
    priority: str = "Medium" # High, Medium, Low
    deadline: Optional[date] = None
    scheduled_date: Optional[date] = None
    order: int = 0

class BacklogItemResponse(BacklogItemCreate):
    id: str
    created_at: datetime
    is_archived: bool

class BacklogReorderRequest(BaseModel):
    ids: List[str]

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
    scheduled_time: str = "05:00"
    order: int = 0

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
    order: int = 0
    scheduled_time: Optional[str] = "05:00"

class ReorderRequest(BaseModel):
    ids: List[str]

# --- API Endpoints ---

@router.put("/daily/reorder")
def reorder_daily_tasks(request: ReorderRequest, db: firestore.Client = Depends(get_db)):
    batch = db.batch()
    for index, t_id in enumerate(request.ids):
        ref = db.collection("daily_tasks").document(t_id)
        batch.update(ref, {"order": index})
    batch.commit()
    return {"status": "reordered", "count": len(request.ids)}

@router.put("/routines/reorder")
def reorder_routines(request: ReorderRequest, db: firestore.Client = Depends(get_db)):
    batch = db.batch()
    for index, r_id in enumerate(request.ids):
        ref = db.collection("routines").document(r_id)
        batch.update(ref, {"order": index})
    batch.commit()
    return {"status": "reordered", "count": len(request.ids)}

@router.put("/backlog/reorder")
def reorder_backlog_items(request: BacklogReorderRequest, db: firestore.Client = Depends(get_db)):
    batch = db.batch()
    for index, b_id in enumerate(request.ids):
        ref = db.collection("backlog_items").document(b_id)
        batch.update(ref, {"order": index})
    batch.commit()
    return {"status": "reordered", "count": len(request.ids)}

@router.post("/backlog", response_model=BacklogItemResponse)
def create_backlog_item(item: BacklogItemCreate, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("backlog_items").document()
    data = item.dict()
    
    # Fix: Convert date objects to datetime for Firestore
    if data.get('deadline'):
        data['deadline'] = datetime.combine(data['deadline'], datetime.min.time())
    if data.get('scheduled_date'):
        data['scheduled_date'] = datetime.combine(data['scheduled_date'], datetime.min.time())

    data.update({
        "id": doc_ref.id,
        "created_at": datetime.now(),
        "is_archived": False
    })
    doc_ref.set(data)
    return data

@router.get("/backlog", response_model=List[BacklogItemResponse])
def get_backlog_items(limit: int = 100, db: firestore.Client = Depends(get_db)):
    # Order by 'order' field ascending
    docs = db.collection("backlog_items").where("is_archived", "==", False).order_by("order").limit(limit).stream()
    items = []
    for doc in docs:
        d = doc.to_dict()
        # Migration for existing items
        if 'priority' not in d: d['priority'] = 'Medium'
        if 'order' not in d: d['order'] = 0
        if 'category' not in d: d['category'] = 'Research'
        
        items.append(d)
    return items

@router.put("/backlog/{item_id}", response_model=BacklogItemResponse)
def update_backlog_item(item_id: str, item: BacklogItemCreate, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("backlog_items").document(item_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Item not found")
    
    data = item.dict()
    
    # Fix: Convert date objects to datetime for Firestore
    if data.get('deadline'):
        data['deadline'] = datetime.combine(data['deadline'], datetime.min.time())
    if data.get('scheduled_date'):
        data['scheduled_date'] = datetime.combine(data['scheduled_date'], datetime.min.time())

    # Preserve system fields
    current_data = doc_ref.get().to_dict()
    data.update({
        "id": item_id,
        "created_at": current_data.get("created_at"),
        "is_archived": current_data.get("is_archived", False)
    })
    
    doc_ref.set(data)
    return data

@router.delete("/backlog/{item_id}")
def delete_backlog_item(item_id: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("backlog_items").document(item_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Item not found")
    doc_ref.delete()
    return {"status": "deleted", "id": item_id}

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
        if 'scheduled_time' not in d:
             d['scheduled_time'] = "05:00"
        routines.append(d)
    return routines

@router.put("/routines/{routine_id}", response_model=RoutineResponse)
def update_routine(routine_id: str, routine: RoutineCreate, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("routines").document(routine_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Routine not found")
    
    data = routine.dict()
    data['routine_type'] = routine.routine_type.value
    if routine.frequency:
        data['frequency'] = routine.frequency.dict()
        data['frequency']['type'] = routine.frequency.type.value
    
    # Preserve creation time and ID
    data['id'] = routine_id
    current_data = doc_ref.get().to_dict()
    data['created_at'] = current_data.get('created_at', datetime.now()) # Keep original or valid default
    
    doc_ref.set(data) # Overwrite with new data
    return data

@router.delete("/routines/{routine_id}")
def delete_routine(routine_id: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("routines").document(routine_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Routine not found")
    doc_ref.delete()
    return {"status": "deleted", "id": routine_id}

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
                "created_at": datetime.now(),
                "title": r.get('title', 'Untitled'),
                "scheduled_time": r.get('scheduled_time', "05:00"),
                "order": 1000 # Put routines at end by default? Or 0? Let's say 0 but they can be reordered.
            }
            batch.set(doc_ref, new_task)
            created_count += 1
            
    batch.commit()
    return {"message": f"Generated {created_count} tasks", "date": target_date_str}

@router.get("/daily", response_model=List[DailyTaskResponse])
def get_daily_tasks(target_date: date = date.today(), db: firestore.Client = Depends(get_db)):
    target_date_str = target_date.isoformat()
    # Remove .order_by("order") to include docs without the field
    docs = db.collection("daily_tasks").where("target_date", "==", target_date_str).stream()
    
    tasks = []
    for doc in docs:
        t = doc.to_dict()
        title = t.get('title', "Unknown")
        source_exists = True

        if t['source_type'] == SourceType.BACKLOG.value:
            src = db.collection("backlog_items").document(t['source_id']).get()
            if src.exists: 
                title = src.to_dict().get('title', 'Unknown')
            else:
                source_exists = False
        elif t['source_type'] == SourceType.ROUTINE.value:
            src = db.collection("routines").document(t['source_id']).get()
            if src.exists: 
                title = src.to_dict().get('title', 'Unknown')
            else:
                source_exists = False
        
        # TIME FILTERING logic
        now = datetime.now()
        current_time_str = now.strftime("%H:%M")
        is_today = target_date_str == now.date().isoformat()
        
        show_task = True
        
        task_scheduled_time = t.get('scheduled_time', "05:00")
        
        if is_today and t['source_type'] == SourceType.ROUTINE.value:
            if current_time_str < task_scheduled_time:
                show_task = False
        
        if 'order' not in t:
             t['order'] = 0

        if source_exists and show_task:
            t['title'] = title
            tasks.append(t)
    
    # Sort in memory
    tasks.sort(key=lambda x: x.get('order', 0))
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
        "created_at": datetime.now(),
        "order": 0 # Default order
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

@router.patch("/daily/{task_id}/skip")
def skip_daily_task(task_id: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("daily_tasks").document(task_id)
    snap = doc_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Task not found")
    
    updates = {
        "status": TaskStatus.SKIPPED.value
    }
    doc_ref.update(updates)
    return {**snap.to_dict(), **updates}
