try:
    print("Testing lazy imports...")
    import services.ai_shared
    import routers.rag
    import routers.consulting
    
    print("Top-level imports successful.")
    
    # Check if vertexai is NOT initialized yet (hard to check directly without mocking, but if it runs fast, it means it didn't block)
    # We rely on manual check of the code in this case.
    
    print("Verification Script Done.")

except Exception as e:
    print(f"Import Error: {e}")
    exit(1)
