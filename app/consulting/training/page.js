"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import MobileMenuButton from "../../../components/MobileMenuButton";

export default function MtgTrainingPage() {
    const [tasks, setTasks] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    
    // UI 状態
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [showCompleted, setShowCompleted] = useState(false);
    const [expandedTopicIdx, setExpandedTopicIdx] = useState(null);

    const getStatusLabel = (status) => status === 2 ? "完了" : "未完了";
    const getStatusColor = (status) => status === 2
        ? "bg-green-100 text-green-700 border-green-200"
        : "bg-amber-100 text-amber-700 border-amber-200";

    // 初期ロード
    useEffect(() => {
        fetchTasks();
        const handleResize = () => {
            if (window.innerWidth < 1024) {
                setIsSidebarOpen(false);
            } else {
                setIsSidebarOpen(true);
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const fetchTasks = async () => {
        try {
            const res = await fetch("/api/consulting/training");
            if (res.ok) {
                const data = await res.json();
                setTasks(data);
            }
        } catch (error) {
            console.error("Failed to fetch training tasks", error);
        }
    };

    const handleToggleStatus = async (task, e) => {
        e.stopPropagation();
        const currentStatus = task.status || 0;
        const newStatus = currentStatus === 2 ? 0 : 2;

        try {
            const res = await fetch(`/api/consulting/training/${task.id}/status?status=${newStatus}`, {
                method: "PATCH"
            });
            if (res.ok) {
                setTasks(tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
                if (selectedTask?.id === task.id) {
                    setSelectedTask({ ...selectedTask, status: newStatus });
                }
            }
        } catch (error) {
            console.error("Failed to update status", error);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        setProgress("アップロードの初期化中...");

        try {
            let contentType = file.type;
            if (!contentType) {
                const ext = file.name.split('.').pop().toLowerCase();
                if (['mp4', 'm4v', 'mov', '3gp', 'mkv', 'avi'].includes(ext)) contentType = 'video/mp4';
                else if (['mp3', 'mpeg'].includes(ext)) contentType = 'audio/mpeg';
                else if (ext === 'wav') contentType = 'audio/wav';
                else if (ext === 'm4a' || ext === 'aac') contentType = 'audio/mp4';
                else if (ext === 'webm') contentType = 'video/webm';
                else if (ext === 'amr') contentType = 'audio/amr';
                else contentType = 'application/octet-stream';
            }

            // GCS オブジェクト名クリーンアップを含む署名付きURLを取得
            const urlRes = await fetch(`/api/consulting/upload-url?filename=${encodeURIComponent(file.name)}&content_type=${encodeURIComponent(contentType)}`);
            if (!urlRes.ok) throw new Error("アップロードURLの取得に失敗しました");
            const { upload_url, gcs_path } = await urlRes.json();

            setProgress("録音データをアップロード中...");
            const uploadRes = await fetch(upload_url, {
                method: "PUT",
                headers: { "Content-Type": contentType },
                body: file,
            });
            if (!uploadRes.ok) {
                throw new Error("GCSへのアップロードに失敗しました");
            }

            setProgress("Geminiによる会話能力の定量解析中... (数分かかる場合があります)");
            const reviewRes = await fetch("/api/consulting/training/review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    media_filename: file.name,
                    gcs_path: gcs_path
                }),
            });

            if (reviewRes.ok) {
                const newTask = await reviewRes.json();
                setTasks([newTask, ...tasks]);
                setSelectedTask(newTask);
                setIsCreating(false);
                if (window.innerWidth < 768) {
                    setIsSidebarOpen(false);
                }
            } else {
                const errDetail = await reviewRes.text();
                throw new Error(`解析エラー: ${errDetail}`);
            }
        } catch (error) {
            console.error("Process Failed:", error);
            alert("処理に失敗しました: " + error.message);
        } finally {
            setIsLoading(false);
            setProgress("");
        }
    };

    const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFileUpload({ target: { files: [file] } });
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!confirm("このトレーニング履歴を削除してもよろしいですか？")) return;
        try {
            const res = await fetch(`/api/consulting/training/${id}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setTasks(tasks.filter((t) => t.id !== id));
                if (selectedTask?.id === id) setSelectedTask(null);
            }
        } catch (error) {
            console.error("Failed to delete task", error);
        }
    };

    const scoreMap = {
        clarity: { label: "滑舌と明瞭さ", desc: "もごもごせず聞き取りやすいか" },
        filler: { label: "フィラー抑制", desc: "あの、ええと等の雑音の少なさ" },
        synthesis: { label: "要約・咀嚼力", desc: "相手の話を理解し要約できているか" },
        logic: { label: "論理的構成力", desc: "結論ファーストで簡潔であるか" },
        empathy: { label: "対話態度と配慮", desc: "クッション言葉等による信頼形成" }
    };

    return (
        <div className="flex h-full bg-gray-50 text-slate-800 font-sans overflow-hidden">
            {/* モバイル用サイドバー背景 */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/40 z-30 lg:hidden backdrop-blur-xs"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* 左側履歴サイドバー (ライトテーマ化) */}
            <div className={`
                fixed inset-y-0 left-0 z-40 bg-white h-full transform transition-all duration-300 ease-in-out shadow-2xl lg:shadow-none
                lg:relative lg:translate-x-0
                ${isSidebarOpen ? "translate-x-0 w-80 border-r border-gray-200" : "-translate-x-full lg:w-0 lg:border-none"} 
                flex flex-col overflow-hidden flex-shrink-0
            `}>
                <div className="w-80 flex flex-col h-full">
                    <div className="p-4 border-b border-gray-200 bg-gray-50 flex flex-col flex-shrink-0">
                        <div className="flex justify-between items-center mb-2">
                            <h2 className="text-base font-bold text-cyan-700 tracking-wide flex items-center">
                                <span className="mr-2">🏋️</span> MTG Training
                            </h2>
                            <Link href="/consulting/training/settings" className="text-slate-600 hover:text-cyan-600 transition-colors text-xs flex items-center bg-white px-2.5 py-1 rounded-full border border-gray-300 shadow-xs">
                                <span className="mr-1">⚙️</span> 設定
                            </Link>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                            <p className="text-xs text-slate-500">会話能力の定量トレーニング</p>
                            <label className="flex items-center cursor-pointer text-xs text-slate-500">
                                <input
                                    type="checkbox"
                                    checked={showCompleted}
                                    onChange={(e) => setShowCompleted(e.target.checked)}
                                    className="mr-1 rounded border-gray-300 checked:bg-cyan-600 text-cyan-600"
                                />
                                完了分を表示
                            </label>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        {tasks.filter(t => showCompleted ? true : (t.status || 0) < 2).map((task) => (
                            <div
                                key={task.id}
                                onClick={() => {
                                    setSelectedTask(task);
                                    setIsCreating(false);
                                    setExpandedTopicIdx(null);
                                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                                }}
                                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-cyan-50/50 transition-all group relative
                                    ${selectedTask?.id === task.id ? "bg-cyan-50 border-l-4 border-cyan-500" : ""}
                                `}
                            >
                                <div className="flex justify-between items-start">
                                    <h3 className="font-semibold text-sm text-slate-700 line-clamp-1 group-hover:text-cyan-700 transition-colors">{task.media_filename}</h3>
                                    <button
                                        onClick={(e) => handleDelete(task.id, e)}
                                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2 text-base"
                                    >
                                        ×
                                    </button>
                                </div>
                                <div className="flex justify-between items-center mt-2">
                                    <p className="text-xs text-gray-400">
                                        {new Date(task.created_at).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })}
                                    </p>
                                    <button
                                        onClick={(e) => handleToggleStatus(task, e)}
                                        className={`px-2 py-0.5 rounded-full border text-[10px] font-bold tracking-wider transition-all ${getStatusColor(task.status || 0)}`}
                                    >
                                        {getStatusLabel(task.status || 0)}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* メインコンテンツ */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
                {/* ヘッダー */}
                <div className="flex items-center p-3.5 border-b border-gray-200 justify-between flex-shrink-0 bg-white z-10">
                    <div className="flex items-center gap-3">
                        <MobileMenuButton />
                        <button
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className="hidden lg:block p-2 rounded-lg hover:bg-gray-100 text-slate-400 hover:text-cyan-600 transition-all"
                            title={isSidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"}
                        >
                            {isSidebarOpen ? "◀" : "▶"}
                        </button>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="flex items-center space-x-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-medium px-4 py-2 rounded-full shadow-md hover:shadow-cyan-500/10 transition-all text-sm"
                        >
                            <span>＋ トレーニング新規評価</span>
                        </button>
                    </div>

                    <span className="font-semibold text-slate-700 lg:hidden line-clamp-1 max-w-[150px]">
                        {isCreating ? "新規評価" : selectedTask ? selectedTask.media_filename : "評価ダッシュボード"}
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto relative p-4 sm:p-8 bg-gray-50">
                    {isCreating ? (
                        <div className="flex items-center justify-center min-h-[70vh]">
                            <div className="w-full max-w-lg bg-white p-6 sm:p-10 rounded-2xl shadow-xl border border-gray-200 text-center">
                                <h3 className="text-2xl font-bold mb-4 bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">音声データのアップロード</h3>
                                <p className="text-slate-500 text-sm mb-6">
                                    コンサルタントとしての明瞭さ、フィラー、咀嚼力をAIが定量分析します。<br />
                                    会議の録音ファイル（MP3, M4A, WAV等）を選択してください。
                                </p>
                                <div className="mb-8">
                                    <label
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                        className={`flex flex-col items-center px-4 py-12 rounded-xl border-2 border-dashed cursor-pointer transition-all
                                        ${isDragging 
                                            ? "bg-cyan-50 border-cyan-400 scale-102" 
                                            : "border-gray-300 hover:border-cyan-500 hover:bg-cyan-50/30"}
                                    `}
                                    >
                                        <span className="text-4xl mb-3">🎙️</span>
                                        <span className="text-base leading-normal text-slate-600 font-semibold">
                                            {isDragging ? "ファイルをドロップ" : "ファイルをドラッグ＆ドロップまたはクリック"}
                                        </span>
                                        <span className="text-xs text-slate-400 mt-2">MP3, M4A, WAV, MP4など (最大2GB)</span>
                                        <input type="file" accept="video/*,audio/*" className="hidden" onChange={handleFileUpload} />
                                    </label>
                                </div>
                                {isLoading && (
                                    <div className="space-y-4">
                                        <div className="text-cyan-600 font-semibold animate-pulse text-sm">{progress}</div>
                                        <div className="w-full bg-gray-100 rounded-full h-2">
                                            <div className="bg-gradient-to-r from-cyan-500 to-blue-600 h-2 rounded-full animate-progress-indeterminate"></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : selectedTask ? (
                        <div className="max-w-4xl mx-auto space-y-8 pb-16">
                            {/* ヘッダータイトル */}
                            <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-200 pb-4">
                                <div>
                                    <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 tracking-wide">{selectedTask.media_filename}</h1>
                                    <p className="text-xs text-slate-500 mt-1">
                                        評価日時: {new Date(selectedTask.created_at).toLocaleString("ja-JP")}
                                    </p>
                                </div>
                                <button
                                    onClick={(e) => handleToggleStatus(selectedTask, e)}
                                    className={`mt-3 md:mt-0 px-4 py-1 rounded-full border text-xs font-bold transition-all ${getStatusColor(selectedTask.status || 0)}`}
                                >
                                    ステータス: {getStatusLabel(selectedTask.status || 0)}に変更
                                </button>
                            </div>

                            {/* スコアダッシュボード（プログレスバー） */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm">
                                    <h2 className="text-base font-bold text-slate-800 mb-4 flex items-center">
                                        <span className="mr-2">📊</span> 会話能力レーティング
                                    </h2>
                                    <div className="space-y-4">
                                        {Object.entries(selectedTask.overall_scores || {}).map(([key, val]) => {
                                            const metadata = scoreMap[key] || { label: key, desc: "" };
                                            const percent = (val / 5) * 100;
                                            return (
                                                <div key={key} className="space-y-1">
                                                    <div className="flex justify-between items-end">
                                                        <div>
                                                            <span className="text-xs font-bold text-slate-700">{metadata.label}</span>
                                                            <span className="text-[10px] text-slate-400 ml-1.5">({metadata.desc})</span>
                                                        </div>
                                                        <span className="text-sm font-bold text-cyan-600">{val} <span className="text-[10px] text-slate-400">/ 5</span></span>
                                                    </div>
                                                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                                        <div 
                                                            style={{ width: `${percent}%` }}
                                                            className="bg-gradient-to-r from-cyan-500 to-blue-600 h-full rounded-full transition-all duration-1000"
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm flex flex-col justify-between">
                                    <div>
                                        <h2 className="text-base font-bold text-slate-800 mb-2 flex items-center">
                                            <span className="mr-2">📝</span> 全体総評
                                        </h2>
                                        <div className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">
                                            {selectedTask.overall_feedback}
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-4 border-t border-gray-100 text-[10px] text-slate-400">
                                        ※ この評価は、設定されたルーブリックに基づいてGeminiにより自動定量化されています。
                                    </div>
                                </div>
                            </div>

                            {/* トピック（議論セグメント）ごとの詳細評価 */}
                            <div className="space-y-4">
                                <h2 className="text-lg font-bold text-slate-800 tracking-wide flex items-center">
                                    <span className="mr-2">🎯</span> セグメント・議論トピック別の振り返り
                                </h2>
                                <p className="text-xs text-slate-500">
                                    会議中のどのトピックにおいてどのような発話課題（咀嚼ミス、フィラー頻出など）があったかをセクションごとに確認できます。
                                </p>
                                
                                <div className="space-y-3">
                                    {(selectedTask.topic_evaluations || []).map((topic, idx) => {
                                        const isExpanded = expandedTopicIdx === idx;
                                        return (
                                            <div 
                                                key={idx}
                                                className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-xs transition-all"
                                            >
                                                {/* アコーディオンヘッダー */}
                                                <button
                                                    onClick={() => setExpandedTopicIdx(isExpanded ? null : idx)}
                                                    className="w-full flex justify-between items-center p-4 hover:bg-gray-50 text-left transition-colors"
                                                >
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] font-bold px-2 py-0.5 bg-gray-100 text-slate-500 rounded-full">
                                                                {topic.time_range}
                                                            </span>
                                                            <h3 className="font-bold text-slate-700 text-sm">{topic.topic_title}</h3>
                                                        </div>
                                                        <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                                                            {topic.summary}
                                                        </p>
                                                    </div>
                                                    <span className="text-slate-400 text-xs">
                                                        {isExpanded ? "▲ 閉じる" : "▼ 詳細を表示"}
                                                    </span>
                                                </button>

                                                {/* アコーディオンボディ */}
                                                {isExpanded && (
                                                    <div className="p-5 border-t border-gray-150 space-y-4 bg-gray-50/50">
                                                        {/* 各項目のスコア */}
                                                        <div>
                                                            <span className="text-[10px] font-bold text-slate-400 block mb-2">このトピックのスコア:</span>
                                                            <div className="flex flex-wrap gap-2.5">
                                                                {Object.entries(topic.scores || {}).map(([sKey, sVal]) => {
                                                                    const lbl = scoreMap[sKey]?.label || sKey;
                                                                    return (
                                                                        <div key={sKey} className="bg-white px-2.5 py-1 rounded-lg border border-gray-200 text-xs flex items-center shadow-xs">
                                                                            <span className="text-slate-500">{lbl}: </span>
                                                                            <span className="font-bold text-cyan-600 ml-1.5">{sVal}点</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>

                                                        {/* フィードバック詳細 */}
                                                        <div className="space-y-1">
                                                            <span className="text-[10px] font-bold text-slate-400 block">トピック評価・改善点:</span>
                                                            <p className="text-xs text-slate-600 leading-relaxed">
                                                                {topic.feedback}
                                                            </p>
                                                        </div>

                                                        {/* 具体的な発言の引用 */}
                                                        {(topic.evidence_quotes || []).length > 0 && (
                                                            <div className="space-y-1.5">
                                                                <span className="text-[10px] font-bold text-slate-400 block">実際のやり取り・発言引用（エビデンス）:</span>
                                                                <div className="space-y-1">
                                                                    {topic.evidence_quotes.map((quote, qIdx) => (
                                                                        <div key={qIdx} className="bg-cyan-50 border-l-3 border-cyan-400 p-2.5 rounded-r text-xs text-slate-600 italic whitespace-pre-wrap">
                                                                            "{quote}"
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* フィラータイムライン */}
                            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm">
                                <h2 className="text-base font-bold text-slate-800 mb-3 flex items-center">
                                    <span className="mr-2">🚨</span> 検出されたフィラー（口癖・雑音）一覧
                                </h2>
                                <p className="text-xs text-slate-500 mb-4">
                                    会話内で発生した「あの」「ええと」「ちょっと」などのフィラーを特定しました。無意識の口癖を意識的にコントロールするのに活用してください。
                                </p>
                                
                                {(selectedTask.detected_fillers || []).length > 0 ? (
                                    <div className="max-h-60 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                                        {selectedTask.detected_fillers.map((item, fIdx) => (
                                            <div key={fIdx} className="flex items-start gap-3 p-2.5 rounded-lg bg-gray-50 border border-gray-200 text-xs">
                                                <span className="bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded font-mono font-bold flex-shrink-0">
                                                    {item.timestamp || "検出"}
                                                </span>
                                                <div className="flex-1">
                                                    <span className="text-slate-400">フィラー: </span>
                                                    <span className="font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded mr-2">
                                                        {item.filler_word}
                                                    </span>
                                                    <div className="text-slate-600 italic mt-1.5 whitespace-pre-wrap">
                                                        "...{item.context}..."
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-6 text-slate-400 text-sm">
                                        フィラーは検出されませんでした！素晴らしい発話コントロールです。
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center min-h-[60vh] text-slate-400">
                            <div className="text-center bg-white border border-gray-200 p-8 rounded-2xl max-w-md shadow-xs">
                                <p className="text-5xl mb-4">🏋️</p>
                                <p className="text-lg font-bold text-slate-700 mb-2">評価履歴がありません</p>
                                <p className="text-xs text-slate-400 mb-6">
                                    MTGの録音データをアップロードして、会話能力の定量評価を開始してください。
                                </p>
                                <button
                                    onClick={() => setIsCreating(true)}
                                    className="bg-cyan-600 hover:bg-cyan-700 text-white px-5 py-2 rounded-full text-xs font-semibold shadow-md transition-all"
                                >
                                    最初の評価を開始する
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
