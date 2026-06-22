import os
import sys
from google.cloud import firestore

# backendのパスを通す
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))
from database import get_db

def main():
    db = get_db()
    
    # 1. dab_feeds
    feeds = list(db.collection("dab_feeds").stream())
    print(f"dab_feeds count: {len(feeds)}")
    for f in feeds[:5]:
        data = f.to_dict()
        print(f"  - Feed ID: {f.id}, Title: {data.get('title')}, Source: {data.get('source')}, ReadStatus: {data.get('read_status')}")

    # 2. dab_experts
    experts = list(db.collection("dab_experts").stream())
    print(f"dab_experts count: {len(experts)}")
    for e in experts:
        data = e.to_dict()
        print(f"  - Expert ID: {e.id}, Name: {data.get('name')}, Accounts: {data.get('accounts')}")

    # 3. dab_hot_topics
    topics = list(db.collection("dab_hot_topics").stream())
    print(f"dab_hot_topics count: {len(topics)}")

if __name__ == "__main__":
    main()
