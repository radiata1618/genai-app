import os
import sys
from dotenv import load_dotenv
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import get_db

env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')
if os.path.exists(env_path):
    load_dotenv(env_path)

db = get_db()
docs = db.collection("dab_experts").get()
print(f"登録有識者数: {len(docs)}")
for doc in docs:
    data = doc.to_dict()
    print(f"ID: {doc.id}")
    print(f"  Name: {data.get('name')}")
    print(f"  Accounts: {data.get('accounts')}")
    print(f"  Topic IDs: {data.get('topic_ids')}")
