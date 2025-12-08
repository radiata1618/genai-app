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

class ReorderRequest(BaseModel):
    ids: List[str]

# --- API Endpoints ---

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
        # Map old categories if necessary? For now user just wants new ones.
        
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
    # We might want to keep the original created_at, so we utilize set with merge=True or just update specific fields.
    # However, RoutineResponse expects created_at. Let's fetch the original first or just update.
    # For simplicity in this schema, we will overwrite the main fields but keep created_at if possible.
    # Actually, to return the full object, let's just update and assume the client handles the freshness.
    
    # To do it properly:
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
                "target_date": target_date_str,
                "status": TaskStatus.TODO.value,
                "created_at": datetime.now(),
                "title": r.get('title', 'Untitled'),
                "scheduled_time": r.get('scheduled_time', "05:00")
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
        
        # If we have a stored title, we might choose to show it even if source is gone,
        # OR we hide it as per the user request "actions task is deleted -> remove from today".
        # The user said: "Actionsのタスクが削除されるとUnknownというタスクが残ってしまう この現象を修正したい"
        # So filtering out is the correct approach.
        
        # TIME FILTERING:
        # If today is the target date, perform time check.
        # current_time (HH:MM) >= scheduled_time (HH:MM)
        # default scheduled_time is "05:00"
        
        # Check based on user local time? 
        # The user said "Also when displaying tasks on Today's screen, make it so that new daily tasks appear when the specified time is exceeded".
        # We really need the CLIENT time for this comparison ideally, but backend filtering is safer if we assume server time or pass user time?
        # Actually, simpler: We check against SERVER time (assuming User is in same timezone or container is set correctly) OR we do it on frontend.
        # However, Request was "display on Today's screen...".
        # Let's do it in backend using server time (container time).
        # Metadata says: "The current local time is: 2025-12-08T21:46:47+09:00" (JST).
        # The server should be running in JST too if properly configured, or we use datetime.now() with offset.
        # Since I see "The current local time is..." in metadata, it means the AGENT knows the time. 
        # But the backend code runs in the container.
        # Let's assume standard datetime.now() reflects the system time which is likely relevant to the user or UTC.
        # BUT: the PROMPT said "The current local time is ... +09:00".
        # Let's check `target_date`. If `target_date` == `datetime.now().date()`, then filter.
        
        now = datetime.now()
        current_time_str = now.strftime("%H:%M")
        is_today = target_date_str == now.date().isoformat()
        
        show_task = True
        
        # Only filter routines (actions) or all? Request says "Daily's scheduled time". 
        # Usually implies Routines. Backlog items generally don't have this hour spec yet (except maybe deadline?).
        # Task schema for daily:
        # We stored `scheduled_time` in generate_daily_tasks for routines.
        
        task_scheduled_time = t.get('scheduled_time', "05:00")
        
        if is_today and t['source_type'] == SourceType.ROUTINE.value:
            if current_time_str < task_scheduled_time:
                show_task = False

        if source_exists and show_task:
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
