const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

const keyPath = path.resolve(process.cwd(), 'key.json');
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

async function checkTasks() {
    console.log("Checking daily_tasks for 2026-01-06...");
    const snap = await db.collection('daily_tasks')
        .where('target_date', '==', '2026-01-06')
        .get();

    console.log(`Found ${snap.size} tasks.`);
    snap.docs.forEach(doc => {
        const data = doc.data();
        console.log(`- [${data.status}] ${data.title} (ID: ${doc.id})`);
    });

    console.log("\nChecking recent backlog_items...");
    const backlogSnap = await db.collection('backlog_items')
        .orderBy('created_at', 'desc')
        .limit(10)
        .get();

    backlogSnap.docs.forEach(doc => {
        const data = doc.data();
        console.log(`- ${data.title} (Status: ${data.status}, Date: ${data.scheduled_date ? data.scheduled_date.toDate().toISOString() : 'N/A'})`);
    });
}

checkTasks().catch(console.error);
