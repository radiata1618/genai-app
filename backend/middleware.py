
import time
import json
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request

class PerformanceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        
        response = await call_next(request)
        
        process_time = time.time() - start_time
        duration_ms = round(process_time * 1000, 2)
        
        # Structure the log entry
        log_entry = {
            "type": "performance_log",
            "path": request.url.path,
            "method": request.method,
            "status_code": response.status_code,
            "duration_ms": duration_ms
        }
        
        # Print as JSON for Cloud Logging to pick up efficiently
        print(json.dumps(log_entry))
        
        response.headers["X-Process-Time"] = str(process_time)
        return response
