from google.genai import types
import inspect

try:
    print("Inspecting LiveConnectConfig...")
    signature = inspect.signature(types.LiveConnectConfig)
    print(f"Signature: {signature}")
    
    # Check type annotation for session_resumption
    signature = inspect.signature(types.SessionResumptionConfig)
    print(f"SessionResumptionConfig Signature: {signature}")

except Exception as e:
    print(f"Error: {e}")
