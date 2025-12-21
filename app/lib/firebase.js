import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Note: Ensure firebase-admin is installed: npm install firebase-admin
// This file assumes key.json is in the project root.

const fs = require('fs');
const path = require('path');

if (!getApps().length) {
    if (process.env.IS_CLOUD_RUN === 'true') {
        initializeApp();
    } else {
        try {
            // ローカル開発環境でのみ key.json を読み込む
            const keyPath = path.resolve(process.cwd(), 'key.json');
            if (fs.existsSync(keyPath)) {
                const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
                initializeApp({
                    credential: cert(serviceAccount)
                });
            } else {
                initializeApp();
            }
        } catch (error) {
            console.warn('Failed to load key.json, falling back to default credentials');
            initializeApp();
        }
    }
}

const db = getFirestore();
try {
    db.settings({ ignoreUndefinedProperties: true });
} catch (e) {
    // Ignore "already initialized" error in dev mode
}

export { db };
