"use client";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MobileMenuButton from "../../../../components/MobileMenuButton";

export default function LiveGeminiPage() {
    const router = useRouter();
    const [isRecording, setIsRecording] = useState(false);
    const [status, setStatus] = useState("idle"); // idle, recording, connecting, error
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [speechHistory, setSpeechHistory] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [latestAlert, setLatestAlert] = useState(null);
    const [volume, setVolume] = useState(0);

    // アップロード用
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [sessionName, setSessionName] = useState("");
    const [uploadProgress, setUploadProgress] = useState("");
    const [showHistoryModal, setShowHistoryModal] = useState(false);

    // 累積統計
    const [stats, setStats] = useState({
        filler: 0,
        clarity: 0,
        roundabout: 0,
        logic: 0,
        total: 0
    });

    const mediaRecorderRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const animationFrameRef = useRef(null);
    const streamRef = useRef(null);
    const intervalRef = useRef(null);
    const chunksRef = useRef([]);
    const shouldRestartRef = useRef(false);
    const timelineEndRef = useRef(null);
    const alertTimelineRef = useRef(null);
    const alertEndRef = useRef(null);
    const transcriptTimelineRef = useRef(null);
    const transcriptEndRef = useRef(null);

    // 全体録音用（2重レコーダー）
    const totalRecorderRef = useRef(null);
    const allAudioChunksRef = useRef([]);

    // 音声検知フラグ（無音・環境ノイズ時のハルシネーション解析防止用）
    const hasSpeechInputRef = useRef(false);

    // 自動スクロール制御
    useEffect(() => {
        if (alerts.length === 0) return;
        alertEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [alerts]);

    useEffect(() => {
        if (speechHistory.length === 0) return;
        transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [speechHistory]);

    // クリーンアップ
    useEffect(() => {
        return () => {
            stopRecording();
        };
    }, []);

    const startRecording = async () => {
        setSpeechHistory([]);
        setAlerts([]);
        setLatestAlert(null);
        setStats({ filler: 0, clarity: 0, roundabout: 0, logic: 0, total: 0 });
        setStatus("connecting");
        chunksRef.current = [];
        allAudioChunksRef.current = [];

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            startVolumeIndicator(stream);

            // サポートされているMIMEタイプの判定
            let mimeType = "audio/webm";
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = "audio/ogg";
                if (!MediaRecorder.isTypeSupported(mimeType)) {
                    mimeType = "audio/mp4";
                    if (!MediaRecorder.isTypeSupported(mimeType)) {
                        mimeType = "";
                    }
                }
            }

            const options = mimeType ? { mimeType } : {};

            // 1. 全体録音レコーダーの起動（途中で止めない）
            const totalRecorder = new MediaRecorder(stream, options);
            totalRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    allAudioChunksRef.current.push(e.data);
                }
            };
            totalRecorderRef.current = totalRecorder;
            totalRecorder.start();

            // 2. 6秒バッファ解析用レコーダーの起動
            const mediaRecorder = new MediaRecorder(stream, options);
            mediaRecorderRef.current = mediaRecorder;

            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
                chunksRef.current = [];

                if (audioBlob.size > 1000) {
                    if (hasSpeechInputRef.current) {
                        analyzeAudioChunk(audioBlob);
                    } else {
                        console.log("Skipping chunk analysis: Silence detected (average volume below threshold)");
                    }
                }

                // 次のバッファ用に音声検知フラグをリセット
                hasSpeechInputRef.current = false;

                if (shouldRestartRef.current) {
                    shouldRestartRef.current = false;
                    try {
                        mediaRecorderRef.current.start();
                    } catch (err) {
                        console.error("Failed to restart MediaRecorder:", err);
                    }
                }
            };

            mediaRecorder.start();
            setIsRecording(true);
            setStatus("recording");

            intervalRef.current = setInterval(() => {
                if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                    shouldRestartRef.current = true;
                    mediaRecorderRef.current.stop();
                }
            }, 6000); // 6秒バッファ

        } catch (e) {
            console.error("Microphone Access Failed:", e);
            alert("マイクへのアクセスに失敗しました。録音デバイスを確認してください。");
            setStatus("idle");
        }
    };

    const stopRecording = () => {
        setIsRecording(false);
        setStatus("idle");
        setIsAnalyzing(false);

        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        shouldRestartRef.current = false;
        
        // 6秒レコーダーの停止
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            try {
                mediaRecorderRef.current.stop();
            } catch (e) {}
        }
        mediaRecorderRef.current = null;

        // 全体レコーダーの停止
        if (totalRecorderRef.current && totalRecorderRef.current.state !== "inactive") {
            try {
                totalRecorderRef.current.stop();
            } catch (e) {}
        }

        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setVolume(0);
    };

    // 監視停止クリック時
    const handleStopClick = () => {
        if (!isRecording) return;

        // タイマー停止
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        // 各レコーダーを停止
        shouldRestartRef.current = false;
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
        }
        if (totalRecorderRef.current && totalRecorderRef.current.state === "recording") {
            totalRecorderRef.current.stop();
        }

        // デフォルト会議名設定
        const now = new Date();
        const yyyymmdd_hhmmss = now.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/-/g, '').replace(/:/g, '');
        setSessionName(`Meeting_Gemini_${yyyymmdd_hhmmss}`);

        setShowUploadModal(true);
    };

    // 案A: テキスト簡易評価の送信
    const handleTextUpload = async () => {
        if (!sessionName.trim()) {
            alert("会議名を入力してください。");
            return;
        }

        setUploadProgress("会話テキストを送信し、Geminiで定量評価中...");

        const fullTranscript = speechHistory.join("\n");
        if (!fullTranscript.trim()) {
            alert("評価する会話テキストが存在しません。");
            setUploadProgress("");
            return;
        }

        try {
            const res = await fetch("/api/consulting/training/review-text", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    media_filename: sessionName + ".txt",
                    full_transcript: fullTranscript
                })
            });

            if (res.ok) {
                alert("評価が保存されました！履歴画面に戻ります。");
                stopRecording();
                setShowUploadModal(false);
                router.push("/consulting/training");
            } else {
                throw new Error(await res.text());
            }
        } catch (e) {
            console.error("Text evaluation failed:", e);
            alert("テキスト評価の送信に失敗しました: " + e.message);
        } finally {
            setUploadProgress("");
        }
    };

    // 案B: 音声ファイル詳細評価の送信
    const handleAudioUpload = async () => {
        if (!sessionName.trim()) {
            alert("会議名を入力してください。");
            return;
        }

        if (allAudioChunksRef.current.length === 0) {
            alert("録音音声データが存在しません。");
            return;
        }

        setUploadProgress("音声ファイルを統合中...");

        const mimeType = totalRecorderRef.current?.mimeType || "audio/webm";
        const audioBlob = new Blob(allAudioChunksRef.current, { type: mimeType });

        try {
            setUploadProgress("署名付きアップロードURLを取得中...");
            let ext = "webm";
            if (mimeType.includes("mp4")) ext = "m4a";
            else if (mimeType.includes("ogg")) ext = "ogg";
            const filename = `${sessionName}.${ext}`;

            const urlRes = await fetch(`/api/consulting/upload-url?filename=${encodeURIComponent(filename)}&content_type=${encodeURIComponent(mimeType)}`);
            if (!urlRes.ok) throw new Error("アップロードURLの取得に失敗しました");
            const { upload_url, gcs_path } = await urlRes.json();

            setUploadProgress("音声ファイルをアップロード中...");
            const uploadRes = await fetch(upload_url, {
                method: "PUT",
                headers: { "Content-Type": mimeType },
                body: audioBlob,
            });
            if (!uploadRes.ok) throw new Error("GCSへのアップロードに失敗しました");

            setUploadProgress("Geminiによる音声定量解析中... (数分かかる場合があります)");
            const reviewRes = await fetch("/api/consulting/training/review", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    media_filename: filename,
                    gcs_path: gcs_path
                }),
            });

            if (reviewRes.ok) {
                alert("評価が完了しました！履歴画面へ戻ります。");
                stopRecording();
                setShowUploadModal(false);
                router.push("/consulting/training");
            } else {
                throw new Error(await reviewRes.text());
            }

        } catch (e) {
            console.error("Audio evaluation failed:", e);
            alert("音声評価の処理に失敗しました: " + e.message);
        } finally {
            setUploadProgress("");
        }
    };

    const startVolumeIndicator = (stream) => {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const update = () => {
                if (!analyserRef.current) return;
                analyserRef.current.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i];
                }
                const average = sum / bufferLength;
                setVolume(average);

                // 一定以上の音量が検知された場合、音声入力ありとマーク
                if (average > 15) {
                    hasSpeechInputRef.current = true;
                }

                animationFrameRef.current = requestAnimationFrame(update);
            };

            audioContextRef.current = audioContext;
            analyserRef.current = analyser;
            update();
        } catch (e) {
            console.error("Failed to start volume indicator:", e);
        }
    };

    const analyzeAudioChunk = async (audioBlob) => {
        setIsAnalyzing(true);

        const formData = new FormData();
        formData.append("file", audioBlob, "chunk.webm");

        try {
            const res = await fetch("/api/consulting/training/live-gemini/analyze", {
                method: "POST",
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                
                if (data.transcription && data.transcription.trim()) {
                    setSpeechHistory(prev => [...prev, data.transcription]);
                }

                if (data.alerts && data.alerts.length > 0) {
                    const timestamp = new Date().toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    
                    const newAlerts = data.alerts.map(alert => ({
                        id: Math.random().toString(36).substring(7),
                        timestamp,
                        category: alert.category,
                        detected_text: alert.detected_text || data.transcription,
                        reason: alert.reason,
                        improvement: alert.improvement
                    }));

                    setAlerts(prev => [...prev, ...newAlerts]);
                    setLatestAlert(newAlerts[0]);
                    
                    setTimeout(() => {
                        setLatestAlert(null);
                    }, 5000);

                    setStats(prev => {
                        const updated = { ...prev };
                        newAlerts.forEach(a => {
                            updated[a.category] = (updated[a.category] || 0) + 1;
                            updated.total += 1;
                        });
                        return updated;
                    });
                }
            } else {
                console.error("API analysis failed:", await res.text());
            }
        } catch (error) {
            console.error("Failed to call analysis API:", error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const getCategoryBadge = (category) => {
        const badgeMap = {
            filler: { label: "フィラー", style: "bg-amber-100 text-amber-800 border-amber-200" },
            clarity: { label: "滑舌・明瞭さ", style: "bg-rose-100 text-rose-800 border-rose-200" },
            roundabout: { label: "回りくどい", style: "bg-indigo-100 text-indigo-800 border-indigo-200" },
            logic: { label: "要約・咀嚼力", style: "bg-emerald-100 text-emerald-800 border-emerald-200" }
        };
        const current = badgeMap[category] || { label: category, style: "bg-slate-100 text-slate-800 border-slate-200" };
        return (
            <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${current.style}`}>
                {current.label}
            </span>
        );
    };

    const totalChars = speechHistory.join("").length;
    const fillerDensity = totalChars > 0 ? Math.min(100, ((stats.filler * 2.5) / totalChars) * 100) : 0;

    return (
        <div className="flex flex-col w-full h-screen bg-gray-50 text-slate-800 font-sans overflow-hidden">
            <div className="flex flex-col relative flex-1 min-h-0">
                
                {/* ヘッダー */}
                <div className="flex items-center p-3.5 border-b border-gray-200 justify-between flex-shrink-0 bg-white z-10 sticky top-0">
                    <div className="flex items-center gap-3">
                        <MobileMenuButton />
                        <Link href="/consulting/training" className="text-slate-655 hover:text-cyan-600 transition-colors text-xs bg-white px-3 py-1.5 rounded-full border border-gray-300 shadow-xs">
                            ◀ MTG Training 一覧
                        </Link>
                        <h1 className="text-sm font-bold tracking-wider text-cyan-700 hidden sm:block">🎙️ MTG Live Train</h1>
                    </div>

                    {/* タブ切り替え */}
                    <div className="flex bg-gray-100 p-1 rounded-full border border-gray-200 shadow-inner">
                        <a href="/consulting/training/live-browser" className="px-4 py-1 rounded-full text-xs font-semibold text-slate-500 hover:text-slate-800 transition-all">
                            Browser 認識版 (案A)
                        </a>
                        <span className="px-4 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-cyan-600 to-blue-600 text-white cursor-default shadow-sm">
                            Gemini 音声解析版 (案B)
                        </span>
                    </div>
                </div>

                {/* メインコンテンツエリア */}
                <div className="flex flex-col lg:grid lg:grid-cols-12 p-2 lg:p-6 gap-3 lg:gap-6 bg-gray-50 flex-1 min-h-0 overflow-hidden">
                    
                    {/* ① モニター状況カード (PC左・スマホ1番目) */}
                    <div className="order-1 lg:order-1 lg:col-span-8 bg-white p-3 lg:p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between relative overflow-hidden flex-shrink-0">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-2.5 lg:mb-4">
                            <div className="flex items-center space-x-2.5">
                                <div className={`w-3 h-3 rounded-full flex items-center justify-center ${isRecording ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}>
                                    {isRecording && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                </div>
                                <span className="text-[11px] lg:text-xs font-bold tracking-wider uppercase text-slate-600">
                                    {status === "recording" ? "音声録音＆バッファ送信中 (Gemini解析版)" : status === "connecting" ? "起動処理中..." : "待機中"}
                                </span>
                            </div>
                            
                            {isRecording && (
                                <div className="flex items-center space-x-2.5">
                                    {isAnalyzing && (
                                        <div className="flex items-center space-x-1 bg-cyan-50 text-cyan-700 border border-cyan-200 px-2 py-0.5 rounded-full text-[9px] font-bold animate-pulse">
                                            <span>⚡ Gemini解析中...</span>
                                        </div>
                                    )}
                                    <div className="flex items-center space-x-1.5">
                                        <div className="text-[9px] text-slate-400 font-mono">Mic Input</div>
                                        <div className="w-16 lg:w-20 bg-gray-100 h-1.5 rounded-full overflow-hidden border border-gray-200">
                                            <div 
                                                style={{ width: `${Math.min(100, (volume / 100) * 100)}%` }} 
                                                className="bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500 h-full rounded-full transition-all duration-75"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 操作コントロール */}
                        <div className="flex items-center space-x-4">
                            {!isRecording ? (
                                <button
                                    onClick={startRecording}
                                    className="w-full flex items-center justify-center space-x-2 py-2 lg:py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-bold rounded-xl shadow-md transition-all transform active:scale-99 text-xs lg:text-sm"
                                >
                                    <span>🎙️ リアルタイム監視を開始</span>
                                </button>
                            ) : (
                                <button
                                    onClick={handleStopClick}
                                    className="w-full flex items-center justify-center space-x-2 py-2 lg:py-3 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold rounded-xl shadow-md transition-all transform active:scale-99 text-xs lg:text-sm"
                                >
                                    <span>🛑 監視を終了</span>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* ② 簡易スタッツカード (PC右・スマホ2番目) */}
                    <div className="order-2 lg:order-2 lg:col-span-4 bg-white p-3 lg:p-5 rounded-2xl border border-gray-200 shadow-sm flex-shrink-0">
                        <h2 className="text-[10px] lg:text-xs font-bold text-slate-400 tracking-widest uppercase mb-2 lg:mb-3.5">🎯 アラート累積統計</h2>
                        <div className="grid grid-cols-4 gap-1.5 text-center">
                            <div className="bg-amber-50/60 p-1 lg:p-2 rounded-xl border border-amber-100">
                                <div className="text-[8px] lg:text-[9px] font-bold text-amber-700 uppercase">フィラー</div>
                                <div className="text-sm lg:text-lg font-black text-amber-800 mt-0.5">{stats.filler}</div>
                            </div>
                            <div className="bg-rose-50/60 p-1 lg:p-2 rounded-xl border border-rose-100">
                                <div className="text-[8px] lg:text-[9px] font-bold text-rose-700 uppercase">滑舌低下</div>
                                <div className="text-sm lg:text-lg font-black text-rose-800 mt-0.5">{stats.clarity}</div>
                            </div>
                            <div className="bg-indigo-50/60 p-1 lg:p-2 rounded-xl border border-indigo-100">
                                <div className="text-[8px] lg:text-[9px] font-bold text-indigo-700 uppercase">回りくどい</div>
                                <div className="text-sm lg:text-lg font-black text-indigo-800 mt-0.5">{stats.roundabout}</div>
                            </div>
                            <div className="bg-emerald-50/60 p-1 lg:p-2 rounded-xl border border-emerald-100">
                                <div className="text-[8px] lg:text-[9px] font-bold text-emerald-700 uppercase">咀嚼力</div>
                                <div className="text-sm lg:text-lg font-black text-rose-800 mt-0.5">{stats.logic}</div>
                            </div>
                        </div>

                        {/* リアルタイムフィラー密度 */}
                        <div className="mt-2.5 pt-2.5 lg:mt-4 lg:pt-4 border-t border-gray-150">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] lg:text-xs font-bold text-slate-500 flex items-center gap-1">
                                    📊 フィラー密度
                                    <span className="text-[8px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-sm font-normal hidden sm:inline-block">会話量に対する比率</span>
                                </span>
                                <span className={`text-xs lg:text-sm font-black font-mono px-1.5 py-0.5 rounded-md ${
                                    fillerDensity > 5 ? 'text-rose-600 bg-rose-50 animate-pulse' : 
                                    fillerDensity > 2 ? 'text-amber-600 bg-amber-50' : 
                                    'text-emerald-600 bg-emerald-50'
                                }`}>
                                    {fillerDensity.toFixed(1)} %
                                </span>
                            </div>
                            <div className="w-full bg-gray-150 h-1.5 lg:h-2.5 rounded-full overflow-hidden border border-gray-200 shadow-inner">
                                <div 
                                    style={{ width: `${Math.min(100, fillerDensity * 10)}%` }} 
                                    className={`h-full rounded-full transition-all duration-300 ${
                                        fillerDensity > 5 ? 'bg-gradient-to-r from-rose-500 to-rose-600' : 
                                        fillerDensity > 2 ? 'bg-gradient-to-r from-amber-500 to-amber-600' : 
                                        'bg-gradient-to-r from-emerald-400 to-emerald-600'
                                    }`}
                                />
                            </div>
                            <div className="flex justify-between text-[8px] text-slate-400 mt-0.5 font-mono">
                                <span>0%</span>
                                <span>5%</span>
                                <span>10%+</span>
                            </div>
                        </div>
                    </div>

                    {/* ③ リアルタイムアラートタイムライン (PC右下・スマホ3番目) */}
                    <div className="order-3 lg:order-4 lg:col-span-4 bg-white p-3 lg:p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col flex-1 lg:flex-initial lg:h-full min-h-0 relative overflow-hidden">
                        <h2 className="text-[10px] lg:text-xs font-bold text-slate-400 tracking-widest uppercase mb-2 lg:mb-3 flex-shrink-0">⚠️ 検出された発話課題 (Gemini解析)</h2>
                        
                        {/* タイムラインリスト */}
                        <div ref={alertTimelineRef} className="space-y-3 lg:space-y-4 pr-1 custom-scrollbar flex-1 overflow-y-auto">
                            {alerts.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-[10px] lg:text-xs text-center py-6 lg:py-12 p-4">
                                    <span className="text-2xl lg:text-3xl mb-1 lg:mb-2">🧠</span>
                                    <p>まだ課題は検出されていません。</p>
                                </div>
                            ) : (
                                alerts.map((alert) => (
                                    <div 
                                        key={alert.id} 
                                        className="p-3 lg:p-4 bg-white border border-gray-200 rounded-xl space-y-2 shadow-xs relative hover:border-cyan-300 transition-colors animate-slideUp"
                                    >
                                        <div className="flex justify-between items-center">
                                            {getCategoryBadge(alert.category)}
                                            <span className="text-[8px] lg:text-[9px] text-slate-400 font-mono">{alert.timestamp}</span>
                                        </div>
                                        <div className="text-[11px] lg:text-xs">
                                            <div className="text-slate-400 font-medium mb-0.5">指摘箇所の発話:</div>
                                            <div className="text-slate-700 bg-gray-50 px-2 py-1 rounded border border-gray-150 italic font-mono leading-tight">
                                                「 {alert.detected_text} 」
                                            </div>
                                        </div>
                                        <div className="text-[11px] lg:text-xs space-y-0.5">
                                            <div className="text-rose-600 font-bold flex items-center">
                                                <span className="mr-1">❌</span> アラート理由:
                                            </div>
                                            <p className="text-slate-600 pl-4 leading-normal">{alert.reason}</p>
                                        </div>
                                        <div className="text-[11px] lg:text-xs space-y-0.5 pt-1 border-t border-gray-100">
                                            <div className="text-emerald-600 font-bold flex items-center">
                                                <span className="mr-1">💡</span> 改善・言い換え案:
                                            </div>
                                            <p className="text-slate-600 pl-4 leading-normal">{alert.improvement}</p>
                                        </div>
                                    </div>
                                ))
                            )}
                            <div ref={alertEndRef} />
                        </div>

                        {latestAlert && (
                            <div className="absolute bottom-3 left-3 right-3 bg-white border-2 border-rose-500 p-3 lg:p-4 rounded-xl shadow-xl animate-bounce flex items-start space-x-2.5 z-20">
                                <span className="text-xl lg:text-2xl flex-shrink-0">⚠️</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-center mb-0.5">
                                        <span className="text-[10px] lg:text-xs font-bold text-rose-600 uppercase tracking-wider">即時警告アラート (Gemini)</span>
                                        {getCategoryBadge(latestAlert.category)}
                                    </div>
                                    <p className="text-[11px] lg:text-xs text-slate-800 font-bold truncate">「{latestAlert.detected_text}」</p>
                                    <p className="text-[10px] lg:text-[11px] text-rose-500 mt-0.5">{latestAlert.reason}</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ④ リアルタイム発話文字起こしパネル (PC左下・スマホ4番目) */}
                    <div className="order-4 lg:order-3 lg:col-span-8 bg-white p-3 lg:p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col h-[88px] lg:h-full lg:flex-1 min-h-0 overflow-hidden relative">
                        <h2 className="text-[10px] lg:text-xs font-bold text-slate-400 tracking-widest uppercase mb-2 flex items-center justify-between flex-shrink-0">
                            <span className="flex items-center gap-1.5">🗣️ 文字起こし 
                                <span className="text-[8px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded-sm font-normal lg:inline-block hidden">6秒ごと確定</span>
                            </span>
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={() => setShowHistoryModal(true)}
                                    className="px-2 py-0.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 rounded text-[9px] lg:text-[10px] font-bold border border-cyan-200 transition-colors flex items-center gap-1 shadow-2xs"
                                    title="文字起こし全文の確認"
                                >
                                    📋 全文 ({speechHistory.length})
                                </button>
                                {isRecording && <span className="text-[8px] lg:text-[10px] text-cyan-655 font-mono animate-pulse">解析中...</span>}
                            </div>
                        </h2>
                        
                        {/* スクロール履歴 */}
                        <div ref={transcriptTimelineRef} className="space-y-2 lg:space-y-3 pr-2 custom-scrollbar text-[11px] lg:text-sm text-slate-700 leading-relaxed flex-1 overflow-y-auto min-h-0">
                            {speechHistory.length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 text-[10px] lg:text-xs py-2 lg:py-8">
                                    <p>マイク音声をリアルタイムでテキスト化します...</p>
                                </div>
                            )}
                            
                            {speechHistory.map((text, index) => (
                                <div key={index} className="p-2 lg:p-3 bg-gray-50 rounded-xl border border-gray-150 animate-fadeIn">
                                    {text}
                                </div>
                            ))}

                            {isAnalyzing && (
                                <div className="p-2 lg:p-3 bg-cyan-50/20 text-slate-500 italic rounded-xl border border-dashed border-cyan-200 animate-pulse flex items-center space-x-1.5">
                                    <span className="animate-spin text-[10px]">🌀</span>
                                    <span>音声認識処理中...</span>
                                </div>
                            )}
                            <div ref={transcriptEndRef} />
                        </div>
                    </div>

                </div>

            </div>

            {/* 文字起こし履歴全文モーダル */}
            {showHistoryModal && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl border border-gray-200 p-5 max-w-2xl w-full h-[80vh] flex flex-col shadow-2xl space-y-4 animate-scaleUp">
                        <div className="flex justify-between items-center border-b border-gray-150 pb-3 flex-shrink-0">
                            <h3 className="text-sm lg:text-base font-bold text-slate-800 flex items-center gap-1.5">
                                <span>🗣️ 文字起こし全文ログ</span>
                                <span className="text-xs bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full font-bold">
                                    全 {speechHistory.length} 件
                                </span>
                            </h3>
                            <button 
                                onClick={() => {
                                    const text = speechHistory.join("\n");
                                    navigator.clipboard.writeText(text);
                                    alert("文字起こし全文をクリップボードにコピーしました！");
                                }}
                                className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-slate-600 rounded text-xs font-bold border border-gray-300 transition-colors shadow-2xs"
                            >
                                📋 全文コピー
                            </button>
                        </div>
                        
                        {/* モーダル内スクロール履歴 */}
                        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar text-sm text-slate-700 leading-relaxed min-h-0 p-1">
                            {speechHistory.length === 0 ? (
                                <p className="text-slate-400 text-center py-12 text-xs">文字起こしデータはまだありません。</p>
                            ) : (
                                speechHistory.map((text, index) => (
                                    <div key={index} className="p-3 bg-gray-50 rounded-xl border border-gray-150 relative">
                                        <span className="absolute top-2 right-3 text-[9px] text-slate-400 font-mono">#{index + 1}</span>
                                        <p className="pr-8">{text}</p>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="pt-3 border-t border-gray-150 flex-shrink-0 flex justify-end">
                            <button
                                onClick={() => setShowHistoryModal(false)}
                                className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white text-xs font-bold rounded-xl shadow-md transition-colors"
                            >
                                閉じる
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 評価アップロード選択モーダル */}
            {showUploadModal && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 max-w-md w-full shadow-2xl space-y-4 animate-scaleUp">
                        <h3 className="text-base font-bold text-slate-800 flex items-center">
                            <span className="mr-2">💾</span> MTGレビューへの保存・定量評価
                        </h3>
                        <p className="text-xs text-slate-500 leading-relaxed">
                            この監視セッションの会話データをMTG Training履歴に保存し、Geminiによる定量採点を行います。評価の保存方式を選択してください。
                        </p>
                        
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-bold text-slate-400 block uppercase">会議タイトル・履歴名</label>
                            <input 
                                type="text" 
                                value={sessionName}
                                onChange={(e) => setSessionName(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-slate-800 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-bold"
                                placeholder="会議の履歴名を入力してください..."
                            />
                        </div>
                        
                        {uploadProgress ? (
                            <div className="py-4 space-y-3">
                                <div className="text-xs font-bold text-cyan-600 animate-pulse text-center">{uploadProgress}</div>
                                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                    <div className="bg-gradient-to-r from-cyan-500 to-blue-600 h-full rounded-full animate-progress-indeterminate" />
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-3 pt-2">
                                <div className="p-3.5 bg-cyan-50/60 rounded-2xl border border-cyan-100 space-y-2">
                                    <button
                                        onClick={handleTextUpload}
                                        className="w-full py-2.5 px-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center justify-between group"
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <span>✨ 文字起こしテキストで詳細評価</span>
                                            <span className="px-1.5 py-0.5 bg-white text-cyan-700 text-[8px] font-black rounded-sm tracking-wider">推奨・高精度</span>
                                        </span>
                                        <span className="text-[9px] bg-white/20 px-2 py-0.5 rounded-full">即時判定</span>
                                    </button>
                                    <p className="text-[10px] text-cyan-800 leading-relaxed pl-1 font-medium">
                                        リアルタイムで正確に書き起こされた会話テキストを送信し、ハルシネーション（内容の捏造）を完全に防ぎながら、ルーブリックに基づく最高精度の100点定量評価を行います。
                                    </p>
                                </div>

                                <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-150 space-y-2">
                                    <button
                                        onClick={handleAudioUpload}
                                        className="w-full py-2.5 px-4 bg-gradient-to-r from-gray-500 to-slate-655 hover:from-gray-655 hover:to-slate-700 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center justify-between group"
                                    >
                                        <span>🎙️ 録音音声ファイルで詳細評価</span>
                                        <span className="opacity-80 text-[9px] bg-white/20 px-2 py-0.5 rounded-full">音声ファイル送信</span>
                                    </button>
                                    <p className="text-[10px] text-slate-500 leading-relaxed pl-1">
                                        音声ファイル全体をGeminiに送信して評価します。※長尺音声解析の特性上、会話内容の捏造（ハルシネーション）が発生しやすいため、上記のテキスト送信を強く推奨します。
                                    </p>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                                    <button
                                        onClick={() => {
                                            setShowUploadModal(false);
                                            stopRecording();
                                        }}
                                        className="py-2 bg-gray-100 hover:bg-gray-200 text-slate-600 text-xs font-bold rounded-lg transition-all text-center"
                                    >
                                        保存せずに終了
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowUploadModal(false);
                                            // 6秒レコーダーを再開
                                            if (mediaRecorderRef.current && mediaRecorderRef.current.state === "inactive") {
                                                try {
                                                    mediaRecorderRef.current.start();
                                                } catch(e) {}
                                            }
                                            // 全体レコーダーを再開
                                            if (totalRecorderRef.current && totalRecorderRef.current.state === "inactive") {
                                                try {
                                                    totalRecorderRef.current.start();
                                                } catch(e) {}
                                            }
                                            // タイマー再開
                                            intervalRef.current = setInterval(() => {
                                                if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                                                    shouldRestartRef.current = true;
                                                    mediaRecorderRef.current.stop();
                                                }
                                            }, 6000);
                                        }}
                                        className="py-2 bg-white border border-gray-200 hover:bg-gray-50 text-slate-500 text-xs font-bold rounded-lg transition-all text-center"
                                    >
                                        監視を続ける
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
