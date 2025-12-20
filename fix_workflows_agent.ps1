$PROJECT_ID = gcloud config get-value project

Write-Host "Creating Workflows Service Agent for Project: $PROJECT_ID"

# Force creation of the Workflows service identity
gcloud beta services identity create --service=workflows.googleapis.com --project=$PROJECT_ID

Write-Host "Service Agent created. Please retry deploying the workflow."
Read-Host "Press Enter to exit..."
