const API_BASE = 'http://localhost:8000/api/tasks';

export const api = {
    // Backlog
    getBacklog: async () => {
        const res = await fetch(`${API_BASE}/backlog`);
        if (!res.ok) throw new Error('Failed to fetch backlog');
        return res.json();
    },

    addBacklogItem: async (title, category = 'General', effort = 1) => {
        const res = await fetch(`${API_BASE}/backlog`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, category, estimated_effort: effort }),
        });
        if (!res.ok) throw new Error('Failed to add item');
        return res.json();
    },

    archiveBacklogItem: async (id) => {
        const res = await fetch(`${API_BASE}/backlog/${id}/archive`, {
            method: 'PATCH',
        });
        if (!res.ok) throw new Error('Failed to archive item');
        return res.json();
    },

    // Routines
    getRoutines: async () => {
        const res = await fetch(`${API_BASE}/routines`);
        if (!res.ok) throw new Error('Failed to fetch routines');
        return res.json();
    },

    addRoutine: async (title, type, cron, icon) => {
        const res = await fetch(`${API_BASE}/routines`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                routine_type: type,
                frequency_cron: cron,
                icon
            }),
        });
        if (!res.ok) throw new Error('Failed to add routine');
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
    }
};
