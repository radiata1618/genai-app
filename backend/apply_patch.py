import os

file_path = "services/dab_ingestion.py"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # 1. fetch_github_release_atom
    if line.startswith("def fetch_github_release_atom("):
        new_func = """def fetch_github_release_atom(repo: str, expert_name: str, expert_id: str) -> List[Dict[str, Any]]:
    \"\"\"Fetch GitHub releases or user public atom feed depending on repo value\"\"\"
    is_user_feed = '/' not in repo
    if is_user_feed:
        url = f"https://github.com/{repo}.atom"
        print(f"Fetching GitHub public feed for expert {expert_name}: {url}")
    else:
        url = f"https://github.com/{repo}/releases.atom"
        print(f"Fetching GitHub Releases for {expert_name}: {url}")
    
    req = urllib.request.Request(
        url, 
        headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            xml_data = response.read()
            
        root = ET.fromstring(xml_data)
        ns = {'atom': 'http://www.w3.org/2005/Atom'}
        
        articles = []
        for entry in root.findall('atom:entry', ns):
            title_el = entry.find('atom:title', ns)
            link_el = entry.find('atom:link', ns)
            updated_el = entry.find('atom:updated', ns)
            
            title = title_el.text if title_el is not None else ("New Activity" if is_user_feed else "New Release")
            url = link_el.attrib.get('href') if link_el is not None else ""
            updated_str = updated_el.text if updated_el is not None else ""
            
            pub_date = None
            if updated_str:
                try:
                    pub_date = datetime.fromisoformat(updated_str.replace('Z', '+00:00'))
                except Exception:
                    pub_date = datetime.now(timezone.utc)
            else:
                pub_date = datetime.now(timezone.utc)
                
            if url:
                articles.append({
                    "title": f"[{repo}] {title}" if not is_user_feed else title,
                    "url": url,
                    "published_at": pub_date,
                    "source": f"GitHub ({expert_name})",
                    "expert_id": expert_id
                })
        return articles
    except Exception as e:
        feed_type = "public_feed" if is_user_feed else "releases"
        print(f"GitHub {feed_type} fetch error ({repo}): {e}")
        return []

"""
        new_lines.append(new_func)
        # Skip to DEFAULT_FILTER_PROMPT
        while i < len(lines) and not lines[i].startswith("DEFAULT_FILTER_PROMPT ="):
            i += 1
        continue
        
    # 2. run_ingestion_pipeline
    if line.startswith("async def run_ingestion_pipeline("):
        new_pipeline = """async def run_ingestion_pipeline():
    \"\"\"Main batch process for DAB ingestion\"\"\"
    print("=== DAB Ingestion Pipeline Start ===")
    db = get_db()
    
    # 1. Get active topics (10 selected)
    topics_docs = db.collection("dab_hot_topics").where("status", "==", "ACTIVE").get()
    active_topics = [doc.to_dict() for doc in topics_docs]
    
    if not active_topics:
        print("Active hot topics not found. Exiting batch.")
        return
        
    # 1.5 Collect expert articles (Priority & Speedup)
    print("\\nStarting expert articles collection...")
    expert_articles = []
    try:
        experts_docs = db.collection("dab_experts").get()
        for doc in experts_docs:
            expert = doc.to_dict()
            expert_id = expert.get("id")
            expert_name = expert.get("name")
            accounts = expert.get("accounts", {})
            
            # Zenn User Feed
            if accounts.get("zenn"):
                z_arts = fetch_zenn_user_rss(accounts["zenn"], expert_name, expert_id)
                expert_articles.extend(z_arts)
                
            # GitHub Releases / Activity
            if accounts.get("github"):
                g_arts = fetch_github_release_atom(accounts["github"], expert_name, expert_id)
                expert_articles.extend(g_arts)
    except Exception as exp_err:
        print(f"Expert articles collection error: {exp_err}")
        
    # 2. Fetch fresh Zenn RSS articles and filter out noise (Parallel AI filtering)
    raw_zenn_articles = fetch_zenn_rss()
    zenn_articles = []
    
    candidate_zenn_articles = []
    for art in raw_zenn_articles:
        url_hash = hashlib.md5(art["url"].encode('utf-8')).hexdigest()
        if not db.collection("dab_feeds").document(url_hash).get().exists:
            candidate_zenn_articles.append(art)
            
    if candidate_zenn_articles:
        print(f"\\nFiltering {len(candidate_zenn_articles)} candidate Zenn articles via AI (Parallel)...")
        tasks = [filter_article_by_ai(art["title"], art["url"]) for art in candidate_zenn_articles]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for art, is_relevant in zip(candidate_zenn_articles, results):
            if isinstance(is_relevant, Exception):
                print(f"  AI filtering error ({art['title']}): {is_relevant}")
                continue
            if is_relevant:
                zenn_articles.append(art)
    
    # 3. Collect 3 search trends for each active topic via Gemini Web Search (Parallel)
    web_articles = []
    if active_topics:
        print(f"\\nCollecting web search trends for {len(active_topics)} active topics (Parallel)...")
        web_tasks = [fetch_web_trends_via_gemini(topic["name"]) for topic in active_topics]
        web_results = await asyncio.gather(*web_tasks, return_exceptions=True)
        for topic, topic_articles in zip(active_topics, web_results):
            if isinstance(topic_articles, Exception):
                print(f"  Web search error ({topic['name']}): {topic_articles}")
                continue
            web_articles.extend(topic_articles)
        
    # Merge expert articles at the beginning to display them immediately on UI
    all_raw_articles = expert_articles + zenn_articles + web_articles
    print(f"\\nTotal {len(all_raw_articles)} filter-applied candidate articles gathered.")
    
    # 4. Save to Firestore
    feed_ref = db.collection("dab_feeds")
    processed_count = 0
    
    for article in all_raw_articles:
        url_hash = hashlib.md5(article["url"].encode('utf-8')).hexdigest()
        
        doc_ref = feed_ref.document(url_hash)
        if doc_ref.get().exists:
            continue
            
        print(f"\\nProcessing new article: {article['title']}")
        
        try:
            brief = article.get("brief_summary", "")
            
            # Generate metadata
            meta = await generate_article_metadata(article["title"], article["url"], brief, active_topics)
            summary = meta["summary"]
            recommendation_reason = meta["recommendation_reason"]
            priority_score = article.get("priority_score", meta["priority_score"])
            
            # Map to topics
            mapped_topic_ids = await map_article_to_topics(article["title"], summary, active_topics)
            
            # Skip noise (Zenn source without mapping and not expert)
            is_zenn_source = "Zenn" in article["source"]
            is_expert = bool(article.get("expert_id"))
            if not mapped_topic_ids and is_zenn_source and not is_expert:
                print("  -> Skipped as noise (not related to active hot topics).")
                continue
                
            topic_names = []
            for t_id in mapped_topic_ids:
                for t in active_topics:
                    if t["id"] == t_id:
                        topic_names.append(t["name"])
                        break
            
            # Save to Firestore
            feed_data = {
                "id": url_hash,
                "title": article["title"],
                "url": article["url"],
                "source": article["source"],
                "published_at": article["published_at"],
                "summary": summary,
                "recommendation_reason": recommendation_reason,
                "priority_score": priority_score,
                "read_status": "UNREAD",
                "user_evaluations": None,
                "related_topics": topic_names,
                "created_at": datetime.now(timezone.utc),
                "author": article.get("author") or meta.get("author") or "Unknown",
                "read_time": meta.get("read_time", "5m"),
                "target_level": meta.get("target_level", "Consultant"),
                "benefit": meta.get("benefit", "Latest trend understanding"),
                "mermaid_code": meta.get("mermaid_code", ""),
                "image_url": meta.get("image_url"),
                "expert_id": article.get("expert_id")
            }
            
            doc_ref.set(feed_data)
            print(f"  -> Saved to Firestore successfully! (Topics: {', '.join(topic_names)}) (Priority: {priority_score})")
            processed_count += 1
            
            # Wait for API rate limit
            await asyncio.sleep(1)
            
        except Exception as item_err:
            print(f"  -> Error occurred during processing: {item_err}")
            continue
        
    print(f"=== DAB Ingestion Pipeline Finished (Processed: {processed_count} items) ===")

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_ingestion_pipeline())
"""
        new_lines.append(new_pipeline)
        break
        
    new_lines.append(line)
    i += 1

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(new_lines)

print("Patch applied successfully!")
