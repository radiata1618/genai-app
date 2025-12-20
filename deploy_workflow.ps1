$PROJECT_ID = gcloud config get-value project
$WORKFLOW_NAME = "ingestion-workflow"
$REGION = "asia-northeast1"
$SOURCE = "backend/workflows/ingest.yaml"

Write-Host "Deploying Workflow: $WORKFLOW_NAME"

gcloud workflows deploy $WORKFLOW_NAME `
    --source=$SOURCE `
    --location=$REGION `
    --service-account="app-account@${PROJECT_ID}.iam.gserviceaccount.com" `
    --set-env-vars GCP_PROJECT_ID=$PROJECT_ID `
    --description="Orchestrates batch ingestion using Cloud Run Jobs"

Write-Host "Deploy complete."
Read-Host "Press Enter to exit..."
