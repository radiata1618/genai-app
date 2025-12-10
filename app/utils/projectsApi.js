const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_BASE_URL = `${BASE_URL}/api/projects`;

const getHeaders = () => ({
    "Content-Type": "application/json",
    // Auth header is injected by Next.js Middleware
});

export async function getProjects() {
    const res = await fetch(`${API_BASE_URL}`, {
        method: "GET",
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch projects");
    return res.json();
}

export async function createProject(title, description = "") {
    const res = await fetch(`${API_BASE_URL}`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ title, description }),
    });
    if (!res.ok) throw new Error("Failed to create project");
    return res.json();
}

export async function updateProject(projectId, title, description = "") {
    const res = await fetch(`${API_BASE_URL}/${projectId}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ title, description }),
    });
    if (!res.ok) throw new Error("Failed to update project");
    return res.json();
}

export async function deleteProject(projectId) {
    const res = await fetch(`${API_BASE_URL}/${projectId}`, {
        method: "DELETE",
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete project");
    return res.json();
}

export async function reorderProjects(ids) {
    const res = await fetch(`${API_BASE_URL}/reorder`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error("Failed to reorder projects");
    return res.json();
}

// --- Tasks ---

export async function getProjectTasks(projectId) {
    const res = await fetch(`${API_BASE_URL}/${projectId}/tasks`, {
        method: "GET",
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch project tasks");
    return res.json();
}

export async function createProjectTask(projectId, title, details = "") {
    const res = await fetch(`${API_BASE_URL}/${projectId}/tasks`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ title, details }),
    });
    if (!res.ok) throw new Error("Failed to create project task");
    return res.json();
}

export async function updateProjectTask(projectId, taskId, data) {
    const res = await fetch(`${API_BASE_URL}/${projectId}/tasks/${taskId}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to update project task");
    return res.json();
}

export async function deleteProjectTask(projectId, taskId) {
    const res = await fetch(`${API_BASE_URL}/${projectId}/tasks/${taskId}`, {
        method: "DELETE",
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to delete project task");
    return res.json();
}

export async function reorderProjectTasks(projectId, ids) {
    const res = await fetch(`${API_BASE_URL}/${projectId}/tasks/reorder`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({ ids }),
    });
    if (!res.ok) throw new Error("Failed to reorder project tasks");
    return res.json();
}

export async function toggleProjectTask(projectId, taskId) {
    const res = await fetch(`${API_BASE_URL}/${projectId}/tasks/${taskId}/toggle`, {
        method: "PATCH",
        headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to toggle project task");
    return res.json();
}
