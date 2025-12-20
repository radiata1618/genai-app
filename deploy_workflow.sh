#!/bin/bash

WORKFLOW_NAME="ingestion-workflow"
PROJECT_ID=$(gcloud config get-value project)
REGION="asia-northeast1"
SOURCE="backend/workflows/ingest.yaml"

echo "Deploying Workflow: $WORKFLOW_NAME"

gcloud workflows deploy $WORKFLOW_NAME \
    --source=$SOURCE \
    --location=$REGION \
    --service-account="app-account@${PROJECT_ID}.iam.gserviceaccount.com" \
    --set-env-vars GCP_PROJECT_ID=$PROJECT_ID \
    --description="Orchestrates batch ingestion using Cloud Run Jobs"

echo "Deploy complete. Trigger via Console or: gcloud workflows run $WORKFLOW_NAME --location=$REGION"
