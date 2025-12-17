import threading
import importlib
import time
import sys

class BackgroundLoader:
    _instance = None
    
    def __init__(self):
        self._loaded_modules = {}
        self._is_loading = False
    
    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = BackgroundLoader()
        return cls._instance

    def start_loading(self, module_names: list[str]):
        """Starts a background thread to import modules."""
        if self._is_loading:
            return

        def _loader():
            self._is_loading = True
            print(f"[BackgroundLoader] Starting background imports for: {module_names}")
            
            for mod in module_names:
                if mod in sys.modules:
                    print(f"[BackgroundLoader] {mod} already loaded. Skipping.")
                    continue
                    
                try:
                    start = time.time()
                    importlib.import_module(mod)
                    end = time.time()
                    self._loaded_modules[mod] = True
                    print(f"[BackgroundLoader] Successfully imported {mod} in {end - start:.2f}s")
                except Exception as e:
                    print(f"[BackgroundLoader] Failed to import {mod}: {e}")
            
            self._is_loading = False
            print("[BackgroundLoader] Background imports completed.")

        # Daemon thread ensures it doesn't block program exit
        t = threading.Thread(target=_loader, daemon=True)
        t.start()
