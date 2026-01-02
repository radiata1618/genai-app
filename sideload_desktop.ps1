
# Install the official debugging tool globally (or locally if preferred, but global is easier for a quick script)
Write-Host "Installing office-addin-debugging tool..."
npm install -g office-addin-debugging

# Sideload for Desktop (automatically registers the manifest in the registry)
Write-Host "Registering and Sideloading Add-in..."
npx office-addin-debugging start office-addin/manifest.xml desktop --app powerpoint
