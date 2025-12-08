# Cloud Run Proxy Start Script
# This script establishes a secure tunnel to your Cloud Run application.
# It acts like a local server, allowing you to access the app despite the "Authentication Required" setting.

Write-Host "Starting Cloud Run Proxy..." -ForegroundColor Cyan
Write-Host "Access your app at: http://localhost:8080" -ForegroundColor Green
Write-Host "Press Ctrl + C to stop." -ForegroundColor Yellow

# Execute the proxy command
gcloud run services proxy genai-app-frontend `
    --port=8080 `
    --region=us-central1 `
    --project=trial-project-ushikoshi

# Keep window open if run via double-click (optional, usually proxy creates a blocking process)
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error occurred. Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
