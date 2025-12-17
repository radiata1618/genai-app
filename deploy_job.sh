#!/bin/bash

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="asia-northeast1" # Adjust as needed
JOB_NAME="ingestion-worker"
IMAGE_NAME="gcr.io/$PROJECT_ID/genai-app-backend" # Assuming we use the same image as backend

echo "Deploying Cloud Run Job: $JOB_NAME"

# 1. Update the Job (or create if not exists)
# We override the entrypoint to run our python script
gcloud run jobs deploy $JOB_NAME \
    --image $IMAGE_NAME \
    --region $REGION \
    --command "python" \
    --args "-m,backend.jobs.ingest" \
    --memory 2Gi \
    --cpu 1 \
    --task-timeout 3600s \
    --max-retries 0 \
    --set-env-vars PROJECT_ID=$PROJECT_ID,LOCATION=$REGION,GCS_BUCKET_NAME_FOR_CONSUL_DOC="your-bucket-name"

echo "Job deployed. Trigger via API or: gcloud run jobs execute $JOB_NAME --args='--batch_id=TEST_ID'"
