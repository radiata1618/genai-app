
const admin = require('firebase-admin');
const serviceAccount = require('./key.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function checkBacklogData() {
    console.log('Checking backlog items...');
    const snap = await db.collection('backlog_items')
        .where('is_archived', '==', false)
        .get();

    console.log(`Total active items: ${snap.size}`);

    let missingStatus = 0;
    let statusCounts = {};

    snap.forEach(doc => {
        const data = doc.data();
        if (!data.status) {
            missingStatus++;
        } else {
            statusCounts[data.status] = (statusCounts[data.status] || 0) + 1;
        }
    });

    console.log('--- Analysis ---');
    console.log(`Items missing 'status' field: ${missingStatus}`);
    console.log('Status breakdown:', statusCounts);
}

checkBacklogData();
