---
description: Firestore and IAM Setup Guide
---

# Google Cloud Firestore & IAM Setup Guide

Follow these steps to configure your Google Cloud project for the Personal Agile Task Manager.

## 1. Enable APIs
Ensure the Firestore API is enabled in your project.

```bash
gcloud services enable firestore.googleapis.com
```

## 2. Create Firestore Database
1. Go to the [Firestore Console](https://console.cloud.google.com/firestore).
2. Click **"Create Database"**.
3. Select **"Native Mode"** (Recommended for new mobile/web apps).
4. Choose a **Location** (e.g., `asia-northeast1` for Tokyo).
5. Click **"Create"**.

## 3. Configure Service Account (IAM)
The application uses `backend/key.json` to authenticate. You need to ensure the Service Account associated with this key has the correct permissions.

1. Go to [IAM & Admin](https://console.cloud.google.com/iam-admin/iam).
2. Find the Service Account email address present in your `key.json` (look for `client_email` field).
3. Click the **Pencil Icon** (Edit Principal) for that service account.
4. Add the following Role:
   - **`Cloud Datastore User`** (Recommended) - Allows reading and writing data.
   - OR **`Firebase Admin SDK Administrator Service Agent`** (Broad access).

## 4. Verify Connection
Run the verification script or start the backend to test the connection.

```bash
cd backend
python main.py
```
If you see execution logs without "Permission denied" errors, you are all set!
