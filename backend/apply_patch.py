import os

file_path = "services/dab_ingestion.py"

with open(file_path, "r", encoding="utf-8") as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # 置換 1: fetch_github_release_atom
    if line.startswith("def fetch_github_release_atom("):
        new_func = """def fetch_github_release_atom(repo: str, expert_name: str, expert_id: str) -> List[Dict[str, Any]]:
    \"\"\"特定のGitHubリポジトリのReleases（Atomフィード）またはユーザー公開フィードから最新情報を取得してパースする\"\"\"
    is_user_feed = '/' not in repo
    if is_user_feed:
        url = f"https://github.com/{repo}.atom"
        print(f"有識者 {expert_name} の GitHub 公開アクティビティフィードを取得中: {url}")
    else:
        url = f"https://github.com/{repo}/releases.atom"
        print(f"有識者/リポジトリ {expert_name} の GitHub Releases を取得中: {url}")
    
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
        feed_type = "公開フィード" if is_user_feed else "Releases"
        print(f"GitHub {feed_type}取得エラー ({repo}): {e}")
        return []

"""
        new_lines.append(new_func)
        # 次の DEFAULT_FILTER_PROMPT までスキップ
        while i < len(lines) and not lines[i].startswith("DEFAULT_FILTER_PROMPT ="):
            i += 1
        continue
        
    # 置換 2: run_ingestion_pipeline
    if line.startswith("async def run_ingestion_pipeline("):
        new_pipeline = """async def run_ingestion_pipeline():
    \"\"\"情報収集インジェクションのメインバッチ処理\"\"\"
    print("=== DAB 情報収集パイプライン開始 ===")
    db = get_db()
    
    # 1. 現在のアクティブトピック（10選）を取得
    topics_docs = db.collection("dab_hot_topics").where("status", "==", "ACTIVE").get()
    active_topics = [doc.to_dict() for doc in topics_docs]
    
    if not active_topics:
        print("アクティブなホットトピックが見つかりません。バッチを終了します。")
        return
        
    # 1.5 有識者の発信情報を収集 (最優先で収集し、高速化)
    print("\\n有識者の発信情報を収集開始...")
    expert_articles = []
    try:
        experts_docs = db.collection("dab_experts").get()
        for doc in experts_docs:
            expert = doc.to_dict()
            expert_id = expert.get("id")
            expert_name = expert.get("name")
            accounts = expert.get("accounts", {})
            
            # Zennユーザーフィード
            if accounts.get("zenn"):
                z_arts = fetch_zenn_user_rss(accounts["zenn"], expert_name, expert_id)
                expert_articles.extend(z_arts)
                
            # GitHubリリース / アクティビティ
            if accounts.get("github"):
                g_arts = fetch_github_release_atom(accounts["github"], expert_name, expert_id)
                expert_articles.extend(g_arts)
    except Exception as exp_err:
        print(f"有識者の情報収集エラー: {exp_err}")
        
    # 2. Zenn RSSから新着記事を取得してノイズ除去 (重複なし記事のみ並行でAI判定)
    raw_zenn_articles = fetch_zenn_rss()
    zenn_articles = []
    
    candidate_zenn_articles = []
    for art in raw_zenn_articles:
        url_hash = hashlib.md5(art["url"].encode('utf-8')).hexdigest()
        if not db.collection("dab_feeds").document(url_hash).get().exists:
            candidate_zenn_articles.append(art)
            
    if candidate_zenn_articles:
        print(f"\\nZenn新規候補 {len(candidate_zenn_articles)} 件をAIフィルタリング判定中(並行処理)...")
        tasks = [filter_article_by_ai(art["title"], art["url"]) for art in candidate_zenn_articles]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for art, is_relevant in zip(candidate_zenn_articles, results):
            if isinstance(is_relevant, Exception):
                print(f"  AI判定エラー ({art['title']}): {is_relevant}")
                continue
            if is_relevant:
                zenn_articles.append(art)
    
    # 3. 各アクティブトピックについて Gemini Web Search で最新技術情報を3件ずつ収集 (並行処理)
    web_articles = []
    if active_topics:
        print(f"\\nアクティブトピック {len(active_topics)} 件についてWeb検索トレンドを収集中(並行処理)...")
        web_tasks = [fetch_web_trends_via_gemini(topic["name"]) for topic in active_topics]
        web_results = await asyncio.gather(*web_tasks, return_exceptions=True)
        for topic, topic_articles in zip(active_topics, web_results):
            if isinstance(topic_articles, Exception):
                print(f"  Web検索エラー ({topic['name']}): {topic_articles}")
                continue
            web_articles.extend(topic_articles)
        
    # 有識者記事を先頭にマージし、最速で画面に表示させる
    all_raw_articles = expert_articles + zenn_articles + web_articles
    print(f"\\n合計 {len(all_raw_articles)} 件のフィルタ適用済み記事候補が集まりました。")
    
    # 4. 重複排除とフィルタリング保存
    feed_ref = db.collection("dab_feeds")
    processed_count = 0
    
    for article in all_raw_articles:
        # URLのハッシュ値をドキュメントIDとして使用（重複保存を防止）
        url_hash = hashlib.md5(article["url"].encode('utf-8')).hexdigest()
        
        # 既にFirestoreに存在するかチェック
        doc_ref = feed_ref.document(url_hash)
        if doc_ref.get().exists:
            continue
            
        print(f"\\n新着記事を処理中: {article['title']}")
        
        try:
            # 一次的に関連度を測るため、またはサマリを作るための下地
            brief = article.get("brief_summary", "")
            
            # コンサル向け構造化メタデータ（サマリ、おすすめ理由、優先度スコア）の一括生成
            meta = await generate_article_metadata(article["title"], article["url"], brief, active_topics)
            summary = meta["summary"]
            recommendation_reason = meta["recommendation_reason"]
            priority_score = article.get("priority_score", meta["priority_score"])
            
            # 記事をアクティブなホットトピックにマッピング
            mapped_topic_ids = await map_article_to_topics(article["title"], summary, active_topics)
            
            # Zenn記事でどれにもマッピングされなかった場合は、ノイズとしてスキップ（ただし有識者投稿は除く）
            is_zenn_source = "Zenn" in article["source"]
            is_expert = bool(article.get("expert_id"))
            if not mapped_topic_ids and is_zenn_source and not is_expert:
                print("  -> 現在のホットトピックに関連しないため、ノイズとしてスキップします。")
                continue
                
            # マッピングされたトピック名を収集
            topic_names = []
            for t_id in mapped_topic_ids:
                for t in active_topics:
                    if t["id"] == t_id:
                        topic_names.append(t["name"])
                        break
            
            # Firestoreへ保存
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
                "author": article.get("author") or meta.get("author") or "不明",
                "read_time": meta.get("read_time", "5分"),
                "target_level": meta.get("target_level", "コンサル向け"),
                "benefit": meta.get("benefit", "最新トレンド理解"),
                "mermaid_code": meta.get("mermaid_code", ""),
                "image_url": meta.get("image_url"),
                "expert_id": article.get("expert_id") # 有識者ID
            }
            
            doc_ref.set(feed_data)
            print(f"  -> Firestoreに保存完了！ (関連トピック: {', '.join(topic_names)}) (優先度: {priority_score})")
            processed_count += 1
            
            # APIレート制限への配慮（適度にウェイトを置く）
            await asyncio.sleep(1)
            
        except Exception as item_err:
            print(f"  -> 記事の処理・保存中にエラーが発生しました: {item_err}")
            continue
        
    print(f"=== DAB 情報収集パイプライン終了 (新規処理件数: {processed_count} 件) ===")

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_ingestion_pipeline())
"""
        new_lines.append(new_pipeline)
        break # 終わりまで挿入したのでループ終了
        
    new_lines.append(line)
    i += 1

with open(file_path, "w", encoding="utf-8") as f:
    f.writelines(new_lines)

print("Patch applied successfully!")
