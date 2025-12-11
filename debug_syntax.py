import sys
try:
    from backend.routers import car_quiz
    print("Syntax OK")
except Exception as e:
    print(f"Error: {e}")
