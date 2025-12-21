$PROJECT_ID = gcloud config get-value project
$IMAGE_NAME = "gcr.io/$PROJECT_ID/genai-app-backend"

Write-Host "Building and Pushing Docker Image: $IMAGE_NAME"

# Build using Cloud Build
# Note: We assume the backend code is in the 'backend' directory, 
# but the Dockerfile might expect the build context to be the root.
# Checking Dockerfile content in next step if this fails, but usually safest 
# is to submit from root if Dockerfile is in root or backend.

# Build from the 'backend' directory so it uses backend/Dockerfile
gcloud builds submit --tag $IMAGE_NAME backend

Write-Host "Build Complete."
Read-Host "Press Enter to exit..."
