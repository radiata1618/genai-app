import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Note: Ensure firebase-admin is installed: npm install firebase-admin
// This file assumes key.json is in the project root.

const serviceAccount = require('../../key.json');

if (!getApps().length) {
    initializeApp({
        credential: cert(serviceAccount)
    });
}

const db = getFirestore();
try {
    db.settings({ ignoreUndefinedProperties: true });
} catch (e) {
    // Ignore "already initialized" error in dev mode
}

export { db };
