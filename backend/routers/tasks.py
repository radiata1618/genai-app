
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from typing import List, Optional
from pydantic import BaseModel
from datetime import date, datetime, timezone, timedelta
import enum
from google.cloud import firestore
from database import get_db

JST = timezone(timedelta(hours=9))

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
    category: str = "Research" 
    priority: str = "Medium" 
    deadline: Optional[date] = None
    scheduled_date: Optional[date] = None
    status: str = "STOCK" 
    order: int = 0
    place: Optional[str] = None
    is_highlighted: bool = False
    is_pet_allowed: bool = False

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
    weekdays: List[int] = [] 
    month_days: List[int] = [] 

class RoutineCreate(BaseModel):
    title: str
    routine_type: RoutineType
    frequency: Optional[FrequencyConfig] = None
    icon: Optional[str] = None
    scheduled_time: str = "05:00"
    order: int = 0
    is_highlighted: bool = False

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
    is_highlighted: bool = False

class ReorderRequest(BaseModel):
    ids: List[str]

# --- Helper Functions (Async Sync) ---

def sync_backlog_update_to_daily(source_id: str, title: str, is_highlighted: bool, db: firestore.Client):
    """
    Update title and highlight status of all FUTURE or TODAY daily tasks 
    that are sourced from this backlog item.
    """
    try:
        # Find tasks sourced from this backlog item that are not completed (optional optimization)
        # or just find all for simplicity/correctness even if done?
        # Let's find all for today and future.
        today_str = datetime.now(JST).date().isoformat()
        
        docs = db.collection("daily_tasks")\
            .where("source_id", "==", source_id)\
            .where("source_type", "==", SourceType.BACKLOG.value)\
            .where("target_date", ">=", today_str)\
            .stream()
            
        batch = db.batch()
        count = 0
        for doc in docs:
            batch.update(doc.reference, {
                "title": title,
                "is_highlighted": is_highlighted
            })
            count += 1
            if count >= 400: # Batch limit safe guard
                batch.commit()
                batch = db.batch()
                count = 0
        
        if count > 0:
            batch.commit()
            
    except Exception as e:
        print(f"Async Sync Error (Backlog->Daily): {e}")

def sync_routine_to_daily(source_id: str, title: str, db: firestore.Client):
    """
    Update title of all FUTURE or TODAY daily tasks sourced from this routine.
    """
    try:
        today_str = datetime.now(JST).date().isoformat()
        
        docs = db.collection("daily_tasks")\
            .where("source_id", "==", source_id)\
            .where("source_type", "==", SourceType.ROUTINE.value)\
            .where("target_date", ">=", today_str)\
            .stream()
            
        batch = db.batch()
        count = 0
        for doc in docs:
            batch.update(doc.reference, {"title": title})
            count += 1
            if count >= 400:
                batch.commit()
                batch = db.batch()
                count = 0
        if count > 0:
            batch.commit()
    except Exception as e:
        print(f"Async Sync Error (Routine->Daily): {e}")

def sync_daily_completion_to_backlog(backlog_id: str, completed: bool, db: firestore.Client):
    """
    Sync completion status back to backlog item.
    """
    try:
        new_status = "DONE" if completed else "STOCK"
        db.collection("backlog_items").document(backlog_id).update({"status": new_status})
    except Exception as e:
        print(f"Async Sync Error (Daily->Backlog Status): {e}")

def sync_daily_highlight_to_backlog(backlog_id: str, highlighted: bool, db: firestore.Client):
    try:
        db.collection("backlog_items").document(backlog_id).update({"is_highlighted": highlighted})
    except Exception as e:
        print(f"Async Sync Error (Daily->Backlog Highlight): {e}")


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
    try:
        doc_ref = db.collection("backlog_items").document()
        data = item.dict()
        
        if data.get('deadline'):
            data['deadline'] = datetime.combine(data['deadline'], datetime.min.time())
        if data.get('scheduled_date'):
            data['scheduled_date'] = datetime.combine(data['scheduled_date'], datetime.min.time())

        data.update({
            "id": doc_ref.id,
            "created_at": datetime.now(JST),
            "is_archived": False
        })
        doc_ref.set(data)
        return data
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

@router.get("/backlog", response_model=List[BacklogItemResponse])
def get_backlog_items(limit: int = 100, db: firestore.Client = Depends(get_db)):
    docs = db.collection("backlog_items").where("is_archived", "==", False).order_by("order").limit(limit).stream()
    items = []
    for doc in docs:
        d = doc.to_dict()
        if 'priority' not in d: d['priority'] = 'Medium'
        if 'order' not in d: d['order'] = 0
        if 'category' not in d: d['category'] = 'Research'
        if 'status' not in d: d['status'] = 'STOCK'
        if 'place' not in d: d['place'] = None
        if 'is_highlighted' not in d: d['is_highlighted'] = False
        if 'is_pet_allowed' not in d: d['is_pet_allowed'] = False
        items.append(d)
    return items

@router.put("/backlog/{item_id}", response_model=BacklogItemResponse)
def update_backlog_item(item_id: str, item: BacklogItemCreate, background_tasks: BackgroundTasks, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("backlog_items").document(item_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Item not found")
    
    data = item.dict()
    
    if data.get('deadline'):
        data['deadline'] = datetime.combine(data['deadline'], datetime.min.time())
    if data.get('scheduled_date'):
        data['scheduled_date'] = datetime.combine(data['scheduled_date'], datetime.min.time())

    current_data = doc_ref.get().to_dict()
    data.update({
        "id": item_id,
        "created_at": current_data.get("created_at"),
        "is_archived": current_data.get("is_archived", False)
    })
    
    doc_ref.set(data)
    
    # Async Sync
    background_tasks.add_task(sync_backlog_update_to_daily, item_id, item.title, item.is_highlighted, db)

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
        "created_at": datetime.now(JST)
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
def update_routine(routine_id: str, routine: RoutineCreate, background_tasks: BackgroundTasks, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("routines").document(routine_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Routine not found")
    
    data = routine.dict()
    data['routine_type'] = routine.routine_type.value
    if routine.frequency:
        data['frequency'] = routine.frequency.dict()
        data['frequency']['type'] = routine.frequency.type.value
    
    data['id'] = routine_id
    current_data = doc_ref.get().to_dict()
    data['created_at'] = current_data.get('created_at', datetime.now(JST)) 
    
    doc_ref.set(data)
    
    # Async Sync
    background_tasks.add_task(sync_routine_to_daily, routine_id, routine.title, db)
    
    return data

@router.delete("/routines/{routine_id}")
def delete_routine(routine_id: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("routines").document(routine_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Routine not found")
    doc_ref.delete()
    return {"status": "deleted", "id": routine_id}

@router.post("/generate-daily")
def generate_daily_tasks(target_date: Optional[date] = None, db: firestore.Client = Depends(get_db)):
    if target_date is None:
        target_date = datetime.now(JST).date()
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
                "created_at": datetime.now(JST),
                "title": r.get('title', 'Untitled'),
                "scheduled_time": r.get('scheduled_time', "05:00"),
                "order": r.get('order', 1000), 
                "is_highlighted": r.get('is_highlighted', False)
            }
            batch.set(doc_ref, new_task)
            created_count += 1
            
    
    # --- CARRY OVER LOGIC ---
    past_backlog_docs = db.collection("daily_tasks")\
        .where("source_type", "==", SourceType.BACKLOG.value)\
        .where("status", "==", TaskStatus.TODO.value)\
        .stream()

    current_today_docs = db.collection("daily_tasks").where("target_date", "==", target_date_str).stream()
    max_order = 0
    for d in current_today_docs:
         max_order = max(max_order, d.to_dict().get('order', 0))

    for doc in past_backlog_docs:
        t = doc.to_dict()
        old_date_str = t['target_date']
        
        # Only carry over if from the past
        if old_date_str < target_date_str:
            batch.update(doc.reference, {"status": TaskStatus.CARRY_OVER.value})
            
            new_id = f"{t['source_id']}_{target_date_str}"
            new_ref = db.collection("daily_tasks").document(new_id)
            
            if not new_ref.get().exists:
                max_order += 1
                new_task = {
                    "id": new_id,
                    "source_id": t['source_id'],
                    "source_type": SourceType.BACKLOG.value,
                    "target_date": target_date_str,
                    "status": TaskStatus.TODO.value,
                    "created_at": datetime.now(JST),
                    "title": t.get('title', 'Unknown'), # Important: Copy existing title
                    "order": max_order,
                    "is_highlighted": t.get('is_highlighted', False) # Important: Copy highlight
                }
                batch.set(new_ref, new_task)
                created_count += 1

    batch.commit()
    return {"message": f"Generated {created_count} tasks", "date": target_date_str}

@router.get("/daily", response_model=List[DailyTaskResponse])
def get_daily_tasks(target_date: Optional[date] = None, db: firestore.Client = Depends(get_db)):
    if target_date is None:
        target_date = datetime.now(JST).date()
    target_date_str = target_date.isoformat()
    
    # ---------------------------------------------------------
    # OPTIMIZATION: Removed N+1 queries.
    # ---------------------------------------------------------
    docs = db.collection("daily_tasks").where("target_date", "==", target_date_str).stream()
    
    tasks = []
    
    # Pre-calculate filtering details using now() if strictly needed, 
    # but frontend can allow all and filter? 
    # Original logic filtered Routines by time if it's "Today".
    
    now = datetime.now(JST)
    current_time_str = now.strftime("%H:%M")
    is_today = target_date_str == now.date().isoformat()
    
    for doc in docs:
        t = doc.to_dict()
        
        # Default fillers for Denormalization safety
        if 'title' not in t: t['title'] = "Unknown Task"
        if 'is_highlighted' not in t: t['is_highlighted'] = False
        if 'order' not in t: t['order'] = 0
        
        # TIME FILTERING logic (Keep relevant logic)
        show_task = True
        task_scheduled_time = t.get('scheduled_time', "05:00")
        
        if is_today and t['source_type'] == SourceType.ROUTINE.value:
            if current_time_str < task_scheduled_time:
                show_task = False
        
        if show_task:
            tasks.append(t)
    
    tasks.sort(key=lambda x: x.get('order', 0))
    return tasks

@router.post("/daily/pick")
def pick_from_backlog(backlog_id: str, target_date: Optional[date] = None, db: firestore.Client = Depends(get_db)):
    if target_date is None:
        target_date = datetime.now(JST).date()
    target_date_str = target_date.isoformat()
    item_ref = db.collection("backlog_items").document(backlog_id)
    item_snap = item_ref.get()
    
    if not item_snap.exists:
        raise HTTPException(status_code=404, detail="Backlog item not found")
    
    item_data = item_snap.to_dict()
    
    doc_id = f"{backlog_id}_{target_date_str}"
    doc_ref = db.collection("daily_tasks").document(doc_id)
    
    if doc_ref.get().exists:
         return {"message": "Already picked"}

    existing_docs = db.collection("daily_tasks").where("target_date", "==", target_date_str).stream()
    max_order = -1
    for d in existing_docs:
        d_dict = d.to_dict()
        o = d_dict.get('order', 0)
        if o > max_order: max_order = o
    
    new_task = {
        "id": doc_id,
        "source_id": backlog_id,
        "source_type": SourceType.BACKLOG.value,
        "target_date": target_date_str,
        "status": TaskStatus.TODO.value,
        "created_at": datetime.now(JST),
        "order": max_order + 1,
        "title": item_data.get('title', 'Untitled'), # Copied Title
        "is_highlighted": item_data.get('is_highlighted', False) # Copied Highlight
    }
    doc_ref.set(new_task)
    return new_task

@router.patch("/daily/{task_id}/complete")
def complete_daily_task(task_id: str, completed: bool = True, background_tasks: BackgroundTasks = None, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("daily_tasks").document(task_id)
    snap = doc_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Task not found")
    
    updates = {
        "status": TaskStatus.DONE.value if completed else TaskStatus.TODO.value,
        "completed_at": datetime.now(JST) if completed else None
    }
    doc_ref.update(updates)

    daily_data = snap.to_dict()
    if daily_data.get('source_type') == SourceType.BACKLOG.value and background_tasks:
        backlog_id = daily_data.get('source_id')
        background_tasks.add_task(sync_daily_completion_to_backlog, backlog_id, completed, db)

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

@router.patch("/daily/{task_id}/highlight")
def highlight_daily_task(task_id: str, highlighted: bool = True, background_tasks: BackgroundTasks = None, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("daily_tasks").document(task_id)
    snap = doc_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Task not found")
    
    updates = {
        "is_highlighted": highlighted
    }
    doc_ref.update(updates)
    
    daily_data = snap.to_dict()
    if daily_data.get('source_type') == SourceType.BACKLOG.value and background_tasks:
         background_tasks.add_task(sync_daily_highlight_to_backlog, daily_data['source_id'], highlighted, db)

    return {**snap.to_dict(), **updates}

@router.patch("/daily/{task_id}/postpone")
def postpone_daily_task(task_id: str, new_date: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("daily_tasks").document(task_id)
    daily_snap = doc_ref.get()
    
    if not daily_snap.exists:
        raise HTTPException(status_code=404, detail="Task not found")
    
    daily_data = daily_snap.to_dict()
    source_type = daily_data.get('source_type')
    source_id = daily_data.get('source_id')

    if source_type != SourceType.BACKLOG.value:
        raise HTTPException(status_code=400, detail="Only Backlog items can be postponed")

    backlog_ref = db.collection("backlog_items").document(source_id)
    if not backlog_ref.get().exists:
        raise HTTPException(status_code=404, detail="Original Backlog Item not found")

    try:
        new_date_obj = datetime.strptime(new_date, "%Y-%m-%d").date()
        new_date_dt = datetime.combine(new_date_obj, datetime.min.time())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    backlog_ref.update({"scheduled_date": new_date_dt})
    doc_ref.delete()

    return {"status": "postponed", "new_date": new_date}
