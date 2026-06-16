const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const API_BASE = `${BASE_URL}/api/dab`;

export const dabApi = {
    // ホットトピック取得
    getTopics: async () => {
        const res = await fetch(`${API_BASE}/topics`);
        if (!res.ok) throw new Error('ホットトピックの取得に失敗しました');
        return res.json();
    },

    // 長期記憶プロファイル取得
    getMemory: async () => {
        const res = await fetch(`${API_BASE}/memory`);
        if (!res.ok) throw new Error('長期記憶情報の取得に失敗しました');
        return res.json();
    },

    // AIチャット壁打ちによるホットトピック編集案の作成
    editTopicsAi: async (message, currentTopics) => {
        const res = await fetch(`${API_BASE}/topics/edit-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, current_topics: currentTopics }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'トピック編集案の生成に失敗しました');
        }
        return res.json();
    },

    // ホットトピック変更の確定コミット
    commitTopics: async (topics) => {
        const res = await fetch(`${API_BASE}/topics/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topics }),
        });
        if (!res.ok) throw new Error('トピック変更の確定に失敗しました');
        return res.json();
    },

    // AIチャット壁打ちによるサマリプロンプト修正案の作成
    editPromptAi: async (message, currentPrompt) => {
        const res = await fetch(`${API_BASE}/prompt/edit-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, current_prompt: currentPrompt }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'プロンプト修正案の生成に失敗しました');
        }
        return res.json();
    },

    // プロンプト変更の確定コミット
    commitPrompt: async (prompt) => {
        const res = await fetch(`${API_BASE}/prompt/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
        });
        if (!res.ok) throw new Error('プロンプトの確定に失敗しました');
        return res.json();
    },

    // AIチャット壁打ちによるフィルタプロンプト修正案の作成
    editFilterPromptAi: async (message, currentPrompt) => {
        const res = await fetch(`${API_BASE}/filter-prompt/edit-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, current_prompt: currentPrompt }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'フィルタプロンプト修正案の生成に失敗しました');
        }
        return res.json();
    },

    // フィルタプロンプト変更の確定コミット
    commitFilterPrompt: async (prompt) => {
        const res = await fetch(`${API_BASE}/filter-prompt/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
        });
        if (!res.ok) throw new Error('フィルタプロンプトの確定に失敗しました');
        return res.json();
    },

    // 構造化記事フィードの取得
    getFeed: async () => {
        const res = await fetch(`${API_BASE}/feed?_t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('フィードの取得に失敗しました');
        return res.json();
    },

    // 記事評価の記録
    evaluateFeedItem: async (feedId, isKnown, isInterested, grainLevel, skipped = false) => {
        const res = await fetch(`${API_BASE}/feed/${feedId}/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                is_known: isKnown,
                is_interested: isInterested,
                grain_level: grainLevel,
                skipped: skipped,
            }),
        });
        if (!res.ok) throw new Error('評価の保存に失敗しました');
        return res.json();
    },

    // 一括スキップ（既読化）
    skipAllFeeds: async (feedIds) => {
        const res = await fetch(`${API_BASE}/feed/skip-all`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                feed_ids: feedIds,
            }),
        });
        if (!res.ok) throw new Error('一括スキップ処理に失敗しました');
        return res.json();
    },

    // 情報収集インジェクションバッチの手動トリガー
    triggerIngest: async () => {
        const res = await fetch(`${API_BASE}/ingest`, {
            method: 'POST',
        });
        if (!res.ok) throw new Error('情報収集バッチのトリガーに失敗しました');
        return res.json();
    },

    // Imagen 3 Fastで記事概念画像を1枚試験生成する（評価専用）
    testImagen: async (title, summary) => {
        const res = await fetch(`${API_BASE}/test-imagen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, summary: summary || '' }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || 'Imagen画像生成に失敗しました');
        }
        return res.json();
    },
};
