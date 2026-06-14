"use client";

import React, { useState, useEffect, useRef, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSearchParams } from 'next/navigation';
import { dabApi } from '../utils/dabApi';
import MobileMenuButton from '../../components/MobileMenuButton';

// Zennなどの全件フィードから無関係な記事を除外する判定用デフォルトプロンプト
const DEFAULT_FILTER_PROMPT = `あなたはデータアーキテクチャコンサルタントの自己学習支援システム用の分類AIです。
入力された技術記事（タイトルとURL）が、「データアーキテクチャコンサルタントが学習すべきか」を判定してください。

以下の条件に当てはまる記事は【採用（読むべき＝True）】と判定してください：
1. エンタープライズデータ基盤、データマネジメント、データ統合（DWH/Lakehouse、データメッシュ、セマンティックレイヤー、データファブリック、Data Observability等）に関するもの。
2. エンタープライズ環境でのRAG、LLMエージェント統合のアーキテクチャ設計や、セキュリティ/AIガバナンス・規制（EU AI Act等）に関するもの。

以下の条件に当てはまる記事は【除外（読むべきでない＝False）】と判定してください：
1. 一般的なプログラミング言語仕様（Go vs Java、Pythonの文法等）や言語固有のTips。
2. 一般的なフロントエンド開発手法やフレームワーク設計（Next.js、React、CSS等）。
3. インフラ/セキュリティ一般の資格の合格体験記（CKS等）や個人のOS環境構築（Ubuntu等）。
4. ガジェットやツールの個人的な使用感、個人の開発記、無関係なテーマ。

## 判定例：
- 『Bedrock AgentCore + Strands Agents SDKで作る社内RAGボット』 -> True (社内RAG/LLMエージェント設計)
- 『Claude Fable 5が突然使えなくなった(輸出管理指令によるアクセス停止)』 -> True (AIガバナンス/法規制)
- 『GoのパッケージシステムをJavaと比較しながら理解する』 -> False (言語比較)
- 『半年でNext.jsアプリを10本作って見えた設計の『判断基準』』 -> False (フロントエンド)
- 『CKS合格体験記〜AIと歩んだ44日間〜』 -> False (資格)
- 『QAエンジニアが「自分でテストやりきる」のをやめようとしている話』 -> False (一般的なテスト運用)

応答は必ず以下のJSON形式のみで行ってください。
{
  "is_relevant": true または false,
  "reason": "簡単な判定理由（1行）"
}`;

// CDN経由でMermaid.jsをロードし、図解を動的レンダリングするコンポーネント
function MermaidRenderer({ chart }) {
    const containerRef = useRef(null);
    const [svg, setSvg] = useState('');
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        
        const renderChart = async () => {
            try {
                // AIが生成するMermaidコードのパースエラーを防ぐため、自動パッチ処理を適用
                // 改行コードを\nに統一し、Windowsの\rを削除して正規表現の突き抜けを防ぐ
                let cleanChart = chart.trim().replace(/\\n/g, '\n').replace(/\r/g, '');
                if (cleanChart.startsWith('```mermaid')) {
                    cleanChart = cleanChart.replace(/^```mermaid\n/, '').replace(/\n```$/, '');
                } else if (cleanChart.startsWith('```')) {
                    cleanChart = cleanChart.replace(/^```\n/, '').replace(/\n```$/, '');
                }

                // すでにダブルクォーテーションで囲まれていないノード定義を自動クォートする
                // [] (角括弧): ID[テキスト] -> ID["テキスト"]
                cleanChart = cleanChart.replace(/([a-zA-Z0-9_-]+)\[([^"\]\r\n]+)\]/g, (match, id, text) => {
                    if (id === 'subgraph' || id === 'style' || id === 'classDef' || id === 'class' || id === 'click' || id === 'linkStyle') return match;
                    return `${id}["${text.trim()}"]`;
                });

                // () (丸括弧): ID(テキスト) -> ID("テキスト")
                cleanChart = cleanChart.replace(/([a-zA-Z0-9_-]+)\(([^"\)\r\n]+)\)/g, (match, id, text) => {
                    if (id === 'graph' || id === 'flowchart' || id === 'subgraph' || id === 'style' || id === 'classDef' || id === 'class' || id === 'click' || id === 'linkStyle') return match;
                    return `${id}("${text.trim()}")`;
                });

                // {} (波括弧): ID{テキスト} -> ID{"テキスト"}
                cleanChart = cleanChart.replace(/([a-zA-Z0-9_-]+)\{([^"\}\r\n]+)\}/g, (match, id, text) => {
                    if (id === 'subgraph' || id === 'style' || id === 'classDef' || id === 'class' || id === 'click' || id === 'linkStyle') return match;
                    return `${id}{"${text.trim()}"}`;
                });
                
                // mindmapチャートの場合、ノードテキスト内の丸括弧が「(())」構文と衝突してパースエラーになるため全角に変換する
                if (/^\s*mindmap/i.test(cleanChart)) {
                    cleanChart = cleanChart.split('\n').map(line => {
                        // ((text)) 形式の中の丸括弧を全角に変換
                        line = line.replace(/\(\((.+?)\)\)/g, (m, inner) =>
                            `((${inner.replace(/[()]/g, c => c === '(' ? '（' : '）')}))`
                        );
                        // (text) 形式の中の丸括弧を全角に変換（前後に追加括弧がないもの）
                        line = line.replace(/(?<!\()\(([^()\n]+)\)(?!\))/g, (m, inner) =>
                            `(${inner.replace(/[()]/g, c => c === '(' ? '（' : '）')})`
                        );
                        return line;
                    }).join('\n');
                }

                if (!window.mermaid) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
                        script.onload = () => {
                            try {
                                window.mermaid.initialize({
                                    startOnLoad: false,
                                    theme: 'neutral',
                                    securityLevel: 'loose',
                                    suppressErrors: true, // エラー出力を抑制してNext.jsのクラッシュを防ぐ
                                    parseError: (err) => {
                                        console.warn('Mermaid parse error handled inside callback:', err);
                                    },
                                    themeVariables: {
                                        background: '#ffffff',
                                        primaryColor: '#e0e7ff', // Indigo 100
                                        primaryTextColor: '#1e1b4b',
                                        lineColor: '#6366f1',
                                    }
                                });
                                resolve();
                            } catch (initErr) {
                                reject(initErr);
                            }
                        };
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }

                if (window.mermaid && isMounted) {
                    // 事前にパースチェックを行い、エラーがあれば例外を投げる
                    try {
                        await window.mermaid.parse(cleanChart);
                    } catch (parseErr) {
                        throw new Error(`Mermaid構文エラー: ${parseErr.message || parseErr}`);
                    }

                    const randomId = `mermaid-${Math.random().toString(36).substring(2, 11)}`;
                    const { svg: renderedSvg } = await window.mermaid.render(randomId, cleanChart);
                    if (isMounted) {
                        setSvg(renderedSvg);
                        setError(null);
                    }
                }
            } catch (err) {
                console.error('Mermaid rendering failed:', err);
                if (isMounted) {
                    setError(err.message || '図解の描画に失敗しました');
                }
            }
        };

        renderChart();

        return () => {
            isMounted = false;
        };
    }, [chart]);

    if (error) {
        return (
            <div className="text-[10px] text-red-500 bg-red-50 p-2.5 rounded-lg border border-red-200 font-mono">
                ⚠️ 図解の描画でエラーが発生しました。
                <pre className="mt-1 bg-slate-800 text-slate-200 p-2 rounded overflow-x-auto text-[9px] max-h-40">{chart}</pre>
            </div>
        );
    }

    if (!svg) {
        return (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-450 py-3 pl-1 bg-white p-4 rounded-xl border border-slate-200/50">
                <span className="animate-spin text-xs">🔄</span> 図解を描画中...
            </div>
        );
    }

    return (
        <div 
            ref={containerRef} 
            className="mermaid-svg-container flex justify-center bg-white p-4 rounded-xl border border-slate-250/50 shadow-inner overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: svg }} 
        />
    );
}

// 記事サマリをMarkdownパースしてスライド資料風に視覚化するコンポーネント（コストゼロ・内容直結）
function SlideCard({ item }) {
    const rawText = (item.summary || '').replace(/\\n/g, '\n');

    // セクションごとに分割してキー情報を抽出
    const sections = {};
    let currentKey = null;
    for (const line of rawText.split('\n')) {
        if (line.includes('問い') && (line.includes('結論') || line.startsWith('#'))) {
            currentKey = 'qa'; sections[currentKey] = [];
        } else if (line.includes('論点') || line.includes('トレードオフ')) {
            currentKey = 'points'; sections[currentKey] = [];
        } else if (line.includes('中級者') || line.includes('読むべき理由')) {
            currentKey = 'reason'; sections[currentKey] = [];
        } else if (currentKey && line.trim().match(/^[-*]\s/)) {
            const text = line.replace(/^[\s\-*]+/, '').replace(/\*\*/g, '').trim();
            if (text) sections[currentKey].push(text);
        } else if (currentKey === 'reason' && line.trim() && !line.startsWith('#')) {
            const text = line.replace(/\*\*/g, '').trim();
            if (text) sections[currentKey].push(text);
        }
    }

    // カラーテーマ（記事タイトルハッシュで自動選択）
    const themes = [
        { from: '#1e1b4b', to: '#3730a3', accent: '#818cf8', text: '#e0e7ff' },
        { from: '#0c1a33', to: '#1e3a5f', accent: '#38bdf8', text: '#e0f9ff' },
        { from: '#0d1f12', to: '#14532d', accent: '#4ade80', text: '#d1fae5' },
        { from: '#2d1500', to: '#78350f', accent: '#fbbf24', text: '#fef3c7' },
        { from: '#1a0533', to: '#4a1d96', accent: '#c084fc', text: '#f3e8ff' },
        { from: '#0c2026', to: '#155e75', accent: '#22d3ee', text: '#cffafe' },
    ];
    const hash = (item.title || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const t = themes[hash % themes.length];

    const qaPoints = (sections.qa || []).slice(0, 2);
    const keyPoints = (sections.points || []).slice(0, 3);

    return (
        <div style={{
            background: `linear-gradient(135deg, ${t.from} 0%, ${t.to} 100%)`,
            borderRadius: '12px',
            padding: '16px 18px 40px',
            position: 'relative',
            overflow: 'hidden',
            minHeight: '220px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
            fontFamily: 'sans-serif',
        }}>
            {/* 背景装飾 */}
            <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '150px', height: '150px', borderRadius: '50%', background: `${t.accent}18` }} />
            <div style={{ position: 'absolute', bottom: '-30px', left: '-20px', width: '100px', height: '100px', borderRadius: '50%', background: `${t.accent}10` }} />

            {/* スライドタイトル */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', marginBottom: '12px', position: 'relative' }}>
                <div style={{ width: '3px', flexShrink: 0, alignSelf: 'stretch', background: t.accent, borderRadius: '2px', marginTop: '2px' }} />
                <h3 style={{ color: t.text, fontSize: '12px', fontWeight: 800, lineHeight: 1.5, margin: 0 }}>
                    {(item.title || '').slice(0, 70)}{(item.title || '').length > 70 ? '…' : ''}
                </h3>
            </div>

            {/* 問い・結論セクション */}
            {qaPoints.length > 0 && (
                <div style={{ marginBottom: '10px', position: 'relative' }}>
                    <div style={{ fontSize: '8px', color: t.accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>🎯 問い・結論</div>
                    {qaPoints.map((p, i) => (
                        <div key={i} style={{ fontSize: '10px', color: 'rgba(255,255,255,0.88)', lineHeight: 1.6, paddingLeft: '8px', borderLeft: `2px solid ${t.accent}`, marginBottom: '4px' }}>
                            {p.slice(0, 90)}{p.length > 90 ? '…' : ''}
                        </div>
                    ))}
                </div>
            )}

            {/* キーポイントセクション */}
            {keyPoints.length > 0 && (
                <div style={{ position: 'relative' }}>
                    <div style={{ fontSize: '8px', color: t.accent, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '5px' }}>🔑 キーポイント</div>
                    {keyPoints.map((p, i) => (
                        <div key={i} style={{ display: 'flex', gap: '5px', fontSize: '10px', color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, marginBottom: '4px' }}>
                            <span style={{ color: t.accent, flexShrink: 0, fontWeight: 700 }}>▸</span>
                            <span>{p.slice(0, 80)}{p.length > 80 ? '…' : ''}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* フッター */}
            <div style={{ position: 'absolute', bottom: '10px', right: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                {item.read_time && (
                    <span style={{ fontSize: '8px', color: `${t.accent}dd`, background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '20px' }}>⏱️ {item.read_time}</span>
                )}
                <span style={{ fontSize: '8px', color: `${t.accent}dd`, background: 'rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: '20px' }}>{item.source}</span>
            </div>
        </div>
    );
}

function DabDashboard() {
    const searchParams = useSearchParams();
    const tabParam = searchParams.get('tab') || 'feed';

    // クライアントサイドでのマウント判定（Hydrationエラー防止用）
    const [isMounted, setIsMounted] = useState(false);

    // タブ状態: 'topics' | 'feed' | 'memory' | 'settings'
    const [activeTab, setActiveTab] = useState(tabParam);
    
    // アコーディオン開閉用ステート
    const [expandedTopicId, setExpandedTopicId] = useState(null);
    const [expandedFeedId, setExpandedFeedId] = useState(null);

    // ビジュアルパーツ（Mermaid / AI画像）の表示ON/OFF設定
    const [showMermaid, setShowMermaid] = useState(true);
    const [showAiImage, setShowAiImage] = useState(true);

    // マウント完了時に localStorage から設定を読み込む
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const savedMermaid = localStorage.getItem('dab_show_mermaid');
            const savedAiImage = localStorage.getItem('dab_show_ai_image');
            if (savedMermaid !== null) setShowMermaid(savedMermaid === 'true');
            if (savedAiImage !== null) setShowAiImage(savedAiImage === 'true');
        }
    }, []);

    // 設定トグルハンドラー
    const handleToggleMermaid = (val) => {
        setShowMermaid(val);
        localStorage.setItem('dab_show_mermaid', String(val));
    };

    const handleToggleAiImage = (val) => {
        setShowAiImage(val);
        localStorage.setItem('dab_show_ai_image', String(val));
    };

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
    
    // UIレスポンシブ＆トグル開閉状態
    const [isChatOpen, setIsChatOpen] = useState(true);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const handleResize = () => {
            const mobile = window.innerWidth < 1024;
            setIsMobile(mobile);
            // 画面リサイズ時にモバイルならチャットを閉じ、PCなら開く
            setIsChatOpen(!mobile);
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    // AI壁打ち関連
    const [chatMode, setChatMode] = useState('topics'); // 'topics' | 'prompt' | 'filter'
    const [chatInput, setChatInput] = useState('');
    const [chatHistory, setChatHistory] = useState([
        { role: 'assistant', content: 'こんにちは！データアーキテクチャの専門家になるための自己学習を支援します。サイドバーで「〇〇を追加して」や「〇〇を削除して」と指示すれば、ホットトピックを再構成できます。プロンプトやノイズフィルタの壁打ちも可能です。' }
    ]);
    const [isAiResponding, setIsAiResponding] = useState(false);
    
    // プレビュー変更点の一時保存
    const [pendingChanges, setPendingChanges] = useState(null); // { assistant_message, changes: [...] }
    const [previewPrompt, setPreviewPrompt] = useState(null); // { assistant_message, proposed_prompt }
    const [previewFilterPrompt, setPreviewFilterPrompt] = useState(null); // { assistant_message, proposed_prompt }

    // インジェクションバッチ動作状態
    const [isIngesting, setIsIngesting] = useState(false);

    // Imagen 試験生成の状態管理（feedId -> base64 imageData）
    const [imagenResults, setImagenResults] = useState({});
    const [imagenLoadingId, setImagenLoadingId] = useState(null);

    // 音声再生（SpeechSynthesis）関連
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentPlayingFeedId, setCurrentPlayingFeedId] = useState(null);
    const [utterance, setUtterance] = useState(null);
    const speechRef = useRef(null);

    useEffect(() => {
        setIsMounted(true);
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

    // Imagen 3 Fast 試験生成ハンドラー
    const handleTestImagen = async (item) => {
        setImagenLoadingId(item.id);
        try {
            const result = await dabApi.testImagen(item.title, item.summary || '');
            if (result.success) {
                setImagenResults(prev => ({ ...prev, [item.id]: result.image_data }));
            }
        } catch (e) {
            alert(`Imagen生成エラー: ${e.message}`);
        } finally {
            setImagenLoadingId(null);
        }
    };

    // 日付フォーマットヘルパー
    const formatDate = (dateInput) => {
        if (!dateInput) return '';
        try {
            const d = dateInput.seconds ? new Date(dateInput.seconds * 1000) : new Date(dateInput);
            if (isNaN(d.getTime())) return '';
            
            const diffMs = new Date() - d;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return '今日';
            if (diffDays === 1) return '昨日';
            if (diffDays < 7) return `${diffDays}日前`;
            
            return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        } catch (e) {
            return '';
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
                const currentListForAi = pendingChanges 
                    ? applyChangesLocal(topics, pendingChanges.changes)
                    : topics;

                const response = await dabApi.editTopicsAi(userMsg, currentListForAi);
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.assistant_message }]);
                
                if (response.changes && response.changes.length > 0) {
                    setPendingChanges(response);
                }
            } else if (chatMode === 'prompt') {
                // サマリプロンプトの編集
                const currentPromptForAi = previewPrompt 
                    ? previewPrompt.proposed_prompt 
                    : (memory?.summary_prompt_template || '');

                const response = await dabApi.editPromptAi(userMsg, currentPromptForAi);
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.assistant_message }]);
                setPreviewPrompt(response);
            } else if (chatMode === 'filter') {
                // ノイズフィルタプロンプトの編集
                const currentPromptForAi = previewFilterPrompt
                    ? previewFilterPrompt.proposed_prompt
                    : (memory?.filter_prompt_template || '');

                const response = await dabApi.editFilterPromptAi(userMsg, currentPromptForAi);
                setChatHistory(prev => [...prev, { role: 'assistant', content: response.assistant_message }]);
                setPreviewFilterPrompt(response);
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

    // フィルタープロンプト変更を確定（Firestoreに保存）
    const handleCommitFilterPrompt = async () => {
        if (!previewFilterPrompt) return;
        setLoading(true);
        try {
            await dabApi.commitFilterPrompt(previewFilterPrompt.proposed_prompt);
            setMemory(prev => ({ ...prev, filter_prompt_template: previewFilterPrompt.proposed_prompt }));
            setPreviewFilterPrompt(null);
            setChatHistory(prev => [...prev, { role: 'assistant', content: '✅ フィルタ用プロンプトの更新が正常に保存されました！' }]);
        } catch (error) {
            alert(`フィルタプロンプトの保存に失敗しました: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    // フィルタープロンプト変更のキャンセル
    const handleCancelFilterPrompt = () => {
        setPreviewFilterPrompt(null);
        setChatHistory(prev => [...prev, { role: 'assistant', content: '❌ フィルタプロンプトの変更をキャンセルしました。' }]);
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
        newUtterance.rate = 1.0;
        newUtterance.pitch = 1.0;

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

    const getTopicStatusInPreview = (topicId) => {
        if (!pendingChanges) return 'normal';
        const change = pendingChanges.changes.find(c => c.id === topicId || (c.topic && c.topic.id === topicId));
        if (!change) return 'normal';
        return change.action;
    };

    const displayedTopics = pendingChanges 
        ? applyChangesLocal(topics, pendingChanges.changes) 
        : topics;

    const groupedTopics = displayedTopics.reduce((groups, topic) => {
        const category = topic.category || 'その他';
        if (!groups[category]) groups[category] = [];
        groups[category].push(topic);
        return groups;
    }, {});

    if (!isMounted) {
        return (
            <div className="flex justify-center items-center h-screen bg-slate-50 text-slate-500 text-sm">
                <span className="animate-spin mr-2">🔄</span> 読み込み中...
            </div>
        );
    }

    return (
        <div className="relative w-full h-full bg-slate-50 text-slate-900 font-sans flex flex-row overflow-hidden">
            {/* メインダッシュボードエリア (左側) */}
            <div className="flex-1 flex flex-col p-4 h-full gap-3 overflow-hidden">
                {/* ヘッダー */}
                <div className="flex-none flex justify-between items-center border-b border-slate-200 pb-3">
                    <div className="flex items-center gap-2">
                        <MobileMenuButton />
                        <h1 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight flex items-center gap-1.5">
                            🧠 Data Architecture Brain <span className="text-xs font-mono bg-slate-200 px-1.5 py-0.5 rounded text-slate-500 hidden sm:inline">DAB</span>
                        </h1>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {/* 再生コントロール（再生中の場合表示） */}
                        {isPlaying && (
                            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-full text-[10px] animate-pulse text-indigo-700">
                                <span className="flex h-1.5 w-1.5 relative">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-pink-500"></span>
                                </span>
                                <span className="hidden sm:inline">ニュース読み上げ中...</span>
                                <button 
                                    onClick={stopSpeaking} 
                                    className="bg-rose-500 hover:bg-rose-605 text-white font-bold px-2 py-0.5 rounded-full text-[9px] transition-all"
                                >
                                    停止
                                </button>
                            </div>
                        )}

                        {/* AI壁打ちトグルボタン */}
                        <button
                            onClick={() => setIsChatOpen(!isChatOpen)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border ${
                                isChatOpen 
                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700' 
                                    : 'bg-white border-slate-200 text-slate-650 hover:bg-slate-50'
                            }`}
                        >
                            <span>💬 AI壁打ち</span>
                            <span className={`text-[10px] text-slate-400 transition-transform duration-200 ${isChatOpen ? 'rotate-180' : ''}`}>▼</span>
                        </button>
                    </div>
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
                                            
                                            <div className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
                                                {groupedTopics[category].map((topic, index) => {
                                                    const previewStatus = getTopicStatusInPreview(topic.id);
                                                    const isExpanded = expandedTopicId === topic.id;
                                                    
                                                    const knownVal = topic.known_score || 1;
                                                    let leftBarColor = 'bg-indigo-400';
                                                    if (knownVal <= 2) leftBarColor = 'bg-pink-500';
                                                    else if (knownVal >= 4) leftBarColor = 'bg-emerald-500';

                                                    let rowBgClass = 'bg-white hover:bg-slate-50/50';
                                                    if (previewStatus === 'add') rowBgClass = 'bg-emerald-50/40 hover:bg-emerald-50/60 text-emerald-900';
                                                    if (previewStatus === 'delete') rowBgClass = 'bg-red-50/30 hover:bg-red-50/40 opacity-60 text-red-900';
                                                    if (previewStatus === 'modify') rowBgClass = 'bg-blue-50/40 hover:bg-blue-50/60 text-blue-900';

                                                    return (
                                                        <div 
                                                            key={topic.id} 
                                                            className={`border-b border-slate-100 last:border-b-0 transition-all duration-200 ${rowBgClass}`}
                                                        >
                                                            <div 
                                                                className="relative pl-4 pr-3 py-2.5 flex justify-between items-center cursor-pointer select-none"
                                                                onClick={() => setExpandedTopicId(isExpanded ? null : topic.id)}
                                                            >
                                                                <div className={`absolute left-0 top-0 bottom-0 w-1 ${leftBarColor}`} />

                                                                <div className="flex items-center gap-2">
                                                                    {(topic.interest_score || 0) >= 4 && (
                                                                        <span className="text-amber-500 text-xs flex-shrink-0 animate-pulse" title="高関心トピック">🔥</span>
                                                                    )}
                                                                    <h4 className="font-bold text-xs text-slate-800">
                                                                        {topic.name}
                                                                    </h4>
                                                                    
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

                                                            {isExpanded && (
                                                                <div className="bg-slate-50/60 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-650 leading-relaxed animate-in fade-in slide-in-from-top-1 duration-150">
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
                                    <div className="flex justify-between items-center bg-white p-3 rounded-lg border border-slate-200 shadow-sm gap-2">
                                        <div>
                                            <h4 className="font-bold text-xs text-slate-800">最新トレンド情報の収集</h4>
                                            <p className="text-[10px] text-slate-500 mt-0.5">Zenn RSSおよびGemini Web Searchから最新記事を収集し、AIで厳選要約します。</p>
                                        </div>
                                        <button
                                            onClick={handleTriggerIngest}
                                            disabled={isIngesting}
                                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow transition-all flex-shrink-0 ${
                                                isIngesting 
                                                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed animate-pulse border border-slate-250' 
                                                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-100'
                                            }`}
                                        >
                                            {isIngesting ? '情報収集処理中...' : '最新情報を取得 🔄'}
                                        </button>
                                    </div>

                                    {/* 凡例 (Legend) */}
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[9px] text-slate-450 bg-white border border-slate-200 px-3 py-2 rounded-lg">
                                        <span className="font-bold text-slate-500">一覧カラーバー凡例:</span>
                                        <span className="flex items-center gap-1"><span className="w-2.5 h-1.5 rounded-sm bg-pink-500 inline-block" /> 未読/優先度：高 (重要)</span>
                                        <span className="flex items-center gap-1"><span className="w-2.5 h-1.5 rounded-sm bg-indigo-500 inline-block" /> 未読/優先度：中以下</span>
                                        <span className="flex items-center gap-1"><span className="w-2.5 h-1.5 rounded-sm bg-slate-200 inline-block" /> 評価済み (さばき完了)</span>
                                    </div>

                                    {feed.length === 0 ? (
                                        <div className="text-center py-16 bg-white border border-slate-200 rounded-lg">
                                            <p className="text-slate-400 text-xs font-medium">現在、収集されたフィード記事はありません。</p>
                                            <p className="text-slate-500 text-[10px] mt-0.5">収集バッチが実行されると、ここに関連情報が厳選されて並びます。</p>
                                        </div>
                                    ) : (
                                        /* 2行スリムカードに拡張されたフィードリスト */
                                        <div className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
                                            {feed.map((item, index) => {
                                                const isRead = item.read_status === 'READ';
                                                const hasEval = !!item.user_evaluations;
                                                const isExpanded = expandedFeedId === item.id;
                                                const prio = item.priority_score || 3;

                                                // 左端重要度カラーバー
                                                // 未評価で重要度(>=4)ならピンク（要チェック）、それ以外はインディゴ、評価済みはライトグレー
                                                const leftBarColor = hasEval 
                                                    ? 'bg-slate-200' 
                                                    : (prio >= 4 ? 'bg-pink-500' : 'bg-indigo-500');

                                                return (
                                                    <div 
                                                        key={item.id} 
                                                        className={`border-b border-slate-100 last:border-b-0 transition-all duration-200 ${
                                                            isRead 
                                                                ? 'bg-slate-50/40 opacity-75' 
                                                                : 'bg-white hover:bg-slate-50/30'
                                                        }`}
                                                    >
                                                        {/* ヘッダー部分（クリックでアコーディオン開閉） */}
                                                        <div 
                                                            onClick={() => setExpandedFeedId(isExpanded ? null : item.id)}
                                                            className="relative pl-4 pr-3 py-3 flex flex-col gap-1.5 cursor-pointer select-none"
                                                        >
                                                            {/* 左端カラーバー */}
                                                            <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${leftBarColor}`} />

                                                            {/* 1行目: ソース, 発信日, 優先度(星), 関連タグ */}
                                                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-550">
                                                                <span className="text-[9px] font-extrabold bg-indigo-50 border border-indigo-150 text-indigo-700 px-1.5 py-0.2 rounded-md">
                                                                    {item.source}
                                                                </span>
                                                                <span className="font-mono text-slate-400">
                                                                    {formatDate(item.published_at || item.created_at)}
                                                                </span>
                                                                
                                                                {/* 優先度の星表示 */}
                                                                <div className="flex items-center text-amber-500 font-bold ml-1" title={`優先度スコア: ${prio}/5`}>
                                                                    {[...Array(5)].map((_, i) => (
                                                                        <span key={i} className="text-[10px]">
                                                                            {i < prio ? '★' : '☆'}
                                                                        </span>
                                                                    ))}
                                                                </div>

                                                                {/* 関連トピックタグ */}
                                                                <div className="flex flex-wrap gap-1 ml-auto">
                                                                    {item.related_topics && item.related_topics.slice(0, 3).map(t => (
                                                                        <span key={t} className="text-[8px] font-bold text-indigo-650 border border-indigo-100 bg-indigo-50 px-1.5 py-0.2 rounded">
                                                                            {t}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>

                                                            {/* 2行目: 記事タイトル + 直接外部リンク + 操作ボタン */}
                                                            <div className="flex items-start justify-between gap-3">
                                                                <div className="flex items-center gap-1.5 min-w-0">
                                                                    <h3 className={`font-extrabold text-xs sm:text-sm hover:text-indigo-600 transition-colors truncate ${
                                                                        isRead ? 'text-slate-500 font-semibold' : 'text-slate-800'
                                                                    }`}>
                                                                        {item.title}
                                                                    </h3>
                                                                    <a 
                                                                        href={item.url} 
                                                                        target="_blank" 
                                                                        rel="noopener noreferrer" 
                                                                        className="text-slate-450 hover:text-indigo-600 p-0.5 text-xs flex-shrink-0"
                                                                        onClick={e => e.stopPropagation()}
                                                                        title="元の記事を開く 🔗"
                                                                    >
                                                                        🔗
                                                                    </a>
                                                                </div>

                                                                {/* 操作系 (音声、開閉) */}
                                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            currentPlayingFeedId === item.id ? stopSpeaking() : startSpeaking(item);
                                                                        }}
                                                                        className={`px-2 py-0.5 rounded text-[9px] font-bold flex items-center gap-0.5 transition-all ${
                                                                            currentPlayingFeedId === item.id 
                                                                                ? 'bg-rose-500 text-white animate-pulse' 
                                                                                : 'bg-slate-100 hover:bg-slate-200 text-indigo-655 border border-slate-200'
                                                                        }`}
                                                                    >
                                                                        {currentPlayingFeedId === item.id ? '停止 ⏹️' : '聴く 🔊'}
                                                                    </button>
                                                                    <span className="text-slate-400 hover:text-slate-650 text-[10px] cursor-pointer">
                                                                        {isExpanded ? '▲ 閉じる' : '▼ 要約'}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {/* 新メタデータバッジ行 */}
                                                            {(item.author || item.read_time || item.target_level || item.benefit) && (
                                                                <div className="flex flex-wrap gap-1.5 text-[9px] mt-1" onClick={e => e.stopPropagation()}>
                                                                    {item.author && (
                                                                        <span className="bg-slate-100 border border-slate-200 text-slate-650 px-1.5 py-0.5 rounded flex items-center gap-1" title="著者/発信元">
                                                                            <span>✍️</span>
                                                                            <span>{item.author}</span>
                                                                        </span>
                                                                    )}
                                                                    {item.read_time && (
                                                                        <span className="bg-indigo-50 border border-indigo-100 text-indigo-750 px-1.5 py-0.5 rounded flex items-center gap-1" title="想定読了時間">
                                                                            <span>⏱️</span>
                                                                            <span>{item.read_time}</span>
                                                                        </span>
                                                                    )}
                                                                    {item.target_level && (
                                                                        <span className="bg-emerald-50 border border-emerald-250 text-emerald-800 px-1.5 py-0.5 rounded flex items-center gap-1" title="対象者レベル">
                                                                            <span>🎓</span>
                                                                            <span>{item.target_level}</span>
                                                                        </span>
                                                                    )}
                                                                    {item.benefit && (
                                                                        <span className="bg-amber-50 border border-amber-250 text-amber-800 px-1.5 py-0.5 rounded flex items-center gap-1 truncate max-w-[250px] sm:max-w-[400px]" title={`得られるベネフィット: ${item.benefit}`}>
                                                                            <span>💡</span>
                                                                            <span>{item.benefit}</span>
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* 3行目: AIおすすめの理由 */}
                                                            {item.recommendation_reason && (
                                                                <div className="text-[11px] text-slate-550 bg-slate-50 border border-slate-100/50 rounded px-2 py-1 mt-1.5">
                                                                    💡 <strong>おすすめ理由:</strong> {item.recommendation_reason}
                                                                </div>
                                                            )}

                                                            {/* 4行目: インライン直接評価（さばき）ボタン */}
                                                            <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-slate-100/30" onClick={e => e.stopPropagation()}>
                                                                <div className="text-[10px]">
                                                                    {hasEval ? (
                                                                        <span className={`font-bold text-[9px] px-1.5 py-0.5 rounded border ${
                                                                            item.user_evaluations.is_known && item.user_evaluations.is_interested ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                                            !item.user_evaluations.is_known && item.user_evaluations.is_interested ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                                                            'bg-slate-100 text-slate-600 border-slate-250'
                                                                        }`}>
                                                                            仕分け済: {item.user_evaluations.is_known && item.user_evaluations.is_interested ? '👍 既知・関心あり' :
                                                                                     !item.user_evaluations.is_known && item.user_evaluations.is_interested ? '🔥 未知・関心あり' :
                                                                                     '❄️ 既知・関心なし'}
                                                                        </span>
                                                                    ) : (
                                                                        <div className="flex flex-wrap gap-1.5 items-center">
                                                                            <span className="text-[9px] text-slate-450 font-bold">この情報をさばく:</span>
                                                                            <button
                                                                                onClick={() => handleEvaluate(item.id, true, true, 'PRACTICAL')}
                                                                                className="bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded text-[9px] font-bold transition-all"
                                                                            >
                                                                                👍 知ってた・興味あり
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleEvaluate(item.id, false, true, 'PRACTICAL')}
                                                                                className="bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 px-2 py-0.5 rounded text-[9px] font-bold transition-all"
                                                                            >
                                                                                🔥 知らない・興味あり
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleEvaluate(item.id, true, false, 'BASIC')}
                                                                                className="bg-slate-100 hover:bg-slate-200 border border-slate-250 text-slate-600 px-2 py-0.5 rounded text-[9px] font-bold transition-all"
                                                                            >
                                                                                ❄️ 既知・興味なし
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* アコーディオンの中身（詳細要約 ＋ Mermaid & AI画像） */}
                                                        {isExpanded && (
                                                            <div className="p-4 bg-slate-50/70 border-t border-slate-150 animate-in fade-in duration-150">
                                                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5" onClick={e => e.stopPropagation()}>
                                                                    {/* 左カラム: 構造化サマリテキスト */}
                                                                    <div className="lg:col-span-7 space-y-3">
                                                                        <div className="dab-markdown text-slate-700 text-xs leading-relaxed">
                                                                            <ReactMarkdown>{item.summary ? item.summary.replace(/\\n/g, '\n') : ''}</ReactMarkdown>
                                                                        </div>

                                                                        {/* Imagen試験生成ゾーン */}
                                                                        <div className="pt-2 border-t border-slate-100">
                                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                                <button
                                                                                    onClick={() => handleTestImagen(item)}
                                                                                    disabled={imagenLoadingId === item.id}
                                                                                    className={`px-2.5 py-1 rounded-lg text-[9px] font-bold flex items-center gap-1.5 border transition-all ${
                                                                                        imagenLoadingId === item.id
                                                                                            ? 'bg-violet-50 border-violet-200 text-violet-400 animate-pulse cursor-not-allowed'
                                                                                            : 'bg-violet-50 border-violet-200 text-violet-700 hover:bg-violet-100'
                                                                                    }`}
                                                                                >
                                                                                    {imagenLoadingId === item.id ? (
                                                                                        <><span className="animate-spin">🔄</span> 生成中（5〜10秒）...</>
                                                                                    ) : (
                                                                                        <><span>🎨</span> Imagen 3 試験生成</>
                                                                                    )}
                                                                                </button>
                                                                                <span className="text-[8px] text-slate-400">≈$0.02/枚 • imagen-3.0-fast • 評価用</span>
                                                                                {imagenResults[item.id] && (
                                                                                    <button
                                                                                        onClick={() => setImagenResults(prev => { const n = {...prev}; delete n[item.id]; return n; })}
                                                                                        className="text-[8px] text-slate-400 hover:text-rose-500 transition-colors"
                                                                                    >
                                                                                        ✕ 閉じる
                                                                                    </button>
                                                                                )}
                                                                            </div>

                                                                            {/* 生成された概念画像プレビュー */}
                                                                            {imagenResults[item.id] && (
                                                                                <div className="mt-2 space-y-1">
                                                                                    <p className="text-[8px] text-violet-600 font-bold uppercase tracking-widest">🎨 Imagenプレビュー（評価用）</p>
                                                                                    <div className="overflow-hidden rounded-xl border-2 border-violet-200 shadow-md">
                                                                                        <img
                                                                                            src={imagenResults[item.id]}
                                                                                            alt="Imagen 3 generated concept"
                                                                                            className="w-full h-auto object-cover max-h-48"
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* 右カラム: ビジュアルパーツ（Mermaid ＋ スライドカード） */}
                                                                    {((showMermaid && item.mermaid_code) || showAiImage) && (
                                                                        <div className="lg:col-span-5 space-y-4">
                                                                            {/* Mermaid図解 */}
                                                                            {showMermaid && item.mermaid_code && (
                                                                                <div className="space-y-1.5">
                                                                                    <h4 className="text-[10px] font-bold text-slate-450 uppercase tracking-widest pl-1">
                                                                                        📊 構造・関係図解 (Mermaid)
                                                                                    </h4>
                                                                                    <MermaidRenderer chart={item.mermaid_code} />
                                                                                </div>
                                                                            )}

                                                                            {/* 記事サマリのスライドカード（内容直結・コストゼロ） */}
                                                                            {showAiImage && (
                                                                                <div className="space-y-1.5">
                                                                                    <h4 className="text-[10px] font-bold text-slate-450 uppercase tracking-widest pl-1">
                                                                                        📑 スライドカード
                                                                                    </h4>
                                                                                    <SlideCard item={item} />
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
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
                                <div className="space-y-4 animate-in fade-in duration-200">
                                    {/* 表示・非表示設定 (Mermaid, AI画像) */}
                                    <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
                                        <div>
                                            <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                                ⚙️ キャッチアップフィード表示設定
                                            </h3>
                                            <p className="text-[9px] text-slate-400 mt-0.5">アコーディオン展開時に表示するビジュアルパーツを設定します。</p>
                                        </div>
                                        <div className="flex flex-col gap-3 pt-1">
                                            {/* Mermaid設定 */}
                                            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 last:border-b-0 last:pb-0">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-xs font-bold text-slate-700">📊 構造・関係図解 (Mermaid.js)</span>
                                                    <span className="text-[9px] text-slate-400">記事の内容から自動生成された構成図をダイアグラム表示します。</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleMermaid(!showMermaid)}
                                                    className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 ${
                                                        showMermaid ? 'bg-indigo-600' : 'bg-slate-300'
                                                    }`}
                                                >
                                                    <span className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform ${
                                                        showMermaid ? 'translate-x-4' : 'translate-x-0'
                                                    }`} />
                                                </button>
                                            </div>

                                            {/* スライドカード設定 */}
                                            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 last:border-b-0 last:pb-0">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-xs font-bold text-slate-700">📑 スライドカード表示</span>
                                                    <span className="text-[9px] text-slate-450">記事のサマリから自動生成するスライド風の視覚カードを表示します（追加コスト¥0）。</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleAiImage(!showAiImage)}
                                                    className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 ${
                                                        showAiImage ? 'bg-indigo-600' : 'bg-slate-300'
                                                    }`}
                                                >
                                                    <span className={`w-4 h-4 rounded-full bg-white shadow-sm transform transition-transform ${
                                                        showAiImage ? 'translate-x-4' : 'translate-x-0'
                                                    }`} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                    {/* プレビュー中警告 */}
                                    {(previewPrompt || previewFilterPrompt) && (
                                        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg flex items-center justify-between">
                                            <div>
                                                <h4 className="font-bold text-amber-800 text-xs">⚠️ プロンプトの修正案をプレビュー中</h4>
                                                <p className="text-slate-500 text-[10px] mt-0.5">
                                                    右側のAIチャットで指示されたプロンプト案を表示しています。確定するまで適用されません。
                                                </p>
                                            </div>
                                            <div className="flex gap-2">
                                                {previewPrompt && (
                                                    <>
                                                        <button 
                                                            onClick={handleCancelPrompt} 
                                                            className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-0.5 rounded text-[10px] font-semibold"
                                                        >
                                                            要約キャンセル
                                                        </button>
                                                        <button 
                                                            onClick={handleCommitPrompt} 
                                                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-0.5 rounded text-[10px] font-semibold shadow"
                                                        >
                                                            要約確定
                                                        </button>
                                                    </>
                                                )}
                                                {previewFilterPrompt && (
                                                    <>
                                                        <button 
                                                            onClick={handleCancelFilterPrompt} 
                                                            className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-0.5 rounded text-[10px] font-semibold"
                                                        >
                                                            フィルタキャンセル
                                                        </button>
                                                        <button 
                                                            onClick={handleCommitFilterPrompt} 
                                                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-0.5 rounded text-[10px] font-semibold shadow"
                                                        >
                                                            フィルタ確定
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* 要約プロンプト設定 */}
                                    <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm space-y-2.5">
                                        <div>
                                            <h3 className="text-xs font-bold text-slate-800">📄 要約プロンプト設定</h3>
                                            <p className="text-[9px] text-slate-400 mt-0.5">記事収集時に、Geminiがコンサルタント用の構造化サマリを生成する指示文です。</p>
                                        </div>
                                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-[10px] text-slate-700 h-64 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                                            {previewPrompt ? previewPrompt.proposed_prompt : (memory?.summary_prompt_template || '要約プロンプトがありません')}
                                        </div>
                                    </div>

                                    {/* ノイズフィルタプロンプト設定 */}
                                    <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm space-y-2.5">
                                        <div>
                                            <h3 className="text-xs font-bold text-slate-800">🛡️ ノイズフィルタプロンプト設定</h3>
                                            <p className="text-[9px] text-slate-400 mt-0.5">Zennなどの全件フィードから、無関係なプログラミング言語TipsなどをAI除外する仕分け指示文です。</p>
                                        </div>
                                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 font-mono text-[10px] text-slate-700 h-64 overflow-y-auto leading-relaxed whitespace-pre-wrap">
                                            {previewFilterPrompt ? previewFilterPrompt.proposed_prompt : (memory?.filter_prompt_template || DEFAULT_FILTER_PROMPT)}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* モバイル時のオーバーレイ背景 */}
            {isChatOpen && isMobile && (
                <div 
                    className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity duration-300"
                    onClick={() => setIsChatOpen(false)}
                />
            )}

            {/* AI壁打ちサイドバー (右側) - レスポンシブ＆トグル制御 */}
            {isChatOpen && (
                <div className={`${
                    isMobile 
                        ? 'fixed top-0 right-0 h-full w-[85%] max-w-[400px] z-50 shadow-2xl border-l'
                        : 'w-96 flex-none border-l'
                } bg-slate-100 border-slate-200 flex flex-col h-full animate-in slide-in-from-right duration-200`}>
                    
                    {/* サイドバーヘッダー */}
                    <div className="p-3 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                        <h2 className="font-bold text-xs text-slate-700 flex items-center gap-1.5">
                            💬 AIアシスタント (壁打ち)
                        </h2>
                        
                        {/* モバイルのみ閉じるボタン */}
                        {isMobile && (
                            <button 
                                onClick={() => setIsChatOpen(false)}
                                className="text-slate-400 hover:text-slate-650 p-1 font-mono text-sm"
                            >
                                ✕
                            </button>
                        )}

                        {/* 編集モード切り替え */}
                        <div className="flex bg-slate-200 p-0.5 rounded-lg border border-slate-300">
                            <button
                                onClick={() => {
                                    setChatMode('topics');
                                    setActiveTab('topics');
                                }}
                                className={`px-1.5 py-0.5 text-[8px] font-bold rounded-md transition-all ${chatMode === 'topics' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-800'}`}
                            >
                                トピック
                            </button>
                            <button
                                onClick={() => {
                                    setChatMode('prompt');
                                    setActiveTab('settings');
                                }}
                                className={`px-1.5 py-0.5 text-[8px] font-bold rounded-md transition-all ${chatMode === 'prompt' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-800'}`}
                            >
                                要約プロンプト
                            </button>
                            <button
                                onClick={() => {
                                    setChatMode('filter');
                                    setActiveTab('settings');
                                }}
                                className={`px-1.5 py-0.5 text-[8px] font-bold rounded-md transition-all ${chatMode === 'filter' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-800'}`}
                            >
                                フィルタ
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
                    {(pendingChanges || previewPrompt || previewFilterPrompt) && (
                        <div className="p-2.5 bg-amber-50 border-t border-b border-amber-200 text-center">
                            <span className="text-[9px] text-amber-700 font-bold block animate-bounce">
                                ⚠️ 変更プレビュー中
                            </span>
                            <div className="flex gap-2 justify-center mt-1.5">
                                <button 
                                    onClick={
                                        chatMode === 'topics' ? handleCancelChanges : 
                                        chatMode === 'prompt' ? handleCancelPrompt : 
                                        handleCancelFilterPrompt
                                    }
                                    className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-[9px] font-semibold px-2 py-1 rounded"
                                >
                                    キャンセル
                                </button>
                                <button 
                                    onClick={
                                        chatMode === 'topics' ? handleCommitChanges : 
                                        chatMode === 'prompt' ? handleCommitPrompt : 
                                        handleCommitFilterPrompt
                                    }
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
                                placeholder={
                                    chatMode === 'topics' ? '例: データリネージを追加して...' : 
                                    chatMode === 'prompt' ? '例: コンサル示唆をより詳細にして...' :
                                    '例: React関係のトピックを除外して...'
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
            )}
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

