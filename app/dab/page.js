"use client";

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { dabApi } from '../utils/dabApi';
import MobileMenuButton from '../../components/MobileMenuButton';

function DabDashboard() {
    const searchParams = useSearchParams();
    const tabParam = searchParams.get('tab') || 'feed';

    // タブ状態: 'topics' | 'feed' | 'memory' | 'settings'
    const [activeTab, setActiveTab] = useState(tabParam);
    
    // アコーディオン開閉用ステート
    const [expandedTopicId, setExpandedTopicId] = useState(null);
    const [expandedFeedId, setExpandedFeedId] = useState(null);

    // クエリパラメータの変更を監視して activeTab を同期
    useEffect(() => {
        if (tabParam) {
            setActiveTab(tabParam);
        }
    }, [tabParam]);

    // データ状態
    const [topics, setTopics] = useState([]);
    const [memory, setMemory] = useState(null);
    const [feed, setFeed] = useState([]);
    
    // ロード状態
    const [loading, setLoading] = useState(true);
    
    // AI壁打ち関連
    const [chatMode, setChatMode] = useState('topics'); // 'topics' | 'prompt'
    const [chatInput, setChatInput] = useState('');
    const [chatHistory, setChatHistory] = useState([
        { role: 'assistant', content: 'こんにちは！データアーキテクチャの専門家になるための自己学習を支援します。サイドバーで「〇〇を追加して」や「〇〇を削除して」と指示すれば、ホットトピックを再構成できます。プロンプト設定の壁打ちも可能です。' }
    ]);
    const [isAiResponding, setIsAiResponding] = useState(false);
    
    // プレビュー変更点の一時保存
    const [pendingChanges, setPendingChanges] = useState(null); // { assistant_message, changes: [...] }
    const [previewPrompt, setPreviewPrompt] = useState(null); // { assistant_message, proposed_prompt }

    // インジェクションバッチ動作状態
    const [isIngesting, setIsIngesting] = useState(false);

    // 音声再生（SpeechSynthesis）関連
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentPlayingFeedId, setCurrentPlayingFeedId] = useState(null);
    const [utterance, setUtterance] = useState(null);
    const speechRef = useRef(null);

    useEffect(() => {
        fetchInitialData();
    }, []);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [topicsData, memoryData, feedData] = await Promise.all([
                dabApi.getTopics(),
                dabApi.getMemory(),
                dabApi.getFeed().catch(() => []) // フィードがまだ空でもエラーにしない
            ]);
            setTopics(topicsData);
            setMemory(memoryData);
            setFeed(feedData);
        } catch (e) {
            console.error('初期データの取得に失敗しました', e);
        } finally {
            setLoading(false);
        }
    };

    // AIチャット送信
    const handleSendChatMessage = async (e) => {
        e.preventDefault();
        if (!chatInput.trim() || isAiResponding) return;

        const userMsg = chatInput;
        setChatInput('');
        setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsAiResponding(true);

        try {
            if (chatMode === 'topics') {
                // ホットトピックの編集
                // 現在プレビュー中のトピックがあればそれを使う、なければ現在の確定トピックを使う
                const currentListForAi = pendingChanges 
                    ? applyChangesLocal(topics, pendingChanges.changes)
                    : topics;

                const response = await dabApi.editTopicsAi(userMsg, currentListForAi);
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.assistant_message }]);
                
                // プレビュー変更点を保持
                if (response.changes && response.changes.length > 0) {
                    setPendingChanges(response);
                }
            } else {
                // サマリプロンプトの編集
                const currentPromptForAi = previewPrompt 
                    ? previewPrompt.proposed_prompt 
                    : (memory?.summary_prompt_template || '');

                const response = await dabApi.editPromptAi(userMsg, currentPromptForAi);
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.assistant_message }]);
                setPreviewPrompt(response);
            }
        } catch (error) {
            console.error('AIチャット送信エラー', error);
            setChatHistory(prev => [...prev, { role: 'assistant', content: `エラーが発生しました: ${error.message}` }]);
        } finally {
            setIsAiResponding(false);
        }
    };

    // 変更適用（ローカルプレビュー用ヘルパー）
    const applyChangesLocal = (currentTopics, changes) => {
        let newList = [...currentTopics];
        
        changes.forEach(change => {
            if (change.action === 'delete') {
                newList = newList.filter(t => t.id !== change.id);
            } else if (change.action === 'add') {
                // 既存のIDがあれば上書き、なければ追加
                if (!newList.some(t => t.id === change.topic.id)) {
                    newList.push(change.topic);
                }
            } else if (change.action === 'modify') {
                newList = newList.map(t => t.id === change.id ? { ...t, ...change.topic } : t);
            }
        });
        
        return newList;
    };

    // プレビュー変更を確定（Firestoreに保存）
    const handleCommitChanges = async () => {
        if (!pendingChanges) return;
        setLoading(true);
        try {
            const updatedList = applyChangesLocal(topics, pendingChanges.changes);
            await dabApi.commitTopics(updatedList);
            setTopics(updatedList);
            setPendingChanges(null);
            setChatHistory(prev => [...prev, { role: 'assistant', content: '✅ ホットトピックの変更が正常に保存されました！' }]);
        } catch (error) {
            alert(`変更の保存に失敗しました: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    // プレビュー変更のキャンセル
    const handleCancelChanges = () => {
        setPendingChanges(null);
        setChatHistory(prev => [...prev, { role: 'assistant', content: '❌ 変更案をキャンセルしました。' }]);
    };

    // プロンプト変更を確定（Firestoreに保存）
    const handleCommitPrompt = async () => {
        if (!previewPrompt) return;
        setLoading(true);
        try {
            await dabApi.commitPrompt(previewPrompt.proposed_prompt);
            setMemory(prev => ({ ...prev, summary_prompt_template: previewPrompt.proposed_prompt }));
            setPreviewPrompt(null);
            setChatHistory(prev => [...prev, { role: 'assistant', content: '✅ サマリ用プロンプトの更新が正常に保存されました！' }]);
        } catch (error) {
            alert(`プロンプトの保存に失敗しました: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    // プロンプト変更のキャンセル
    const handleCancelPrompt = () => {
        setPreviewPrompt(null);
        setChatHistory(prev => [...prev, { role: 'assistant', content: '❌ プロンプトの変更をキャンセルしました。' }]);
    };

    // 記事の評価アクション
    const handleEvaluate = async (feedId, isKnown, isInterested, grainLevel) => {
        try {
            await dabApi.evaluateFeedItem(feedId, isKnown, isInterested, grainLevel);
            
            // ローカルステート更新（評価済みにする）
            setFeed(prev => prev.map(item => {
                if (item.id === feedId) {
                    return {
                        ...item,
                        read_status: 'READ',
                        user_evaluations: { is_known: isKnown, is_interested: isInterested, grain_level: grainLevel }
                    };
                }
                return item;
            }));

            // 長期記憶の動的反映のため、裏側でデータ再取得
            setTimeout(async () => {
                const memoryData = await dabApi.getMemory();
                const topicsData = await dabApi.getTopics();
                setMemory(memoryData);
                setTopics(topicsData);
            }, 1000); // バックグラウンド処理の完了を少し待ってから再取得
            
        } catch (e) {
            alert(`評価の保存に失敗しました: ${e.message}`);
        }
    };

    // 手動バッチトリガーのハンドラ
    const handleTriggerIngest = async () => {
        setIsIngesting(true);
        try {
            await dabApi.triggerIngest();
            alert('情報収集バッチをバックグラウンドで起動しました。最新記事の収集およびコンサル構造化サマリの生成が開始されます。約15秒後にフィードが自動更新されます。');
            
            // 15秒後にデータを再読み込み
            setTimeout(async () => {
                const feedData = await dabApi.getFeed().catch(() => []);
                setFeed(feedData);
                setIsIngesting(false);
            }, 15000);
        } catch (error) {
            alert(`バッチの起動に失敗しました: ${error.message}`);
            setIsIngesting(false);
        }
    };

    // --- 音声読み上げコントロール (Web Speech API) ---
    const startSpeaking = (feedItem) => {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            alert('お使いのブラウザは音声合成に対応していません。');
            return;
        }

        // 既に再生中なら一旦停止
        stopSpeaking();

        // 読み上げテキストの構築
        const titleText = `${feedItem.source}からの最新情報。タイトルは、${feedItem.title}。`;
        // Markdown記号を簡略パースして読みやすく
        const cleanSummary = feedItem.summary
            .replace(/#/g, '')
            .replace(/\*/g, '')
            .replace(/-/g, '、')
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

        const fullText = `${titleText}\n\n要約サマリは以下の通りです。\n\n${cleanSummary}`;

        const newUtterance = new SpeechSynthesisUtterance(fullText);
        newUtterance.lang = 'ja-JP';
        newUtterance.rate = 1.0; // 読み上げ速度 (0.1 - 10)
        newUtterance.pitch = 1.0; // 音程 (0 - 2)

        newUtterance.onend = () => {
            setIsPlaying(false);
            setCurrentPlayingFeedId(null);
        };

        newUtterance.onerror = (e) => {
            console.error('SpeechSynthesisUtterance error', e);
            setIsPlaying(false);
            setCurrentPlayingFeedId(null);
        };

        speechRef.current = newUtterance;
        setUtterance(newUtterance);
        setCurrentPlayingFeedId(feedItem.id);
        setIsPlaying(true);

        window.speechSynthesis.speak(newUtterance);
    };

    const stopSpeaking = () => {
        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            setIsPlaying(false);
            setCurrentPlayingFeedId(null);
        }
    };

    // プレビュー差分の分析用ヘルパー
    const getTopicStatusInPreview = (topicId) => {
        if (!pendingChanges) return 'normal';
        const change = pendingChanges.changes.find(c => c.id === topicId || (c.topic && c.topic.id === topicId));
        if (!change) return 'normal';
        return change.action; // 'add', 'delete', 'modify'
    };

    // プレビュー適用後のトピック一覧（表示用）
    const displayedTopics = pendingChanges 
        ? applyChangesLocal(topics, pendingChanges.changes) 
        : topics;

    // カテゴリごとにトピックをグルーピング
    const groupedTopics = displayedTopics.reduce((groups, topic) => {
        const category = topic.category || 'その他';
        if (!groups[category]) groups[category] = [];
        groups[category].push(topic);
        return groups;
    }, {});

    return (
        <div className="relative w-full h-full bg-slate-50 text-slate-900 font-sans flex flex-row overflow-hidden">
            {/* メインダッシュボードエリア (左側) */}
            <div className="flex-1 flex flex-col p-4 h-full gap-3 overflow-hidden">
                {/* ヘッダー */}
                <div className="flex-none flex justify-between items-center border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-2">
                        <MobileMenuButton />
                        <h1 className="text-xl font-black text-slate-800 tracking-tight">
                            🧠 Data Architecture Brain (DAB)
                        </h1>
                    </div>
                    {/* 再生コントロール（再生中の場合表示） */}
                    {isPlaying && (
                        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 px-4 py-1.5 rounded-full text-xs animate-pulse text-indigo-700">
                            <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-pink-500"></span>
                            </span>
                            <span>ニュースサマリをハンズフリー再生中...</span>
                            <button 
                                onClick={stopSpeaking} 
                                className="bg-rose-500 hover:bg-rose-600 text-white font-bold px-3 py-1 rounded-full text-[10px] transition-all"
                            >
                                停止 ⏹️
                            </button>
                        </div>
                    )}
                </div>

                {/* 各コンテンツ表示エリア */}
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                    {loading ? (
                        <div className="flex justify-center items-center h-64 text-slate-500 text-sm">
                            <span className="animate-spin mr-2">🔄</span> 読み込み中...
                        </div>
                    ) : (
                        <>
                            {/* 1. ホットトピック */}
                            {activeTab === 'topics' && (
                                <div className="space-y-4 animate-in fade-in duration-200">
                                    {pendingChanges && (
                                        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-center justify-between">
                                            <div>
                                                <h4 className="font-bold text-amber-800 text-xs">⚠️ ホットトピックの変更案をプレビュー中</h4>
                                                <p className="text-slate-500 text-[10px] mt-0.5">
                                                    右側のAIチャットとのやり取りで生成された変更案を表示しています。確定するまでデータベースには保存されません。
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button 
                                                    onClick={handleCancelChanges} 
                                                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2.5 py-1 rounded-md text-[10px] font-semibold"
                                                >
                                                    キャンセル
                                                </button>
                                                <button 
                                                    onClick={handleCommitChanges} 
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-md text-[10px] font-semibold shadow"
                                                >
                                                    変更を確定保存
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {Object.keys(groupedTopics).map(category => (
                                        <div key={category} className="space-y-1.5">
                                            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-l-2 border-indigo-500 pl-2">
                                                {category}
                                            </h3>
                                            <div className="flex flex-col gap-1.5">
                                                {groupedTopics[category].map(topic => {
                                                    const previewStatus = getTopicStatusInPreview(topic.id);
                                                    const isExpanded = expandedTopicId === topic.id;
                                                    
                                                    // ステータスに応じた枠線・背景色
                                                    let borderClass = 'border-slate-200 bg-white hover:bg-slate-50/50';
                                                    if (previewStatus === 'add') borderClass = 'border-emerald-300 bg-emerald-50 shadow-sm animate-pulse text-emerald-900';
                                                    if (previewStatus === 'delete') borderClass = 'border-red-200 bg-red-50/60 opacity-60 text-red-900';
                                                    if (previewStatus === 'modify') borderClass = 'border-blue-300 bg-blue-50 text-blue-900';

                                                    return (
                                                        <div 
                                                            key={topic.id} 
                                                            className={`px-3 py-2 rounded-lg border transition-all duration-200 ${borderClass}`}
                                                        >
                                                            {/* ヘッダー行：クリックで詳細アコーディオン開閉 */}
                                                            <div 
                                                                className="flex justify-between items-center cursor-pointer select-none"
                                                                onClick={() => setExpandedTopicId(isExpanded ? null : topic.id)}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className="font-bold text-xs text-slate-800">
                                                                        {topic.name}
                                                                    </h4>
                                                                    {/* プレビュータグ */}
                                                                    {previewStatus !== 'normal' && (
                                                                        <span className={`text-[8px] font-bold px-1 py-0.2 rounded-full ${
                                                                            previewStatus === 'add' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                                                                            previewStatus === 'delete' ? 'bg-red-100 text-red-700 border border-red-200' :
                                                                            'bg-blue-100 text-blue-700 border border-blue-200'
                                                                        }`}>
                                                                            {previewStatus === 'add' ? '新規追加' : previewStatus === 'delete' ? '削除予定' : '内容変更'}
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                <div className="flex items-center gap-3 text-[10px]">
                                                                    {/* 評価スコアを1行に表示 */}
                                                                    <div className="flex gap-3">
                                                                        <div className="flex items-center gap-1">
                                                                            <span className="text-slate-400 text-[9px]">関心:</span>
                                                                            <span className="flex gap-0.5">
                                                                                {[...Array(5)].map((_, i) => (
                                                                                    <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < (topic.interest_score || 5) ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                                                                                ))}
                                                                            </span>
                                                                        </div>
                                                                        <div className="flex items-center gap-1">
                                                                            <span className="text-slate-400 text-[9px]">既知:</span>
                                                                            <span className="flex gap-0.5">
                                                                                {[...Array(5)].map((_, i) => (
                                                                                    <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < (topic.known_score || 1) ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                                                                                ))}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <span className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">{topic.status}</span>
                                                                    <span className="text-slate-400 text-[9px] w-2">{isExpanded ? '▼' : '▶'}</span>
                                                                </div>
                                                            </div>

                                                            {/* アコーディオンの中身：説明文 */}
                                                            {isExpanded && (
                                                                <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-600 leading-relaxed animate-in fade-in slide-in-from-top-1 duration-150">
                                                                    {topic.description}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* 2. キャッチアップフィード */}
                            {activeTab === 'feed' && (
                                <div className="space-y-3 animate-in fade-in duration-200">
                                    {/* 手動バッチ起動ボタン */}
                                    <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                                        <div>
                                            <h4 className="font-bold text-xs text-slate-800">最新トレンド情報の収集</h4>
                                            <p className="text-[10px] text-slate-500 mt-0.5">Zenn RSSおよびGemini Web Searchから最新の記事を収集し、サマリを生成します。</p>
                                        </div>
                                        <button
                                            onClick={handleTriggerIngest}
                                            disabled={isIngesting}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow transition-all ${
                                                isIngesting 
                                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed animate-pulse border border-slate-250' 
                                                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100'
                                            }`}
                                        >
                                            {isIngesting ? '情報収集処理中...' : '最新情報を取得 🔄'}
                                        </button>
                                    </div>

                                    {feed.length === 0 ? (
                                        <div className="text-center py-16 bg-white border border-slate-200 rounded-lg">
                                            <p className="text-slate-400 text-xs font-medium">現在、収集されたフィード記事はありません。</p>
                                            <p className="text-slate-500 text-[10px] mt-0.5">Zenn RSSやWeb検索バッチが実行されると、ここに関連情報が並びます。</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-1.5">
                                            {feed.map(item => {
                                                const isRead = item.read_status === 'READ';
                                                const hasEval = !!item.user_evaluations;
                                                const isExpanded = expandedFeedId === item.id;

                                                return (
                                                    <div 
                                                        key={item.id} 
                                                        className={`border rounded-lg overflow-hidden transition-all duration-200 ${
                                                            isRead 
                                                                ? 'border-slate-200 bg-slate-50/70 opacity-75' 
                                                                : 'border-indigo-100 bg-white shadow-sm hover:border-indigo-200'
                                                        }`}
                                                    >
                                                        {/* ヘッダー部分（1行リスト形式、クリックで開閉） */}
                                                        <div 
                                                            onClick={() => setExpandedFeedId(isExpanded ? null : item.id)}
                                                            className="px-3 py-2 flex justify-between items-center gap-3 cursor-pointer select-none"
                                                        >
                                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                                <span className="text-[9px] font-bold bg-indigo-50 border border-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded-md flex-shrink-0">
                                                                    {item.source}
                                                                </span>
                                                                <h3 className={`font-bold text-xs truncate max-w-[60%] hover:text-indigo-650 transition-colors ${
                                                                    isRead ? 'text-slate-500 line-through' : 'text-slate-800'
                                                                }`}>
                                                                    {item.title}
                                                                </h3>
                                                                <div className="hidden sm:flex gap-1 flex-shrink-0">
                                                                    {item.related_topics && item.related_topics.slice(0, 2).map(t => (
                                                                        <span key={t} className="text-[8px] text-slate-500 border border-slate-200 bg-slate-50 px-1 py-0.2 rounded">
                                                                            {t}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            <div className="flex-none flex items-center gap-3">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation(); // アコーディオンの開閉をトリガーしない
                                                                        currentPlayingFeedId === item.id ? stopSpeaking() : startSpeaking(item);
                                                                    }}
                                                                    className={`px-2 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 transition-all ${
                                                                        currentPlayingFeedId === item.id 
                                                                            ? 'bg-rose-500 text-white animate-pulse' 
                                                                            : 'bg-slate-100 hover:bg-slate-200 text-indigo-650 border border-slate-200'
                                                                    }`}
                                                                >
                                                                    {currentPlayingFeedId === item.id ? '停止 ⏹️' : '聴く 🔊'}
                                                                </button>
                                                                <span className="text-slate-400 text-[9px] w-2">{isExpanded ? '▼' : '▶'}</span>
                                                            </div>
                                                        </div>

                                                        {/* アコーディオンで開くサマリー本文と評価パネル */}
                                                        {isExpanded && (
                                                            <div className="p-3 bg-slate-50/50 border-t border-slate-100 space-y-3 animate-in fade-in duration-150">
                                                                <div className="prose prose-sm max-w-none text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed">
                                                                    {item.summary}
                                                                </div>

                                                                <div className="pt-2 border-t border-slate-200/60 flex flex-wrap gap-3 items-center justify-between text-[10px]">
                                                                    <div className="flex items-center gap-3">
                                                                        <a 
                                                                            href={item.url} 
                                                                            target="_blank" 
                                                                            rel="noopener noreferrer" 
                                                                            className="text-indigo-600 hover:text-indigo-800 font-semibold underline"
                                                                            onClick={e => e.stopPropagation()}
                                                                        >
                                                                            元の記事を開く 🔗
                                                                        </a>
                                                                        <div className="flex items-center gap-1 text-slate-400 text-[9px]">
                                                                            <span className={`w-1.5 h-1.5 rounded-full ${isRead ? 'bg-slate-400' : 'bg-indigo-500'}`} />
                                                                            <span>{isRead ? '閲覧済み' : '新着'}</span>
                                                                        </div>
                                                                    </div>

                                                                    <div onClick={e => e.stopPropagation()}>
                                                                        {hasEval ? (
                                                                            <div className="flex gap-2 text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full text-[9px]">
                                                                                <span>既知: {item.user_evaluations.is_known ? '👍 はい' : '📖 いいえ'}</span>
                                                                                <span>興味: {item.user_evaluations.is_interested ? '🔥 あり' : '❄️ なし'}</span>
                                                                                <span>粒度: {item.user_evaluations.grain_level}</span>
                                                                            </div>
                                                                        ) : (
                                                                            <div className="flex gap-1.5 items-center">
                                                                                <span className="text-slate-500 text-[9px] mr-1">この情報を評価して学習:</span>
                                                                                
                                                                                <button
                                                                                    onClick={() => handleEvaluate(item.id, true, true, 'PRACTICAL')}
                                                                                    className="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold px-2 py-0.5 rounded text-[9px] transition-colors"
                                                                                >
                                                                                    知ってた・興味あり 👍
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleEvaluate(item.id, false, true, 'PRACTICAL')}
                                                                                    className="bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 font-bold px-2 py-0.5 rounded text-[9px] transition-colors"
                                                                                >
                                                                                    知らない・興味あり 🔥
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleEvaluate(item.id, true, false, 'BASIC')}
                                                                                    className="bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded text-[9px] transition-colors"
                                                                                >
                                                                                    知ってた・興味なし ❄️
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 3. 長期記憶 */}
                            {activeTab === 'memory' && (
                                <div className="space-y-4 animate-in fade-in duration-200 bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-800">🧠 あなたの長期記憶 (Agent Core Memory)</h3>
                                        <p className="text-[10px] text-slate-500 mt-0.5">
                                            あなたの記事の評価行動からAIが推論した、現在あなたが理解していると思われる既知概念のデータベースです。
                                        </p>
                                    </div>

                                    {/* 習得済み概念のタグクラウド */}
                                    <div className="space-y-1.5">
                                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">現在認識されている既知の概念:</h4>
                                        <div className="flex flex-wrap gap-1.5 pt-1">
                                            {memory?.known_concepts && memory.known_concepts.length > 0 ? (
                                                memory.known_concepts.map(concept => (
                                                    <span key={concept} className="bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full text-[10px] shadow-sm">
                                                        ✅ {concept}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-[10px] text-slate-400 italic">評価履歴がありません。フィードの「知っていた」をクリックすると、既知の概念が追加されます。</span>
                                            )}
                                        </div>
                                    </div>

                                    {/* 学習目標 */}
                                    <div className="border-t border-slate-100 pt-3 space-y-1.5">
                                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">AIが認識しているあなたの学習目標:</h4>
                                        <div className="bg-slate-50 border border-slate-200 p-3 rounded-lg text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                                            {memory?.learning_goals || 'データアーキテクチャコンサルタントとしての自己学習目標。'}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 4. プロンプト設定 */}
                            {activeTab === 'settings' && (
                                <div className="space-y-4 animate-in fade-in duration-200 bg-white border border-slate-200 p-4 rounded-xl shadow-sm">
                                    {previewPrompt && (
                                        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-center justify-between">
                                            <div>
                                                <h4 className="font-bold text-amber-800 text-xs">⚠️ プロンプトの修正案をプレビュー中</h4>
                                                <p className="text-slate-500 text-[10px] mt-0.5">
                                                    右側のAIチャットで指示されたプロンプト案を表示しています。確定するまで適用されません。
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button 
                                                    onClick={handleCancelPrompt} 
                                                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2.5 py-1 rounded-md text-[10px] font-semibold"
                                                >
                                                    キャンセル
                                                </button>
                                                <button 
                                                    onClick={handleCommitPrompt} 
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1 rounded-md text-[10px] font-semibold shadow"
                                                >
                                                    プロンプトを確定
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-1.5">
                                        <h3 className="text-xs font-bold text-slate-800">
                                            {previewPrompt ? '📖 提案されている要約プロンプト:' : '現在の要約プロンプト:'}
                                        </h3>
                                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-[11px] text-slate-700 h-80 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                                            {previewPrompt ? previewPrompt.proposed_prompt : (memory?.summary_prompt_template || '')}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* AI壁打ちサイドバー (右側) */}
            <div className="w-96 flex-none bg-slate-100 border-l border-slate-200 flex flex-col h-full">
                {/* サイドバーヘッダー */}
                <div className="p-3 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <h2 className="font-bold text-xs text-slate-700 flex items-center gap-1.5">
                        💬 AIアシスタント (壁打ち)
                    </h2>
                    {/* 編集モード切り替え */}
                    <div className="flex bg-slate-200 p-0.5 rounded-lg border border-slate-300">
                        <button
                            onClick={() => {
                                setChatMode('topics');
                                setActiveTab('topics');
                            }}
                            className={`px-2 py-1 text-[9px] font-bold rounded-md transition-all ${chatMode === 'topics' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-800'}`}
                        >
                            トピック編集
                        </button>
                        <button
                            onClick={() => {
                                setChatMode('prompt');
                                setActiveTab('settings');
                            }}
                            className={`px-2 py-1 text-[9px] font-bold rounded-md transition-all ${chatMode === 'prompt' ? 'bg-indigo-650 text-white shadow' : 'text-slate-600 hover:text-slate-800'}`}
                        >
                            プロンプト
                        </button>
                    </div>
                </div>

                {/* チャット履歴 */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-slate-50/50">
                    {chatHistory.map((msg, i) => (
                        <div 
                            key={i} 
                            className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'items-start'}`}
                        >
                            <span className="text-[9px] text-slate-400 mb-0.5">
                                {msg.role === 'user' ? 'あなた' : 'AI'}
                            </span>
                            <div className={`p-2.5 rounded-xl text-[11px] leading-relaxed ${
                                msg.role === 'user' 
                                    ? 'bg-indigo-600 text-white rounded-tr-none shadow-sm' 
                                    : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none whitespace-pre-wrap shadow-sm'
                            }`}>
                                {msg.content}
                            </div>
                        </div>
                    ))}
                    {isAiResponding && (
                        <div className="flex flex-col items-start max-w-[85%]">
                            <span className="text-[9px] text-slate-400 mb-0.5">AI</span>
                            <div className="p-2.5 rounded-xl text-[11px] bg-white border border-slate-200 text-slate-400 rounded-tl-none animate-pulse">
                                思考中...
                            </div>
                        </div>
                    )}
                </div>

                {/* プレビュー中のアクションリマインダー */}
                {(pendingChanges || previewPrompt) && (
                    <div className="p-2.5 bg-amber-50 border-t border-b border-amber-200 text-center">
                        <span className="text-[9px] text-amber-700 font-bold block animate-bounce">
                            ⚠️ 変更プレビュー中
                        </span>
                        <div className="flex gap-2 justify-center mt-1.5">
                            <button 
                                onClick={chatMode === 'topics' ? handleCancelChanges : handleCancelPrompt}
                                className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-[9px] font-semibold px-2 py-1 rounded"
                            >
                                キャンセル
                            </button>
                            <button 
                                onClick={chatMode === 'topics' ? handleCommitChanges : handleCommitPrompt}
                                className="bg-amber-500 hover:bg-amber-600 text-white text-[9px] font-semibold px-3 py-1 rounded shadow-sm"
                            >
                                適用して確定保存
                            </button>
                        </div>
                    </div>
                )}

                {/* チャット入力 */}
                <form onSubmit={handleSendChatMessage} className="p-3 border-t border-slate-200 bg-slate-50">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder={chatMode === 'topics' 
                                ? '例: データリネージを追加して...' 
                                : '例: ビジネス価値 of データの項目を追加して...'
                            }
                            disabled={isAiResponding}
                            className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-800 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        />
                        <button
                            type="submit"
                            disabled={!chatInput.trim() || isAiResponding}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg text-[11px] transition-colors disabled:bg-slate-200 disabled:text-slate-400"
                        >
                            送信
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default function DabPage() {
    return (
        <Suspense fallback={
            <div className="flex justify-center items-center h-full w-full bg-[#0b0f19] text-slate-400 text-sm">
                <span className="animate-spin mr-2">🔄</span> 読み込み中...
            </div>
        }>
            <DabDashboard />
        </Suspense>
    );
}
