'use server';

import { db } from '../lib/firebase';
import { FieldPath } from 'firebase-admin/firestore';

// Helper: Serialize Firestore data
function serialize(obj) {
    if (obj === null || obj === undefined) return obj;

    // Handle Firestore Timestamp
    if (obj && typeof obj.toDate === 'function') {
        return obj.toDate().toISOString();
    }

    // Handle Date
    if (obj instanceof Date) {
        return obj.toISOString();
    }

    // Handle Array
    if (Array.isArray(obj)) {
        return obj.map(item => serialize(item));
    }

    // Handle Object
    if (typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = serialize(obj[key]);
        }
        return newObj;
    }

    return obj;
}

export async function getBacklogItems(filters = {}) {
    let query = db.collection('backlog_items')
        .where('is_archived', '==', false);

    // Filter Logic
    const statuses = ['STOCK']; // Always include STOCK
    if (!filters.excludeCompleted) statuses.push('DONE');
    if (!filters.excludePending) statuses.push('PENDING');

    // Firestore 'in' query supports up to 10 values
    query = query.where('status', 'in', statuses);

    if (filters.startDate) {
        query = query.where('scheduled_date', '>=', new Date(filters.startDate));
    }
    if (filters.endDate) {
        query = query.where('scheduled_date', '<=', new Date(filters.endDate));
    }

    const snap = await query.orderBy('order', 'asc')
        .limit(2000)
        .get();

    const tasks = snap.docs.map(d => {
        const data = d.data();
        return serialize({
            ...data,
            id: d.id, // Ensure ID is present
            // Defaults
            priority: data.priority || 'Medium',
            category: data.category || 'Research',
            status: data.status || 'STOCK',
            is_highlighted: data.is_highlighted || false,
            sprintId: data.sprintId || null // Include sprintId
        });
    });

    // Client-side filtering for complex logic not strictly supported in compound queries easily 
    // (e.g. "exclude sprint" might be simpler here if not indexing specifically for it)
    // Actually we can do client side filter for 'excludeInSprint' since we fetch 2000 items.
    if (filters.excludeInSprint) {
        return tasks.filter(t => !t.sprintId); // existing sprintId means it is in A sprint (completed or active)
        // If we only want to exclude ACTIVE sprint tasks, we'd need to know the active sprint ID.
        // For simplicity based on request "Exclude Sprint Tasks", we exclude ANY assigned task.
        // Or better, let the client handle it if they pass the active sprint ID?
        // The implementation plan proposed: "excludeInSprint" filter.
        // Let's filter out any task that has a sprintId.
    }

    return tasks;
}

export async function addBacklogItem(data) {
    // data: { title, category, priority, deadline, scheduled_date, place, is_highlighted }
    const docRef = db.collection('backlog_items').doc();
    const now = new Date();

    // Date conversions
    const payload = {
        id: docRef.id,
        created_at: now,
        is_archived: false,
        title: data.title,
        category: data.category || 'Research',
        priority: data.priority || 'Medium',
        status: 'STOCK',
        order: 0, // Should be max+1 ideally, or handled by reorder
        is_highlighted: data.is_highlighted || false,
        place: data.place || null,
        sprintId: data.sprintId || null, // Optional Sprint Assignment
        is_pet_allowed: data.is_pet_allowed || false
    };

    if (data.deadline) payload.deadline = new Date(data.deadline);
    if (data.scheduled_date) payload.scheduled_date = new Date(data.scheduled_date);

    await docRef.set(payload);
    return serialize(payload);
}

// Sync Logic: Backlog -> Daily
async function syncBacklogUpdateToDaily(sourceId, title, isHighlighted) {
    try {
        const todayStr = new Date().toISOString().split('T')[0];

        const snap = await db.collection('daily_tasks')
            .where('source_id', '==', sourceId)
            .where('source_type', '==', 'BACKLOG')
            .where('target_date', '>=', todayStr)
            .get();

        if (snap.empty) return;

        const batch = db.batch();
        snap.docs.forEach(doc => {
            batch.update(doc.ref, {
                title: title,
                is_highlighted: isHighlighted
            });
        });
        await batch.commit();
    } catch (e) {
        console.error("Sync Error:", e);
    }
}

export async function updateBacklogItem(id, data) {
    const docRef = db.collection('backlog_items').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error("Item not found");

    const updates = { ...data };

    // Safety: don't overwrite created_at or id usually, but here we just merge
    delete updates.id;
    delete updates.created_at;

    if (updates.deadline) updates.deadline = new Date(updates.deadline);
    if (updates.scheduled_date) updates.scheduled_date = new Date(updates.scheduled_date);

    await docRef.update(updates);

    // Sync if title or highlight changed
    if (data.title || 'is_highlighted' in data) {
        // Determine new values (use provided or fallback to existing?) 
        // For simplicity, we assume 'data' contains the changes. 
        // If partial update, we might need current values.
        // Let's rely on what was passed or fetch fresh? 
        // Actually, simpler to just use what we have if available.
        const current = snap.data();
        const newTitle = data.title || current.title;
        const newHighlight = 'is_highlighted' in data ? data.is_highlighted : current.is_highlighted;

        // Fire and forget (await but don't block return heavily?) 
        // Server Actions must complete for client to return.
        await syncBacklogUpdateToDaily(id, newTitle, newHighlight);
    }

    return serialize({ ...snap.data(), ...updates, id });
}

export async function deleteBacklogItem(id) {
    await db.collection('backlog_items').doc(id).delete();
    return { status: 'deleted', id };
}

export async function archiveBacklogItem(id) {
    await db.collection('backlog_items').doc(id).update({ is_archived: true });
    return { status: 'archived', id };
}

export async function reorderBacklogItems(ids) {
    const batch = db.batch();
    ids.forEach((id, index) => {
        const ref = db.collection('backlog_items').doc(id);
        batch.update(ref, { order: index });
    });
    await batch.commit();
    return { status: 'reordered', count: ids.length };
}
