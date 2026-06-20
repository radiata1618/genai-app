"use client";
import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import MobileMenuButton from "../../../components/MobileMenuButton";

function MtgTrainingPageContent() {
    const searchParams = useSearchParams();
    const taskIdParam = searchParams.get("taskId");

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
    const [activeTab, setActiveTab] = useState("report");

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

    // クエリパラメータの taskId に基づく自動選択
    useEffect(() => {
        if (taskIdParam && tasks.length > 0) {
            const matchedTask = tasks.find(t => t.id === taskIdParam);
            if (matchedTask) {
                setSelectedTask(matchedTask);
                setIsCreating(false);
                setExpandedTopicIdx(null);
                setActiveTab("report");
                // モバイル表示のときはサイドバーを閉じて詳細を見せる
                if (window.innerWidth < 1024) {
                    setIsSidebarOpen(false);
                }
            }
        }
    }, [tasks, taskIdParam]);

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

    const checklistMap = {
        clarity: [
            { key: "clarity_speed", label: "適切な会話速度" },
            { key: "clarity_ending", label: "語尾の明瞭さ" },
            { key: "clarity_no_mumble", label: "聞き取りやすさ" },
            { key: "clarity_confidence", label: "自信と適切な間" }
        ],
        filler: [
            { key: "filler_low_density", label: "低いフィラー密度 (<1%)" },
            { key: "filler_start", label: "話し始め（文頭）の澱み" },
            { key: "filler_middle", label: "話の引き延ばし防止" },
            { key: "filler_no_bad_habits", label: "不要な口癖の抑制" }
        ],
        synthesis: [
            { key: "synthesis_listening", label: "適切な相槌と復唱" },
            { key: "synthesis_summarize", label: "要点要約後の応答" },
            { key: "synthesis_align", label: "認識ズレの確認" },
            { key: "synthesis_interactive", label: "双方向の対話" }
        ],
        logic: [
            { key: "logic_prep", label: "結論ファースト (PREP)" },
            { key: "logic_reason", label: "明確な論拠提示" },
            { key: "logic_focus", label: "話の脱線防止" },
            { key: "logic_connective", label: "接続詞の論理的接続" }
        ],
        empathy: [
            { key: "empathy_cushion", label: "クッション言葉の活用" },
            { key: "empathy_no_interrupt", label: "遮らずに聞く姿勢" },
            { key: "empathy_polite", label: "自然で正確な敬語" },
            { key: "empathy_safety", label: "心理的安全性への配慮" }
        ]
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
                                    setActiveTab("report");
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
                    <div className="flex items-center gap-3 flex-wrap">
                        <MobileMenuButton />
                        <button
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className="hidden lg:block p-2 rounded-lg hover:bg-gray-100 text-slate-400 hover:text-cyan-600 transition-all"
                            title={isSidebarOpen ? "サイドバーを閉じる" : "サイドバーを開く"}
                        >
                            {isSidebarOpen ? "◀" : "▶"}
                        </button>
                        <button
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 text-slate-500 hover:text-cyan-600 transition-all flex items-center gap-1 text-xs border border-gray-200 bg-white shadow-xs"
                            title={isSidebarOpen ? "履歴を閉じる" : "履歴を表示"}
                        >
                            <span>📊 履歴</span>
                            <span>{isSidebarOpen ? "◀" : "▶"}</span>
                        </button>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="flex items-center space-x-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-medium px-4 py-2 rounded-full shadow-md hover:shadow-cyan-500/10 transition-all text-sm"
                        >
                            <span>＋ トレーニング新規評価</span>
                        </button>
                        <Link
                            href="/consulting/training/live-browser"
                            className="flex items-center space-x-1.5 bg-white border border-gray-300 hover:border-cyan-500 text-slate-600 hover:text-cyan-600 font-medium px-4 py-2 rounded-full shadow-sm transition-all text-sm"
                        >
                            <span>🎙️ リアルタイム監視 (Live)</span>
                        </Link>
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
                    ) : selectedTask ? (() => {
                        const hasTotalScore = selectedTask.total_score !== undefined && selectedTask.total_score !== null;
                        const displayScore = hasTotalScore 
                            ? selectedTask.total_score 
                            : Math.round((Object.values(selectedTask.overall_scores || {}).reduce((a, b) => a + b, 0) / (Object.keys(selectedTask.overall_scores || {}).length || 1)) * 20);

                        return (
                            <div className="max-w-4xl mx-auto space-y-8 pb-16">
                                {/* ヘッダータイトル */}
                                <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-gray-200 pb-4 gap-4">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 tracking-wide">{selectedTask.media_filename}</h1>
                                            <div className="bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold px-3.5 py-1 rounded-full text-xs shadow-md flex items-center gap-1">
                                                <span>総合スコア:</span>
                                                <span className="text-sm">{displayScore}</span>
                                                <span className="text-[10px] opacity-85">/ 100点</span>
                                            </div>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-1.5">
                                            評価日時: {new Date(selectedTask.created_at).toLocaleString("ja-JP")}
                                        </p>
                                    </div>
                                    <button
                                        onClick={(e) => handleToggleStatus(selectedTask, e)}
                                        className={`px-4 py-1 rounded-full border text-xs font-bold transition-all ${getStatusColor(selectedTask.status || 0)}`}
                                    >
                                        ステータス: {getStatusLabel(selectedTask.status || 0)}に変更
                                    </button>
                                </div>

                                {/* タブ切り替え */}
                                <div className="flex border-b border-gray-200">
                                    <button
                                        onClick={() => setActiveTab("report")}
                                        className={`px-6 py-2.5 font-semibold text-sm transition-all border-b-2 -mb-px flex items-center gap-1.5 ${
                                            activeTab === "report"
                                                ? "border-cyan-600 text-cyan-600"
                                                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-gray-300"
                                        }`}
                                    >
                                        <span>📊</span> 分析レポート
                                    </button>
                                    <button
                                        onClick={() => setActiveTab("transcript")}
                                        className={`px-6 py-2.5 font-semibold text-sm transition-all border-b-2 -mb-px flex items-center gap-1.5 ${
                                            activeTab === "transcript"
                                                ? "border-cyan-600 text-cyan-600"
                                                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-gray-300"
                                        }`}
                                    >
                                        <span>📝</span> スクリプト全文
                                    </button>
                                </div>

                                {activeTab === "report" ? (
                                    <>
                                        {/* クイックサマリダッシュボード（プレミアムスタッツカード） */}
                                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                            {/* 総合スコア */}
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                                                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">🏆 総合評価</span>
                                                <div className="flex items-baseline gap-1 mt-2">
                                                    <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-blue-600">{displayScore}</span>
                                                    <span className="text-xs text-slate-400 font-bold">/ 100 点</span>
                                                </div>
                                                <div className="text-[10px] text-slate-500 mt-2 font-medium">
                                                    {displayScore >= 80 ? "卓越したコミュニケーション" : displayScore >= 60 ? "標準的なビジネスレベル" : "要改善（指導推奨）"}
                                                </div>
                                            </div>

                                            {/* フィラー密度メーター */}
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">📊 フィラー密度</span>
                                                    {selectedTask.filler_density !== undefined && (
                                                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${
                                                            selectedTask.filler_density > 2.0 ? 'text-rose-600 bg-rose-50' : 
                                                            selectedTask.filler_density > 1.0 ? 'text-amber-600 bg-amber-50' : 
                                                            'text-emerald-600 bg-emerald-50'
                                                        }`}>
                                                            {selectedTask.filler_density.toFixed(2)} %
                                                        </span>
                                                    )}
                                                </div>
                                                {selectedTask.filler_density !== undefined ? (
                                                    <div className="mt-2">
                                                        <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-150">
                                                            <div 
                                                                style={{ width: `${Math.min(100, selectedTask.filler_density * 20)}%` }} 
                                                                className={`h-full rounded-full transition-all duration-500 ${
                                                                    selectedTask.filler_density > 2.0 ? 'bg-gradient-to-r from-rose-500 to-rose-600' : 
                                                                    selectedTask.filler_density > 1.0 ? 'bg-gradient-to-r from-amber-500 to-amber-600' : 
                                                                    'bg-gradient-to-r from-emerald-400 to-emerald-600'
                                                                }`}
                                                            />
                                                        </div>
                                                        <div className="flex justify-between text-[8px] text-slate-400 mt-1 font-mono">
                                                            <span>0%</span>
                                                            <span>2.5%</span>
                                                            <span>5%+</span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-xs text-slate-400 mt-2">データなし</div>
                                                )}
                                            </div>

                                            {/* 総発話量 */}
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                                                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">🗣️ 推定発話量</span>
                                                <div className="flex items-baseline gap-1 mt-2">
                                                    <span className="text-2xl font-black text-slate-700">
                                                        {selectedTask.total_words_estimate !== undefined ? selectedTask.total_words_estimate : "—"}
                                                    </span>
                                                    <span className="text-xs text-slate-400 font-bold">文字</span>
                                                </div>
                                                <div className="text-[10px] text-slate-500 mt-2 font-medium">
                                                    {selectedTask.total_words_estimate > 1000 ? "十分な会話量" : "やや短い発話量"}
                                                </div>
                                            </div>

                                            {/* 検出フィラー数 */}
                                            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                                                <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">🚨 検出フィラー数</span>
                                                <div className="flex items-baseline gap-1 mt-2">
                                                    <span className={`text-2xl font-black ${
                                                        (selectedTask.detected_fillers || []).length > 10 ? "text-rose-600" :
                                                        (selectedTask.detected_fillers || []).length > 3 ? "text-amber-600" :
                                                        "text-emerald-600"
                                                    }`}>
                                                        {(selectedTask.detected_fillers || []).length}
                                                    </span>
                                                    <span className="text-xs text-slate-400 font-bold">回</span>
                                                </div>
                                                <div className="text-[10px] text-slate-500 mt-2 font-medium">
                                                    口癖の発生頻度
                                                </div>
                                            </div>
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
                                                        
                                                        // 各指標の100点換算スコア
                                                        let metricScore = val * 4;
                                                        if (selectedTask.checklist) {
                                                            const items = checklistMap[key] || [];
                                                            const trueCount = items.filter(item => selectedTask.checklist[item.key] === true).length;
                                                            metricScore = trueCount * 5;
                                                        }

                                                        return (
                                                            <div key={key} className="space-y-2 p-3 rounded-xl border border-gray-100 bg-white shadow-xs">
                                                                <div className="flex justify-between items-end">
                                                                    <div>
                                                                        <span className="text-xs font-bold text-slate-700">{metadata.label}</span>
                                                                        <span className="text-[10px] text-slate-400 ml-1.5">({metadata.desc})</span>
                                                                    </div>
                                                                    <span className="text-xs font-bold text-cyan-600">{metricScore} <span className="text-[10px] text-slate-400">/ 20点</span></span>
                                                                </div>
                                                                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                                                    <div 
                                                                        style={{ width: `${percent}%` }}
                                                                        className="bg-gradient-to-r from-cyan-500 to-blue-600 h-full rounded-full transition-all duration-1000"
                                                                    />
                                                                </div>

                                                                {/* 詳細チェックリスト */}
                                                                {selectedTask.checklist && (
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2 pt-2 border-t border-gray-100 bg-gray-50/50 p-2 rounded-lg text-[10px]">
                                                                        {checklistMap[key]?.map((item) => {
                                                                            const isPassed = selectedTask.checklist[item.key] === true;
                                                                            return (
                                                                                <div key={item.key} className="flex items-center gap-1.5">
                                                                                    <span className={`font-mono font-bold ${isPassed ? "text-green-600" : "text-slate-350"}`}>
                                                                                        {isPassed ? "✓" : "✗"}
                                                                                    </span>
                                                                                    <span className={isPassed ? "text-slate-600 font-medium" : "text-slate-400"}>
                                                                                        {item.label}
                                                                                    </span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
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

                                                {/* 発話量・フィラー密度の追加表示 */}
                                                {selectedTask.total_words_estimate !== undefined && selectedTask.total_words_estimate !== null && selectedTask.total_words_estimate > 0 && (
                                                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
                                                        <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1">
                                                            <span>📊</span> 発話統計・比率分析
                                                        </h3>
                                                        <div className="grid grid-cols-2 gap-3 text-xs bg-cyan-50/20 p-3 rounded-xl border border-cyan-100/50">
                                                            <div className="space-y-0.5">
                                                                <span className="text-[10px] text-slate-400 block">推定総発話量</span>
                                                                <span className="font-bold text-slate-700 text-sm">
                                                                    {selectedTask.total_words_estimate} <span className="text-[10px] font-normal text-slate-400">文字</span>
                                                                </span>
                                                            </div>
                                                            <div className="space-y-0.5">
                                                                <span className="text-[10px] text-slate-400 block">不要なフィラー密度</span>
                                                                <span className={`font-bold text-sm ${selectedTask.filler_density > 2.0 ? "text-amber-600" : "text-cyan-600"}`}>
                                                                    {selectedTask.filler_density.toFixed(2)}%
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

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
                                </>
                            ) : (
                                <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm space-y-4">
                                    <h2 className="text-base font-bold text-slate-800 mb-2 flex items-center">
                                        <span className="mr-2">📝</span> 会話のスクリプト全文（文字起こし）
                                    </h2>
                                    {selectedTask.full_transcript ? (
                                        <div className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap bg-gray-50 p-5 rounded-xl border border-gray-150 max-h-[60vh] overflow-y-auto custom-scrollbar font-sans">
                                            {selectedTask.full_transcript}
                                        </div>
                                    ) : (
                                        <div className="text-center py-10 text-slate-400 text-sm bg-gray-50 rounded-xl border border-dashed border-gray-300">
                                            <p className="text-3xl mb-2">⚠️</p>
                                            <p className="font-semibold">スクリプト全文データがありません</p>
                                            <p className="text-xs text-slate-400 mt-1">
                                                ※この履歴は古いバージョンのシステムで作成されたか、テキストベース評価で作成されたため、文字起こし全文データが含まれていません。
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        );
                    })() : (
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

export default function MtgTrainingPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen bg-gray-50 text-slate-500 text-xs">読み込み中...</div>}>
            <MtgTrainingPageContent />
        </Suspense>
    );
}
