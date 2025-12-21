'use server';

import { db } from '../lib/firebase';

import { normalizeDateStr, getTodayJST, getNowJST } from '../utils/date';

export async function getDailyTasks(dateStr) {
    dateStr = normalizeDateStr(dateStr);

    const tasksSnap = await db.collection('daily_tasks')
        .where('target_date', '==', dateStr)
        .get();

    const tasks = tasksSnap.docs.map(doc => doc.data());

    // Routine Injection Logic
    const routineIds = new Set();
    const rawTasks = [];
    const nowJST = getNowJST();
    const currentHourStr = String(nowJST.getHours()).padStart(2, '0') + ':' + String(nowJST.getMinutes()).padStart(2, '0');

    const isToday = dateStr === getTodayJST();

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

export async function addQuickTask(title, dateStr) {
    if (!title) throw new Error("Title required");
    dateStr = normalizeDateStr(dateStr);

    const backlogRef = db.collection('backlog_items').doc();
    const backlogId = backlogRef.id;
    const now = new Date(); // Created At uses Server Time (UTC) strictly speaking, but for display it's fine.

    // Scheduled Date: Treat input dateStr as JST date.
    // We want 00:00:00 JST on that day.
    // If we use new Date(dateStr) in UTC environment, it might be 00:00 UTC = 09:00 JST same day.
    // Or if dateStr is YYYY-MM-DD, new Date() treats as UTC 00:00.
    // Let's rely on string storage or simple Date object.
    // Ideally we store Timestamp. 
    // Let's create a Date object that corresponds to 00:00 JST of dateStr.
    // dateStr = "2024-12-22"
    // We want a timestamp that is 2024-12-21 15:00:00 UTC (which is 12/22 00:00 JST).

    // Robust way:
    // 1. Create date from string (UTC midnight)
    // 2. Subtract 9 hours to get JST Midnight in UTC terms? No.
    //    If new Date("2024-12-22") -> 2024-12-22 00:00:00 UTC.
    //    In JST this is 2024-12-22 09:00:00 JST.
    //    We want 2024-12-22 00:00:00 JST -> 2024-12-21 15:00:00 UTC.
    //    So we subtract 9 hours from the UTC Midnight object.
    const utcMidnight = new Date(dateStr);
    const scheduledDate = new Date(utcMidnight.getTime() - 9 * 60 * 60 * 1000);

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
    // Logic: If dateStr <= todayJST, then create it.
    // But honestly for "Quick Add", checking date is often annoying due to timezone.
    // User SAID "Add for Today" (usually).
    // If they explicitly picked a date in UI, dateStr is that date.
    // If they just typed in bottom bar, dateStr is todayJST.
    // The safest UX is: Always create the daily task for the requested dateStr.
    // (Unless it's way in the future? But even then, why not?)
    // Let's trust the user input dateStr.

    const dailyId = `${backlogId}_${dateStr}`;
    const dailyRef = db.collection('daily_tasks').doc(dailyId);

    // Calculate max order in memory to avoid "Missing Index" error and reduce index cost
    const dailyTasksSnap = await db.collection('daily_tasks')
        .where('target_date', '==', dateStr)
        .get();

    let maxOrder = 0;
    if (!dailyTasksSnap.empty) {
        // In-memory max calculation
        dailyTasksSnap.docs.forEach(doc => {
            const d = doc.data();
            if (d.order && d.order > maxOrder) {
                maxOrder = d.order;
            }
        });
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

    await batch.commit();
    return { status: 'created', id: backlogId };
}
