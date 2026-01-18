'use server';

import { db } from '../lib/firebase';
import { FieldPath } from 'firebase-admin/firestore';

// Helper: Serialize Firestore data (Reused from backlog.js pattern)
function serialize(obj) {
    if (obj === null || obj === undefined) return obj;
    if (obj && typeof obj.toDate === 'function') return obj.toDate().toISOString();
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(item => serialize(item));
    if (typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = serialize(obj[key]);
        }
        return newObj;
    }
    return obj;
}

// Create a new sprint
export async function createSprint(data) {
    // data: { name, startDate, endDate }
    // Ensure no other active sprint exists (optional, but good practice per requirement)
    const active = await getCurrentSprint();
    if (active) {
        throw new Error("An active sprint already exists.");
    }

    const docRef = db.collection('sprints').doc();
    const now = new Date();

    const payload = {
        id: docRef.id,
        name: data.name,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        goal: '',
        retro: '',
        status: 'ACTIVE',
        created_at: now
    };

    await docRef.set(payload);
    return serialize(payload);
}

// Get the current active sprint
export async function getCurrentSprint() {
    const snap = await db.collection('sprints')
        .where('status', '==', 'ACTIVE')
        .limit(1)
        .get();

    if (snap.empty) return null;
    return serialize({ ...snap.docs[0].data(), id: snap.docs[0].id });
}

// Update Sprint Goal
export async function updateSprintGoal(sprintId, goal) {
    await db.collection('sprints').doc(sprintId).update({ goal });
    return { status: 'updated', sprintId, goal };
}

// Complete Sprint
export async function completeSprint(sprintId, retro) {
    const now = new Date();
    await db.collection('sprints').doc(sprintId).update({
        status: 'COMPLETED',
        retro: retro,
        completed_at: now
    });

    // Optional: Archive tasks or handle them? 
    // For now, we leave them as is, or maybe they stay in BACKLOG/DONE? 
    // If tasks are 'DONE' they stay DONE. If 'STOCK'/'PENDING' but inside sprint, 
    // they might remain assigned to this old sprint ID. 
    // Plan doesn't specify auto-rolling over, so we proceed with just closing the sprint.

    return { status: 'completed', sprintId };
}

// Add tasks to Sprint
export async function addTasksToSprint(sprintId, taskIds) {
    if (!taskIds || taskIds.length === 0) return;

    const batch = db.batch();
    taskIds.forEach(id => {
        const ref = db.collection('backlog_items').doc(id);
        batch.update(ref, { sprintId: sprintId });
    });
    await batch.commit();
    return { status: 'added', count: taskIds.length };
}

// Remove task from Sprint
export async function removeTaskFromSprint(taskId, scheduleUpdate = undefined) {
    const taskRef = db.collection('backlog_items').doc(taskId);
    const snap = await taskRef.get();
    if (!snap.exists) throw new Error("Task not found");
    const taskData = snap.data();

    const updatePayload = { sprintId: null };
    const batch = db.batch();

    // scheduleUpdate: { date: Date | null }
    let newDateStr = null;
    let oldDateStr = null;

    // Fix: Calculate oldDateStr using JST (UTC+9) logic to match Daily Task ID generation
    if (taskData.scheduled_date) {
        const utcDate = taskData.scheduled_date.toDate();
        // Add 9 hours to shift to JST, then take UTC components which will now match JST components
        const jstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
        oldDateStr = jstDate.toISOString().split('T')[0];
    }

    if (scheduleUpdate) {
        if (scheduleUpdate.date) {
            const d = new Date(scheduleUpdate.date);
            updatePayload.scheduled_date = d;
            newDateStr = d.toISOString().split('T')[0];
        } else {
            updatePayload.scheduled_date = null; // Clear date
            newDateStr = null;
        }
    } else {
        // If not specified, keep existing date? 
        // Usage in page.js implies removeTaskFromSprint is "Remove & Reschedule" (SKIP).
        // If scheduleUpdate is undefined, we just remove from sprint but keep date?
        // Actually executeRemoveTask calls with { date: ... } or undefined.
        // If undefined, it means just remove from sprint. Dates don't change.
        newDateStr = oldDateStr;
    }

    batch.update(taskRef, updatePayload);

    // Sync Daily Tasks if date changed
    if (oldDateStr !== newDateStr) {
        // 1. Delete Old Daily Task if it exists
        if (oldDateStr) {
            const oldDailyId = `${taskId}_${oldDateStr}`;
            const oldRef = db.collection('daily_tasks').doc(oldDailyId);
            batch.delete(oldRef);
        }

        // 2. Create New Daily Task if new date is set
        if (newDateStr) {
            const newDailyId = `${taskId}_${newDateStr}`;
            const newRef = db.collection('daily_tasks').doc(newDailyId);

            // Check max order logic or just push to end
            // We can do a quick check or just use 9999
            batch.set(newRef, {
                id: newDailyId,
                source_id: taskId,
                source_type: 'BACKLOG',
                target_date: newDateStr,
                status: 'TODO',
                created_at: new Date(),
                title: taskData.title, // Use existing title
                order: 9999,
                is_highlighted: taskData.is_highlighted || false
            });
        }
    }

    await batch.commit();
    return { status: 'removed', taskId, scheduled_date: updatePayload.scheduled_date };
}

// Delete Sprint (and unassign tasks)
export async function deleteSprint(sprintId, unassignTasks = true) {
    // 1. Unassign tasks
    if (unassignTasks) {
        const tasks = await getSprintTasks(sprintId);
        const batch = db.batch();
        tasks.forEach(t => {
            const ref = db.collection('backlog_items').doc(t.id);
            batch.update(ref, { sprintId: null });
        });
        await batch.commit();
    }

    // 2. Delete Sprint Doc
    await db.collection('sprints').doc(sprintId).delete();
    return { status: 'deleted', sprintId };
}

// Get tasks for a specific Sprint
export async function getSprintTasks(sprintId) {
    if (!sprintId) return [];

    const snap = await db.collection('backlog_items')
        .where('sprintId', '==', sprintId)
        .orderBy('order', 'asc') // Changed to support manual reordering
        .get();

    return snap.docs.map(d => serialize({ ...d.data(), id: d.id }));
}
