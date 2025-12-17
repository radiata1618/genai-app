from database import get_db, get_storage_client
import sys

try:
    print("Testing DB Singleton...")
    db1 = get_db()
    db2 = get_db()
    
    if db1 is db2:
        print("PASS: DB client is a singleton")
    else:
        print("FAIL: DB client is NOT a singleton")
        sys.exit(1)

    print("Testing Storage Singleton...")
    s1 = get_storage_client()
    s2 = get_storage_client()
    
    if s1 is s2:
        print("PASS: Storage client is a singleton")
    else:
        print("FAIL: Storage client is NOT a singleton")
        sys.exit(1)
        
    print("Verification Complete.")
    
except Exception as e:
    print(f"Error during verification: {e}")
    sys.exit(1)
