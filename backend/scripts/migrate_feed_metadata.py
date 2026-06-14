import os
import sys
import asyncio
from datetime import datetime, timezone
from typing import List, Dict, Any

# backend ディレクトリをシステムパスに追加
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_db
from services.dab_ingestion import generate_article_metadata, map_article_to_topics

async def migrate_feed_metadata():
    """過去のフィード記事すべてに対して、Geminiを呼び出して不足するメタデータと図解コードを自動補完する"""
    print("=== DAB 過去データ移行マイグレーション開始 ===")
    db = get_db()
    
    # 1. アクティブなホットトピックを取得
    topics_docs = db.collection("dab_hot_topics").where("status", "==", "ACTIVE").get()
    active_topics = [doc.to_dict() for doc in topics_docs]
    
    # 2. 過去のフィードを取得
    feed_docs = db.collection("dab_feeds").get()
    print(f"過去のフィード全 {len(feed_docs)} 件をチェック中...")
    
    updated_count = 0
    for doc in feed_docs:
        data = doc.to_dict()
        feed_id = doc.id
        title = data.get("title", "")
        url = data.get("url", "")
        source = data.get("source", "")
        current_author = data.get("author")
        
        # 移行判定: Mermaidコードが空文字列、または存在しないものを補完対象とする
        has_new_meta = "mermaid_code" in data and data.get("mermaid_code") != "" and data.get("mermaid_code") is not None
        
        if has_new_meta:
            print(f"スキップ (既に更新済み): {title}")
            continue
            
        print(f"\nデータ補完中: {title} ({source})")
        
        # メタデータをAIで一括生成
        meta = await generate_article_metadata(title, url, "", active_topics)
        
        # トピックへの再マッピング (関連トピックが空の場合のみ更新)
        related_topics = data.get("related_topics", [])
        if not related_topics:
            mapped_topic_ids = await map_article_to_topics(title, meta["summary"], active_topics)
            # マッピングされたトピック名を収集
            for t_id in mapped_topic_ids:
                for t in active_topics:
                    if t["id"] == t_id:
                        related_topics.append(t["name"])
                        break
            related_topics = list(set(related_topics))
        
        # 保存するアップデート項目
        update_data = {
            "summary": meta["summary"],
            "recommendation_reason": meta.get("recommendation_reason", data.get("recommendation_reason", "最新の技術動向です。")),
            "priority_score": meta.get("priority_score", 3),
            "author": current_author or meta.get("author") or "不明",
            "read_time": meta.get("read_time", "5分"),
            "target_level": meta.get("target_level", "コンサル向け"),
            "benefit": meta.get("benefit", "最新トレンド理解"),
            "mermaid_code": meta.get("mermaid_code", ""),
            "related_topics": related_topics,
            "updated_at": datetime.now(timezone.utc)
        }
        
        db.collection("dab_feeds").document(feed_id).update(update_data)
        print(f"  -> 更新完了！ (優先度: {update_data['priority_score']}) (読了: {update_data['read_time']}) (レベル: {update_data['target_level']})")
        updated_count += 1
        
        # APIレート制限への配慮
        await asyncio.sleep(2)
        
    print(f"=== DAB 過去データ移行マイグレーション終了 (更新件数: {updated_count} 件) ===")

if __name__ == "__main__":
    asyncio.run(migrate_feed_metadata())
