import os
import sys
import asyncio
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.dab_ingestion import fetch_zenn_user_rss, fetch_github_release_atom

async def test_fetches():
    print("=== Testing Corrected Expert RSS/Atom Fetches ===")
    
    # 1. Zenn: kazushi6
    print("\n--- Testing Zenn (kazushi6) ---")
    zenn_articles = fetch_zenn_user_rss("kazushi6", "Kazushi", "kazushi")
    print(f"Result count: {len(zenn_articles)}")
    for art in zenn_articles[:3]:
        print(f"Title: {art['title']}")
        print(f"URL: {art['url']}")
        print(f"Published At: {art['published_at']}")
        print(f"Source: {art['source']}")
        
    # 2. GitHub User (No slash): chiphuyen
    print("\n--- Testing GitHub User Feed (chiphuyen) ---")
    github_user_articles = fetch_github_release_atom("chiphuyen", "Chip Huyen", "chip_huyen")
    print(f"Result count: {len(github_user_articles)}")
    for art in github_user_articles[:3]:
        print(f"Title: {art['title']}")
        print(f"URL: {art['url']}")
        print(f"Published At: {art['published_at']}")
        print(f"Source: {art['source']}")

    # 3. GitHub Repo (With slash): dbt-labs/dbt-core
    print("\n--- Testing GitHub Repo Releases (dbt-labs/dbt-core) ---")
    github_repo_articles = fetch_github_release_atom("dbt-labs/dbt-core", "dbt Core", "dbt_core")
    print(f"Result count: {len(github_repo_articles)}")
    for art in github_repo_articles[:3]:
        print(f"Title: {art['title']}")
        print(f"URL: {art['url']}")
        print(f"Published At: {art['published_at']}")
        print(f"Source: {art['source']}")

if __name__ == "__main__":
    asyncio.run(test_fetches())
