'use server';

import { db } from '../lib/firebase';
import { getISOWeek, getMonth, getYear } from 'date-fns';
import { getTodayJST, getNowJST } from '../utils/date';

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

// --- Sync Helpers ---

async function updateRoutineStats(routineId, isCompleted) {
    try {
        const ref = db.collection('routines').doc(routineId);
        const snap = await ref.get();
        if (!snap.exists) return;

        const data = snap.data();
        const goal = data.goal_config;
        let stats = data.stats;

        if (!goal || !stats) return;

        const now = getNowJST(); // Use JST for stat calculations
        const lastUpdated = stats.last_updated ? stats.last_updated.toDate() : null;

        let needsReset = false;
        if (lastUpdated) {
            if (goal.period === 'WEEKLY') {
                if (getISOWeek(now) !== getISOWeek(lastUpdated) || getYear(now) !== getYear(lastUpdated)) {
                    needsReset = true;
                }
            } else if (goal.period === 'MONTHLY') {
                if (getMonth(now) !== getMonth(lastUpdated) || getYear(now) !== getYear(lastUpdated)) {
                    needsReset = true;
                }
            }
        } else {
            needsReset = true;
        }

        if (needsReset) {
            stats = {
                weekly_count: 0,
                monthly_count: 0,
                last_updated: now
            };
        }

        if (isCompleted) {
            if (goal.period === 'WEEKLY') stats.weekly_count = (stats.weekly_count || 0) + 1;
            if (goal.period === 'MONTHLY') stats.monthly_count = (stats.monthly_count || 0) + 1;
        } else {
            if (goal.period === 'WEEKLY') stats.weekly_count = Math.max(0, (stats.weekly_count || 0) - 1);
            if (goal.period === 'MONTHLY') stats.monthly_count = Math.max(0, (stats.monthly_count || 0) - 1);
        }

        stats.last_updated = now;
        await ref.update({ stats });

    } catch (e) {
        console.error("Error updating routine stats:", e);
    }
}

async function updateBacklogStatus(backlogId, isCompleted) {
    try {
        const status = isCompleted ? 'DONE' : 'STOCK';
        await db.collection('backlog_items').doc(backlogId).update({ status });
    } catch (e) {
        console.error("Error updating backlog status:", e);
    }
}

// --- Actions ---

export async function toggleTaskComplete(id, isCompleted) {
    const ref = db.collection('daily_tasks').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Task not found");

    const task = snap.data();

    await ref.update({
        status: isCompleted ? 'DONE' : 'TODO',
        completed_at: isCompleted ? new Date() : null
    });

    // Sync Logic
    if (task.source_type === 'ROUTINE') {
        await updateRoutineStats(task.source_id, isCompleted);
    } else if (task.source_type === 'BACKLOG') {
        await updateBacklogStatus(task.source_id, isCompleted);
    }

    return { status: 'updated', id, isCompleted };
}

export async function skipTask(id) {
    await db.collection('daily_tasks').doc(id).update({ status: 'SKIPPED' });
    return { status: 'skipped', id };
}

export async function highlightTask(id, isHighlighted) {
    const ref = db.collection('daily_tasks').doc(id);
    await ref.update({ is_highlighted: isHighlighted });

    // Sync to backlog if needed
    const snap = await ref.get();
    const task = snap.data();
    if (task.source_type === 'BACKLOG') {
        await db.collection('backlog_items').doc(task.source_id).update({ is_highlighted: isHighlighted });
    }

    return { status: 'highlighted', id, isHighlighted };
}

export async function updateTaskTitle(id, title) {
    const ref = db.collection('daily_tasks').doc(id);
    await ref.update({ title: title });

    // Sync to backlog if needed
    const snap = await ref.get();
    const task = snap.data();
    if (task.source_type === 'BACKLOG') {
        await db.collection('backlog_items').doc(task.source_id).update({ title: title });
    }

    return { status: 'title_updated', id, title };
}

export async function reorderDailyTasks(ids) {
    const batch = db.batch();
    ids.forEach((id, index) => {
        const ref = db.collection('daily_tasks').doc(id);
        batch.update(ref, { order: index });
    });
    await batch.commit();
    return { status: 'reordered', count: ids.length };
}

export async function postponeTask(id, newDateStr) {
    // newDateStr: YYYY-MM-DD or null/empty
    const ref = db.collection('daily_tasks').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error("Task not found");

    const task = snap.data();

    const batch = db.batch();

    // If newDateStr is empty, we just delete the daily task.
    // The backlog item (source) remains in 'STOCK' status (or we can ensure it).
    if (!newDateStr) {
        batch.delete(ref);

        // SYNC: Update backlog item to remove scheduled_date
        if (task.source_type === 'BACKLOG') {
            const backlogRef = db.collection('backlog_items').doc(task.source_id);
            batch.update(backlogRef, { scheduled_date: null });
        }

        await batch.commit();
        return { status: 'returned_to_backlog', oldId: id };
    }

    // Move logic:
    // 1. Create new ID {sourceId}_{newDate}
    // 2. Create new doc
    // 3. Delete old doc

    const newId = `${task.source_id}_${newDateStr}`;
    const newRef = db.collection('daily_tasks').doc(newId);

    // Check if exists? If exists, maybe just update that one or Merge?
    // If exists, we might overwrite or skip.
    // Let's overwrite ensuring it's TODO.

    const newTask = {
        ...task,
        id: newId,
        target_date: newDateStr,
        status: 'TODO', // Reset status? Usually yes when postponing
        order: 9999 // Push to end
        // created_at? keep original?
    };

    batch.set(newRef, newTask);
    batch.delete(ref);

    // SYNC: Update backlog item with new scheduled_date
    if (task.source_type === 'BACKLOG') {
        const backlogRef = db.collection('backlog_items').doc(task.source_id);
        batch.update(backlogRef, { scheduled_date: new Date(newDateStr) });
    }

    await batch.commit();

    return { status: 'postponed', oldId: id, newId: newId, date: newDateStr };
}

export async function pickFromBacklog(backlogId, dateStr) {
    if (!dateStr) dateStr = getTodayJST();

    const backlogRef = db.collection('backlog_items').doc(backlogId);
    const itemSnap = await backlogRef.get();
    if (!itemSnap.exists) throw new Error("Backlog item not found");
    const item = itemSnap.data();

    const dailyId = `${backlogId}_${dateStr}`;
    const dailyRef = db.collection('daily_tasks').doc(dailyId);
    const dailySnap = await dailyRef.get();

    if (dailySnap.exists) return { status: 'already_picked', id: dailyId };

    // Get max order (Memory Sort to avoid Index requirement)
    const dailyTasksSnap = await db.collection('daily_tasks')
        .where('target_date', '==', dateStr)
        .get();

    let maxOrder = 0;
    if (!dailyTasksSnap.empty) {
        dailyTasksSnap.docs.forEach(doc => {
            const d = doc.data();
            if (d.order && d.order > maxOrder) {
                maxOrder = d.order;
            }
        });
    }

    const newTask = {
        id: dailyId,
        source_id: backlogId,
        source_type: 'BACKLOG',
        target_date: dateStr,
        status: 'TODO',
        created_at: new Date(),
        title: item.title,
        order: maxOrder + 1,
        is_highlighted: item.is_highlighted || false
    };

    await dailyRef.set(newTask);
    return serialize(newTask);
}
