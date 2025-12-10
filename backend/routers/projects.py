from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
from google.cloud import firestore
from database import get_db

JST = timezone(timedelta(hours=9))

router = APIRouter(
    prefix="/projects",
    tags=["projects"],
)

# --- Models ---

class ProjectBase(BaseModel):
    title: str
    description: Optional[str] = None
    order: int = 0

class ProjectCreate(ProjectBase):
    pass

class ProjectResponse(ProjectBase):
    id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

class ProjectTaskBase(BaseModel):
    title: str
    details: Optional[str] = None
    order: int = 0
    is_completed: bool = False

class ProjectTaskCreate(ProjectTaskBase):
    pass

class ProjectTaskResponse(ProjectTaskBase):
    id: str
    project_id: str
    created_at: datetime
    updated_at: Optional[datetime] = None

class ReorderRequest(BaseModel):
    ids: List[str]

# --- Endpoints ---

@router.get("", response_model=List[ProjectResponse])
def get_projects(db: firestore.Client = Depends(get_db)):
    docs = db.collection("projects").order_by("order").stream()
    projects = []
    for doc in docs:
        d = doc.to_dict()
        projects.append(d)
    return projects

@router.post("", response_model=ProjectResponse)
def create_project(project: ProjectCreate, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("projects").document()
    data = project.dict()
    now = datetime.now(JST)
    data.update({
        "id": doc_ref.id,
        "created_at": now,
        "updated_at": now
    })
    doc_ref.set(data)
    return data

@router.delete("/{project_id}")
def delete_project(project_id: str, db: firestore.Client = Depends(get_db)):
    doc_ref = db.collection("projects").document(project_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Recursively delete tasks (optional but good for cleanup)
    # Firestore shallow delete doesn't delete subcollections.
    # For now, we'll just delete the project doc. 
    # TODO: Implement subcollection cleanup if needed.
    
    doc_ref.delete()
    return {"status": "deleted", "id": project_id}

@router.put("/reorder")
def reorder_projects(request: ReorderRequest, db: firestore.Client = Depends(get_db)):
    batch = db.batch()
    for index, p_id in enumerate(request.ids):
        ref = db.collection("projects").document(p_id)
        batch.update(ref, {"order": index})
    batch.commit()
    return {"status": "reordered", "count": len(request.ids)}


# --- Project Tasks ---

@router.get("/{project_id}/tasks", response_model=List[ProjectTaskResponse])
def get_project_tasks(project_id: str, db: firestore.Client = Depends(get_db)):
    # Verify project exists
    project_ref = db.collection("projects").document(project_id)
    if not project_ref.get().exists:
        raise HTTPException(status_code=404, detail="Project not found")

    docs = project_ref.collection("tasks").order_by("order").stream()
    tasks = []
    for doc in docs:
        tasks.append(doc.to_dict())
    return tasks

@router.post("/{project_id}/tasks", response_model=ProjectTaskResponse)
def create_project_task(project_id: str, task: ProjectTaskCreate, db: firestore.Client = Depends(get_db)):
    project_ref = db.collection("projects").document(project_id)
    if not project_ref.get().exists:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Determine order
    current_tasks = project_ref.collection("tasks").order_by("order").stream()
    max_order = -1
    for t in current_tasks:
        o = t.to_dict().get('order', 0)
        if o > max_order: max_order = o
    
    new_order = max_order + 1
    
    doc_ref = project_ref.collection("tasks").document()
    data = task.dict()
    now = datetime.now(JST)
    data.update({
        "id": doc_ref.id,
        "project_id": project_id,
        "created_at": now,
        "updated_at": now,
        "order": new_order # Override order if needed, or use request's order if specified (usually we auto-append)
    })
    doc_ref.set(data)
    return data

@router.put("/{project_id}/tasks/reorder")
def reorder_project_tasks(project_id: str, request: ReorderRequest, db: firestore.Client = Depends(get_db)):
    project_ref = db.collection("projects").document(project_id)
    if not project_ref.get().exists:
        raise HTTPException(status_code=404, detail="Project not found")

    batch = db.batch()
    for index, t_id in enumerate(request.ids):
        ref = project_ref.collection("tasks").document(t_id)
        batch.update(ref, {"order": index})
    batch.commit()
    return {"status": "reordered", "count": len(request.ids)}

@router.put("/{project_id}/tasks/{task_id}", response_model=ProjectTaskResponse)
def update_project_task(project_id: str, task_id: str, task: ProjectTaskCreate, db: firestore.Client = Depends(get_db)):
    project_ref = db.collection("projects").document(project_id)
    task_ref = project_ref.collection("tasks").document(task_id)
    
    if not task_ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
        
    data = task.dict()
    now = datetime.now(JST)
    
    # Preserve creation info
    current_data = task_ref.get().to_dict()
    data.update({
        "id": task_id,
        "project_id": project_id,
        "created_at": current_data.get("created_at"),
        "updated_at": now
    })
    
    task_ref.set(data)
    return data

@router.delete("/{project_id}/tasks/{task_id}")
def delete_project_task(project_id: str, task_id: str, db: firestore.Client = Depends(get_db)):
    project_ref = db.collection("projects").document(project_id)
    task_ref = project_ref.collection("tasks").document(task_id)
    
    if not task_ref.get().exists:
        raise HTTPException(status_code=404, detail="Task not found")
        
    task_ref.delete()
    return {"status": "deleted", "id": task_id}

@router.patch("/{project_id}/tasks/{task_id}/toggle")
def toggle_task_completion(project_id: str, task_id: str, db: firestore.Client = Depends(get_db)):
    project_ref = db.collection("projects").document(project_id)
    task_ref = project_ref.collection("tasks").document(task_id)
    
    snap = task_ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Task not found")
    
    current_status = snap.to_dict().get("is_completed", False)
    new_status = not current_status
    
    task_ref.update({"is_completed": new_status, "updated_at": datetime.now(JST)})
    return {"status": "updated", "is_completed": new_status}
