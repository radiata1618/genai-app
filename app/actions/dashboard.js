'use server';

import { db } from '../lib/firebase';

export async function getDailyTasks(dateStr) {
    if (!dateStr) {
        dateStr = new Date().toISOString().split('T')[0];
    } else {
        dateStr = dateStr.replace(/\//g, '-');
    }

    const tasksSnap = await db.collection('daily_tasks')
        .where('target_date', '==', dateStr)
        .get();

    const tasks = tasksSnap.docs.map(doc => doc.data());

    // Routine Injection Logic
    const routineIds = new Set();
    const rawTasks = [];
    const now = new Date(); // Server time (UTC usually, but check timezone logic if critical)
    // IMPORTANT: timezone handling. The Python app used JST. 
    // Here we might be in UTC. 
    // For now, simpler comparison.
    const currentHourStr = now.toISOString().split('T')[1].substring(0, 5); // HH:MM

    const isToday = dateStr === now.toISOString().split('T')[0];

    for (const t of tasks) {
        if (!t.title) t.title = "Unknown Task";
        if (t.source_type === 'ROUTINE') {
            routineIds.add(t.source_id);
            // Hide future routines logic (optional, replicating Python)
            // if (isToday && t.scheduled_time && currentHourStr < t.scheduled_time) continue; 
            // actually Python logic hides them if strictly greater? 
            // "if current_time_str < task_scheduled_time: show_task = False"
            // We'll keep it simple and show all for now, or replicate if strict.
        }
        rawTasks.push(t);
    }

    // Fetch Routines
    const routineMap = {};
    if (routineIds.size > 0) {
        const ids = Array.from(routineIds);
        const chunks = [];
        for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));

        for (const chunk of chunks) {
            const q = await db.collection('routines').where('id', 'in', chunk).get();
            q.docs.forEach(d => routineMap[d.id] = d.data());
        }
    }

    // Inject Stats
    const result = rawTasks.map(t => {
        if (t.source_type === 'ROUTINE') {
            const r = routineMap[t.source_id];
            if (r && r.goal_config && r.stats) {
                let current = 0;
                if (r.goal_config.period === 'WEEKLY') current = r.stats.weekly_count || 0;
                if (r.goal_config.period === 'MONTHLY') current = r.stats.monthly_count || 0;
                t.current_goal_progress = `${current}/${r.goal_config.target_count}`;
            }
        }
        return serialize(t);
    });

    return result.sort((a, b) => (a.order || 0) - (b.order || 0));
}

function serialize(obj) {
    if (!obj) return obj;
    const newObj = { ...obj };
    // Convert known Timestamp fields or any object with toDate
    for (const key in newObj) {
        const val = newObj[key];
        if (val && typeof val.toDate === 'function') {
            newObj[key] = val.toDate().toISOString();
        } else if (val instanceof Date) {
            newObj[key] = val.toISOString();
        }
    }
    return newObj;
}

export async function addQuickTask(title, dateStr) {
    if (!title) throw new Error("Title required");
    if (!dateStr) {
        dateStr = new Date().toISOString().split('T')[0];
    } else {
        dateStr = dateStr.replace(/\//g, '-');
    }

    const backlogRef = db.collection('backlog_items').doc();
    const backlogId = backlogRef.id;
    const now = new Date();
    // Use Midnight for dates to match Python logic
    const scheduledDate = new Date(dateStr);
    scheduledDate.setUTCHours(0, 0, 0, 0);

    const backlogItem = {
        id: backlogId,
        title: title,
        category: 'Research',
        priority: 'Medium',
        status: 'STOCK',
        scheduled_date: scheduledDate, // Firestore Timestamp
        created_at: now,
        is_archived: false,
        is_highlighted: false,
        place: null,
        order: 0
    };

    const batch = db.batch();
    batch.set(backlogRef, backlogItem);

    // If scheduled for today (or past), create Daily Task immediately
    // Simple check: compare date strings
    const todayStr = now.toISOString().split('T')[0];
    if (dateStr <= todayStr) {
        const dailyId = `${backlogId}_${dateStr}`;
        const dailyRef = db.collection('daily_tasks').doc(dailyId);

        // Need max order? safe to default 0 or query.
        // For speed, let's just use 999 or query. 
        // Let's query quickly.
        const maxOrderSnap = await db.collection('daily_tasks')
            .where('target_date', '==', dateStr)
            .orderBy('order', 'desc')
            .limit(1)
            .get();
        let maxOrder = 0;
        if (!maxOrderSnap.empty) {
            maxOrder = maxOrderSnap.docs[0].data().order || 0;
        }

        const dailyTask = {
            id: dailyId,
            source_id: backlogId,
            source_type: 'BACKLOG',
            target_date: dateStr,
            status: 'TODO',
            created_at: now, // server time
            title: title,
            order: maxOrder + 1,
            is_highlighted: false
        };
        batch.set(dailyRef, dailyTask);
    }

    await batch.commit();
    return { status: 'created', id: backlogId };
}
