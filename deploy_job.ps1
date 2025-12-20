# Configuration
$PROJECT_ID = gcloud config get-value project
$REGION = "asia-northeast1" # Adjust as needed
$JOB_NAME = "ingestion-worker"
$IMAGE_NAME = "gcr.io/$PROJECT_ID/genai-app-backend"

Write-Host "Deploying Cloud Run Job: $JOB_NAME"

# Update the Job
gcloud run jobs deploy $JOB_NAME `
    --image $IMAGE_NAME `
    --region $REGION `
    --command "python" `
    --args="-m,jobs.ingest" `
    --memory 2Gi `
    --cpu 1 `
    --task-timeout 3600s `
    --max-retries 0 `
    --set-env-vars "PROJECT_ID=$PROJECT_ID,LOCATION=$REGION,GCS_BUCKET_NAME_FOR_CONSUL_DOC=documents-for-consulting-work"

Write-Host "Job deployed."
Read-Host "Press Enter to exit..."
