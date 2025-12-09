const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_BASE = `${BASE_URL}/api/tasks`;

export const api = {
    // Backlog
    getBacklog: async () => {
        const res = await fetch(`${API_BASE}/backlog`);
        if (!res.ok) throw new Error('Failed to fetch backlog');
        return res.json();
    },

    addBacklogItem: async (taskData) => {
        // taskData: { title, category, priority, deadline, scheduled_date, order }
        const res = await fetch(`${API_BASE}/backlog`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskData),
        });
        if (!res.ok) {
            let msg = `Error ${res.status}: ${res.statusText}`;
            try {
                const err = await res.json();
                if (err.detail) msg += ` - ${err.detail}`;
            } catch (e) { /* ignore */ }
            throw new Error(msg);
        }
        return res.json();
    },

    updateBacklogItem: async (id, taskData) => {
        const res = await fetch(`${API_BASE}/backlog/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskData),
        });
        if (!res.ok) throw new Error('Failed to update item');
        return res.json();
    },

    deleteBacklogItem: async (id) => {
        const res = await fetch(`${API_BASE}/backlog/${id}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete item');
        return res.json();
    },

    reorderBacklogItems: async (orderedIds) => {
        const res = await fetch(`${API_BASE}/backlog/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: orderedIds }),
        });
        if (!res.ok) throw new Error('Failed to reorder items');
        return res.json();
    },



    // Routines (Actions & Mindsets)
    getRoutines: async (type = null) => {
        let url = `${API_BASE}/routines`;
        if (type) url += `?type=${type}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch routines');
        return res.json();
    },

    addRoutine: async (title, type, frequency = null, icon = null, scheduled_time = "05:00") => {
        const res = await fetch(`${API_BASE}/routines`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                routine_type: type,
                frequency: frequency,
                icon,
                scheduled_time
            }),
        });
        if (!res.ok) throw new Error('Failed to add routine');
        return res.json();
    },

    updateRoutine: async (id, title, type, frequency = null, icon = null, scheduled_time = "05:00") => {
        const res = await fetch(`${API_BASE}/routines/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                routine_type: type,
                frequency: frequency,
                icon,
                scheduled_time
            }),
        });
        if (!res.ok) throw new Error('Failed to update routine');
        return res.json();
    },

    deleteRoutine: async (id) => {
        const res = await fetch(`${API_BASE}/routines/${id}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete routine');
        return res.json();
    },

    reorderRoutines: async (orderedIds) => {
        const res = await fetch(`${API_BASE}/routines/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: orderedIds }),
        });
        if (!res.ok) throw new Error('Failed to reorder routines');
        return res.json();
    },

    // Factory (Generate Daily)
    generateDailyTasks: async () => {
        const res = await fetch(`${API_BASE}/generate-daily`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to generate daily tasks');
        return res.json();
    },

    // Daily Tasks
    getDaily: async () => {
        const res = await fetch(`${API_BASE}/daily`);
        if (!res.ok) throw new Error('Failed to fetch daily tasks');
        return res.json();
    },

    pickFromBacklog: async (id) => {
        const res = await fetch(`${API_BASE}/daily/pick?backlog_id=${id}`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to pick task');
        return res.json();
    },

    toggleComplete: async (id, isCompleted) => {
        const res = await fetch(`${API_BASE}/daily/${id}/complete?completed=${isCompleted}`, {
            method: 'PATCH',
        });
        if (!res.ok) throw new Error('Failed to update status');
        return res.json();
    },

    reorderDaily: async (orderedIds) => {
        const res = await fetch(`${API_BASE}/daily/reorder`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: orderedIds }),
        });
        if (!res.ok) throw new Error('Failed to reorder daily tasks');
        return res.json();
    },

    skipTask: async (id) => {
        const res = await fetch(`${API_BASE}/daily/${id}/skip`, {
            method: 'PATCH',
        });
        if (!res.ok) throw new Error('Failed to skip task');
        return res.json();
    },

    // File Management
    getFiles: async () => {
        const res = await fetch(`${API_BASE.replace('/tasks', '')}/management/files`);
        if (!res.ok) throw new Error('Failed to fetch files');
        return res.json();
    },

    uploadFile: async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE.replace('/tasks', '')}/management/files`, {
            method: 'POST',
            body: formData,
        });
        if (!res.ok) throw new Error('Failed to upload file');
        return res.json();
    },

    deleteFile: async (filename) => {
        const res = await fetch(`${API_BASE.replace('/tasks', '')}/management/files/${filename}`, {
            method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to delete file');
        return res.json();
    }
};
