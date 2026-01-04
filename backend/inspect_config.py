from google.genai import types
import inspect

try:
    print("Inspecting LiveConnectConfig...")
    signature = inspect.signature(types.LiveConnectConfig)
    print(f"Signature: {signature}")
    
    # Check if session_resumption is in the parameters
    params = signature.parameters.keys()
    print(f"Parameters: {list(params)}")
    
    if 'session_resumption' in params:
        print("SUCCESS: session_resumption is supported.")
    else:
        print("WARNING: session_resumption NOT found in LiveConnectConfig.")

except Exception as e:
    print(f"Error: {e}")
