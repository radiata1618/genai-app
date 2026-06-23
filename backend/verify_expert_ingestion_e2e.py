import os
import sys
import asyncio
import hashlib
from datetime import datetime, timezone
from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import get_db
from services.dab_ingestion import (
    fetch_zenn_user_rss, 
    fetch_github_release_atom,
    generate_article_metadata,
    map_article_to_topics
)

async def test_expert_e2e():
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')
    if os.path.exists(env_path):
        load_dotenv(env_path)
    
    db = get_db()
    
    topics_docs = db.collection("dab_hot_topics").where("status", "==", "ACTIVE").get()
    active_topics = [doc.to_dict() for doc in topics_docs]
    print(f"Active topics count: {len(active_topics)}")
    
    print("\n--- Fetching articles for Expert 'Kazushi' ---")
    articles = fetch_zenn_user_rss("kazushi6", "Kazushi", "kazushi")
    print(f"Fetched {len(articles)} articles")
    
    if not articles:
        print("No articles fetched. Cannot proceed.")
        return
        
    article = articles[0]
    print(f"\nProcessing article: {article['title']}")
    
    url_hash = hashlib.md5(article["url"].encode('utf-8')).hexdigest()
    print(f"URL Hash (Document ID): {url_hash}")
    
    feed_ref = db.collection("dab_feeds")
    
    print("Generating metadata via Gemini...")
    try:
        meta = await generate_article_metadata(article["title"], article["url"], "", active_topics)
        print("Metadata generated successfully:")
        print(f"  Summary: {meta.get('summary')[:50]}...")
        print(f"  Priority: {meta.get('priority_score')}")
    except Exception as e:
        print(f"Error during metadata generation: {e}")
        import traceback
        traceback.print_exc()
        return
        
    print("Mapping to topics...")
    try:
        mapped_topic_ids = await map_article_to_topics(article["title"], meta["summary"], active_topics)
        print(f"Mapped topic IDs: {mapped_topic_ids}")
    except Exception as e:
        print(f"Error during topic mapping: {e}")
        return
        
    topic_names = []
    for t_id in mapped_topic_ids:
        for t in active_topics:
            if t["id"] == t_id:
                topic_names.append(t["name"])
                break
                
    feed_data = {
        "id": url_hash,
        "title": article["title"],
        "url": article["url"],
        "source": article["source"],
        "published_at": article["published_at"],
        "summary": meta["summary"],
        "recommendation_reason": meta["recommendation_reason"],
        "priority_score": meta.get("priority_score", 3),
        "read_status": "UNREAD",
        "user_evaluations": None,
        "related_topics": topic_names,
        "created_at": datetime.now(timezone.utc),
        "author": article.get("author") or meta.get("author") or "不明",
        "read_time": meta.get("read_time", "5分"),
        "target_level": meta.get("target_level", "コンサル向け"),
        "benefit": meta.get("benefit", "最新トレンド理解"),
        "mermaid_code": meta.get("mermaid_code", ""),
        "image_url": meta.get("image_url"),
        "expert_id": article.get("expert_id")
    }
    
    print("Saving to Firestore...")
    try:
        feed_ref.document(url_hash).set(feed_data)
        print("Successfully saved to Firestore!")
    except Exception as e:
        print(f"Error saving to Firestore: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_expert_e2e())
