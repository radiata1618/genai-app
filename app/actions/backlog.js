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
        // Adjust Start Date to JST 00:00 (UTC 15:00 prev day) to catch JST-aligned tasks
        const start = new Date(filters.startDate);
        const jstStart = new Date(start.getTime() - 9 * 60 * 60 * 1000);
        query = query.where('scheduled_date', '>=', jstStart);
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
async function syncBacklogUpdateToDaily(sourceId, updates) {
    try {
        // We do NOT filter by date anymore.
        // If a backlog item is modified, we want all linked daily tasks (even overdue ones) to reflect that.
        // E.g. if we mark it DONE in backlog, the overdue daily task from yesterday should also become DONE.

        const snap = await db.collection('daily_tasks')
            .where('source_id', '==', sourceId)
            .where('source_type', '==', 'BACKLOG')
            .get();

        if (snap.empty) return;

        const batch = db.batch();
        snap.docs.forEach(doc => {
            batch.update(doc.ref, updates);
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

    // Sync if title, highlight, or STATUS changed, OR scheduled_date changed
    const syncUpdates = {};
    if (data.title) syncUpdates.title = data.title;
    if ('is_highlighted' in data) syncUpdates.is_highlighted = data.is_highlighted;

    // Handle Scheduled Date Sync (Move Daily Task)
    if (updates.scheduled_date !== undefined) { // Check undefined because it could be set to null
        const oldDate = snap.data().scheduled_date;
        const newDate = updates.scheduled_date;

        // Simple check: if dates are different
        const oldDateStr = oldDate ? oldDate.toDate().toISOString().split('T')[0] : null; // Firestore timestamp -> Date -> YYYY-MM-DD
        const newDateStr = newDate ? newDate.toISOString().split('T')[0] : null;

        if (oldDateStr !== newDateStr) {
            const batch = db.batch();

            // 1. Delete Old Daily Task if it exists
            if (oldDateStr) {
                const oldDailyId = `${id}_${oldDateStr}`;
                const oldRef = db.collection('daily_tasks').doc(oldDailyId);
                batch.delete(oldRef);
            }

            // 2. Create New Daily Task if new date is set
            if (newDateStr) {
                const newDailyId = `${id}_${newDateStr}`;
                const newRef = db.collection('daily_tasks').doc(newDailyId);

                // Get existing data to copy relevant fields
                const backlogData = { ...snap.data(), ...updates }; // merged

                // Check if daily task already exists? (Maybe user picked it manually?)
                // Strategy: Overwrite/Set to ensure it exists.
                batch.set(newRef, {
                    id: newDailyId,
                    source_id: id,
                    source_type: 'BACKLOG',
                    target_date: newDateStr,
                    status: 'TODO', // Reset status on move? Or keep? Usually TODO for new day.
                    created_at: new Date(),
                    title: backlogData.title,
                    order: 9999, // Push to end
                    is_highlighted: backlogData.is_highlighted || false
                });
            }
            await batch.commit();
        }
    }

    if (data.status) {
        // Map Backlog status to Daily status
        // Backlog: STOCK, PENDING, DONE
        // Daily: TODO, DONE, SKIPPED
        if (data.status === 'DONE') {
            syncUpdates.status = 'DONE';
            syncUpdates.completed_at = new Date(); // Set completed time for Daily
        } else {
            // If reverting to STOCK/PENDING, make it TODO
            syncUpdates.status = 'TODO';
            syncUpdates.completed_at = null;
        }
    }

    if (Object.keys(syncUpdates).length > 0) {
        await syncBacklogUpdateToDaily(id, syncUpdates);
    }

    return serialize({ ...snap.data(), ...updates, id });
}

export async function deleteBacklogItem(id) {
    const batch = db.batch();

    // 1. Delete Backlog Item
    const backlogRef = db.collection('backlog_items').doc(id);
    batch.delete(backlogRef);

    // 2. Find and Delete Linked Daily Tasks
    try {
        const dailySnap = await db.collection('daily_tasks')
            .where('source_id', '==', id)
            .where('source_type', '==', 'BACKLOG')
            .get();

        dailySnap.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
    } catch (e) {
        console.error("Failed to find linked daily tasks for deletion", e);
        // Continue to delete backlog item at least
    }

    await batch.commit();
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
