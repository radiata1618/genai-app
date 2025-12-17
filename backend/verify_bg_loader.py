import time
import sys
from services.background_loader import BackgroundLoader

print("Starting Main Thread...")
loader = BackgroundLoader.get_instance()

# Mocking modules to avoid actual heavy imports in test which might take time
# effectively testing the threading mechanism
loader.start_loading(["statistics", "decimal", "math"]) 

print("Main Thread: Startup continuing immediately...")
print("Main Thread: Simulating server handling requests...")

time.sleep(1) # Let background thread work a bit

if "statistics" in sys.modules:
    print("Verification Success: 'statistics' was loaded in background.")
else:
    print("Verification Failed: 'statistics' not loaded yet (or thread failed).")

print("Main Thread: Done.")
