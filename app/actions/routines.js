'use server';

import { db } from '../lib/firebase';
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

export async function getRoutines(type = null) {
    let query = db.collection('routines');
    if (type) {
        query = query.where('routine_type', '==', type);
    }
    const snap = await query.get();

    return snap.docs.map(d => {
        const data = d.data();
        return serialize({
            ...data,
            id: d.id,
            // Defaults
            frequency: data.frequency || { type: 'DAILY', weekdays: [], month_days: [], months: [], yearly_dates: [] },
            scheduled_time: data.scheduled_time || "05:00"
        });
    });
}

export async function addRoutine(data) {
    // data: { title, routine_type, frequency, icon, scheduled_time, is_highlighted, goal_config }
    const docRef = db.collection('routines').doc();
    const now = getNowJST();

    const payload = {
        id: docRef.id,
        created_at: now,
        title: data.title,
        routine_type: data.routine_type,
        frequency: data.frequency || { type: 'DAILY', weekdays: [], month_days: [], months: [], yearly_dates: [] },
        icon: data.icon || null,
        scheduled_time: data.scheduled_time || "05:00",
        is_highlighted: data.is_highlighted || false,
        goal_config: data.goal_config || null
    };

    if (data.goal_config) {
        payload.stats = {
            weekly_count: 0,
            monthly_count: 0,
            last_updated: now
        };
    }

    await docRef.set(payload);
    return serialize(payload);
}

async function syncRoutineToDaily(sourceId, title) {
    try {
        const todayStr = getTodayJST();
        const snap = await db.collection('daily_tasks')
            .where('source_id', '==', sourceId)
            .where('source_type', '==', 'ROUTINE')
            .where('target_date', '>=', todayStr)
            .get();

        if (snap.empty) return;

        const batch = db.batch();
        snap.docs.forEach(doc => {
            batch.update(doc.ref, { title: title });
        });
        await batch.commit();
    } catch (e) {
        console.error("Sync Error:", e);
    }
}

export async function updateRoutine(id, data) {
    const docRef = db.collection('routines').doc(id);
    const snap = await docRef.get();
    if (!snap.exists) throw new Error("Routine not found");

    const currentData = snap.data();
    const updates = { ...data };

    delete updates.id;
    delete updates.created_at;

    // Preserve stats if not explicitly touched/reset needed logic handled elsewhere?
    // Actually if goal_config changes we might want to reset stats? 
    // Python logic: if goal_config passed, preserve existing stats or init new.
    if (updates.goal_config) {
        if (!currentData.stats) {
            updates.stats = {
                weekly_count: 0,
                monthly_count: 0,
                last_updated: getNowJST()
            };
        }
    }

    await docRef.update(updates);

    if (data.title && data.title !== currentData.title) {
        await syncRoutineToDaily(id, data.title);
    }

    return serialize({ ...currentData, ...updates, id });
}

export async function deleteRoutine(id) {
    await db.collection('routines').doc(id).delete();
    return { status: 'deleted', id };
}

export async function reorderRoutines(ids) {
    const batch = db.batch();
    ids.forEach((id, index) => {
        const ref = db.collection('routines').doc(id);
        batch.update(ref, { order: index });
    });
    await batch.commit();
    return { status: 'reordered', count: ids.length };
}
