import os
import sys
import asyncio
from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import get_db
from services.dab_ingestion import (
    fetch_qiita_rss,
    fetch_note_rss,
    fetch_website_updates,
    generate_article_metadata,
    map_article_to_topics
)

async def test_extended_experts():
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.local')
    if os.path.exists(env_path):
        load_dotenv(env_path)
        
    db = get_db()
    
    topics_docs = db.collection("dab_hot_topics").where("status", "==", "ACTIVE").get()
    active_topics = [doc.to_dict() for doc in topics_docs]
    print(f"Active topics count: {len(active_topics)}")
    
    # 1. Qiita Test (yuzutas0)
    print("\n--- Test 1: Fetching Qiita RSS for yuzutas0 ---")
    qiita_articles = fetch_qiita_rss("yuzutas0", "yuzutas0 (Qiita Test)", "yuzutas0")
    print(f"Fetched {len(qiita_articles)} Qiita articles.")
    if qiita_articles:
        print(f"Sample Qiita article: {qiita_articles[0]['title']} ({qiita_articles[0]['url']})")
        
    # 2. Note Test (yuzutas0)
    print("\n--- Test 2: Fetching Note RSS for yuzutas0 ---")
    note_articles = fetch_note_rss("yuzutas0", "yuzutas0 (Note Test)", "yuzutas0")
    print(f"Fetched {len(note_articles)} Note articles.")
    if note_articles:
        print(f"Sample Note article: {note_articles[0]['title']} ({note_articles[0]['url']})")
        
    # 3. Web Site Test (OpenDataSpace)
    print("\n--- Test 3: Fetching Web site updates for OpenDataSpace ---")
    web_articles = await fetch_website_updates("https://opendataspace.org", "OpenDataSpace", "opendataspace")
    print(f"Fetched {len(web_articles)} Web articles/updates.")
    if web_articles:
        for idx, art in enumerate(web_articles):
            print(f"  [{idx}] {art['title']} - URL: {art['url']}")
            print(f"      Summary: {art['brief_summary']}")
            
        # Metadata Generation and Mapping Test for the first web article
        target_art = web_articles[0]
        print(f"\n--- Test 4: Generating metadata for OpenDataSpace update: {target_art['title']} ---")
        try:
            meta = await generate_article_metadata(
                target_art["title"], 
                target_art["url"], 
                target_art.get("brief_summary", ""), 
                active_topics
            )
            print("Metadata generated successfully!")
            print(f"  Summary:\n{meta['summary'][:200]}...")
            print(f"  Author: {meta.get('author')}")
            print(f"  Priority: {meta.get('priority_score')}")
            print(f"  Mermaid code exists: {bool(meta.get('mermaid_code'))}")
            
            mapped_topic_ids = await map_article_to_topics(target_art["title"], meta["summary"], active_topics)
            print(f"Mapped topic IDs: {mapped_topic_ids}")
        except Exception as e:
            print(f"Error during metadata generation/mapping: {e}")
    else:
        print("No articles fetched from https://opendataspace.org. Gemini search grounding may have failed or no updates found.")

if __name__ == "__main__":
    asyncio.run(test_extended_experts())
