"use client";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link"; // Next.js App router navigation
import { useRouter } from "next/navigation";
import MobileMenuButton from "../../../../components/MobileMenuButton";

export default function LiveBrowserPage() {
    const router = useRouter();
    const [isListening, setIsListening] = useState(false);
    const [status, setStatus] = useState("idle"); // idle, listening, error
    const [currentText, setCurrentText] = useState("");
    const [speechHistory, setSpeechHistory] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [latestAlert, setLatestAlert] = useState(null);
    const [volume, setVolume] = useState(0);

    // アップロード用
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [sessionName, setSessionName] = useState("");
    const [uploadProgress, setUploadProgress] = useState("");

    // 累積統計
    const [stats, setStats] = useState({
        filler: 0,
        clarity: 0,
        roundabout: 0,
        total: 0
    });

    const recognitionRef = useRef(null);
    const audioContextRef = useRef(null);
    const analyserRef = useRef(null);
    const animationFrameRef = useRef(null);
    const streamRef = useRef(null);
    const volumeStreamRef = useRef(null);
    const recordStreamRef = useRef(null);
    const timelineEndRef = useRef(null);

    // 全体録音用
    const totalRecorderRef = useRef(null);
    const allAudioChunksRef = useRef([]);

    // 重複フィラー検出制御用
    const detectedFillersRef = useRef(new Set());

    // 新しいアラート検知時の自動スクロール
    useEffect(() => {
        if (alerts.length === 0) return;
        if (typeof window !== "undefined" && window.innerWidth < 1024) return;
        timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [alerts]);

    // アンマウント時のクリーンアップ
    useEffect(() => {
        return () => {
            stopListening();
        };
    }, []);

    const startListening = async () => {
        setSpeechHistory([]);
        setAlerts([]);
        setCurrentText("");
        setLatestAlert(null);
        setStats({ filler: 0, clarity: 0, roundabout: 0, total: 0 });
        setStatus("connecting");
        allAudioChunksRef.current = [];

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("お使いのブラウザは音声認識をサポートしていません。Google Chrome等のブラウザを使用してください。");
            setStatus("idle");
            return;
        }

        try {
            // マイクストリームの取得
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // マイク競合を回避するためにトラックのクローンを作成
            const volumeStream = stream.clone();
            const recordStream = stream.clone();
            volumeStreamRef.current = volumeStream;
            recordStreamRef.current = recordStream;

            startVolumeIndicator(volumeStream);

            // 全体録音レコーダーの起動
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
            const totalRecorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : {});
            totalRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    allAudioChunksRef.current.push(e.data);
                }
            };
            totalRecorderRef.current = totalRecorder;
            totalRecorder.start();

            // 音声認識の設定
            const rec = new SpeechRecognition();
            rec.continuous = true;
            rec.interimResults = true;
            rec.lang = "ja-JP";

            rec.onstart = () => {
                setIsListening(true);
                setStatus("listening");
            };

            rec.onresult = (event) => {
                let interimTranscript = "";
                let finalTranscript = "";

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const result = event.results[i];
                    const text = result[0].transcript;
                    const confidence = result[0].confidence;

                    if (result.isFinal) {
                        finalTranscript = text;
                        analyzeSpeechLocal(text, confidence);
                    } else {
                        interimTranscript = text;
                        analyzeSpeechLocalInterim(text);
                    }
                }

                setCurrentText(interimTranscript);
                if (finalTranscript) {
                    setSpeechHistory(prev => [...prev, finalTranscript]);
                    // 確定したので検出済みフィラーのセットをクリア
                    detectedFillersRef.current.clear();
                }
            };

            rec.onerror = (e) => {
                console.error("Speech recognition error:", e);
                if (e.error !== "no-speech") {
                    setStatus("error");
                }
            };

            rec.onend = () => {
                if (isListening && status === "listening") {
                    try {
                        recognitionRef.current.start();
                    } catch (e) {
                        console.error("Failed to restart recognition:", e);
                    }
                }
            };

            recognitionRef.current = rec;
            rec.start();

        } catch (e) {
            console.error("Microphone Access Failed:", e);
            alert("マイクへのアクセスに失敗しました。");
            setStatus("idle");
        }
    };

    const stopListening = () => {
        setIsListening(false);
        setStatus("idle");

        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch (e) {
                // 無視
            }
            recognitionRef.current = null;
        }

        // 全体録音レコーダーの停止
        if (totalRecorderRef.current && totalRecorderRef.current.state !== "inactive") {
            try {
                totalRecorderRef.current.stop();
            } catch (e) {
                // 無視
            }
        }

        // 音声解析リソースの開放
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (volumeStreamRef.current) {
            volumeStreamRef.current.getTracks().forEach(track => track.stop());
            volumeStreamRef.current = null;
        }
        if (recordStreamRef.current) {
            recordStreamRef.current.getTracks().forEach(track => track.stop());
            recordStreamRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setVolume(0);
        setCurrentText("");
    };

    // 監視終了ボタンクリック時
    const handleStopClick = () => {
        if (!isListening) return;

        // 全体レコーダーを一度停止させて、最後のチャンクを確定させる
        if (totalRecorderRef.current && totalRecorderRef.current.state === "recording") {
            totalRecorderRef.current.stop();
        }

        // デフォルトの会議名を自動生成
        const now = new Date();
        const yyyymmdd_hhmmss = now.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/-/g, '').replace(/:/g, '');
        setSessionName(`Meeting_Browser_${yyyymmdd_hhmmss}`);

        setShowUploadModal(true);
    };

    // 案A: テキストベース簡易評価
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
                stopListening();
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

    // 案B: 音声ファイル詳細評価
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

        // 音声フォーマットの判別
        const mimeType = totalRecorderRef.current?.mimeType || "audio/webm";
        const audioBlob = new Blob(allAudioChunksRef.current, { type: mimeType });

        try {
            setUploadProgress("署名付きアップロードURLを取得中...");
            // 拡張子設定
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
                stopListening();
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

    // 音量可視化ロジック
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
                setVolume(average); // 0 ~ 255
                animationFrameRef.current = requestAnimationFrame(update);
            };

            audioContextRef.current = audioContext;
            analyserRef.current = analyser;
            update();
        } catch (e) {
            console.error("Failed to start volume indicator:", e);
        }
    };

    // 音声テキストのリアルタイム解析（ローカル）
    const analyzeSpeechLocal = (text, confidence) => {
        if (!text.trim()) return;

        const newAlerts = [];
        const timestamp = new Date().toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // 1. 滑舌判定 (Confidenceスコア)
        if (confidence > 0 && confidence < 0.75) {
            newAlerts.push({
                id: Math.random().toString(36).substring(7),
                timestamp,
                category: "clarity",
                detected_text: text,
                reason: `発話の明瞭度が低下しています（信頼度: ${Math.round(confidence * 100)}%）。`,
                improvement: "早口になっているか、語尾がもごもごしている可能性があります。スピードを落とし、口を大きく動かして発音しましょう。"
            });
        }

        // 2. 回りくどさ（一文の長さ判定）
        if (text.length > 50) {
            newAlerts.push({
                id: Math.random().toString(36).substring(7),
                timestamp,
                category: "roundabout",
                detected_text: text,
                reason: "一文が長く、冗長（回りくどい）になっています。",
                improvement: "『結論ファースト』を徹底し、一文は『主語＋述語』でシンプルに区切って、点（。/ピリオド）を多く打つよう構成しましょう。"
            });
        }

        if (newAlerts.length > 0) {
            setAlerts(prev => [...prev, ...newAlerts]);

            setLatestAlert(newAlerts[0]);
            const timer = setTimeout(() => {
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
    };

    // 未確定テキストに対するリアルタイムフィラー検出（ローカル）
    const analyzeSpeechLocalInterim = (text) => {
        if (!text.trim()) return;

        const newAlerts = [];
        const timestamp = new Date().toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // フィラー検出 (正規表現)
        const fillerRegex = /(えーっと|えっと|あのー|あの|ちょっと|まあ|なんか|えー)/g;
        const matches = text.match(fillerRegex);
        if (matches) {
            const uniqueFillers = [...new Set(matches)];
            uniqueFillers.forEach(filler => {
                // すでに現在の発話ブロック（確定前）で検出済みのフィラーならスキップ
                if (detectedFillersRef.current.has(filler)) {
                    return;
                }

                // 検出済みにマーク
                detectedFillersRef.current.add(filler);

                newAlerts.push({
                    id: Math.random().toString(36).substring(7),
                    timestamp,
                    category: "filler",
                    detected_text: text,
                    reason: `フィラー「${filler}」を検出しました。`,
                    improvement: "無意識にフィラーを挟まず、沈黙を恐れずに短い『間（ポーズ）』を挟むように意識してください。"
                });
            });
        }

        if (newAlerts.length > 0) {
            setAlerts(prev => [...prev, ...newAlerts]);

            setLatestAlert(newAlerts[0]);
            const timer = setTimeout(() => {
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
    };

    const getCategoryBadge = (category) => {
        const badgeMap = {
            filler: { label: "フィラー", style: "bg-amber-100 text-amber-800 border-amber-200" },
            clarity: { label: "滑舌・明瞭さ", style: "bg-rose-100 text-rose-800 border-rose-200" },
            roundabout: { label: "回りくどい", style: "bg-indigo-100 text-indigo-800 border-indigo-200" }
        };
        const current = badgeMap[category] || { label: category, style: "bg-slate-100 text-slate-800 border-slate-200" };
        return (
            <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-bold ${current.style}`}>
                {current.label}
            </span>
        );
    };

    return (
        <div className="flex flex-col w-full lg:h-screen bg-gray-50 text-slate-800 font-sans lg:overflow-hidden">
            {/* メインビュー */}
            <div className="flex flex-col relative lg:flex-1 lg:min-h-0">

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
                        <span className="px-4 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-cyan-600 to-blue-600 text-white cursor-default shadow-sm">
                            Browser 認識版 (案A)
                        </span>
                        <a href="/consulting/training/live-gemini" className="px-4 py-1 rounded-full text-xs font-semibold text-slate-500 hover:text-slate-800 transition-all">
                            Gemini 音声解析版 (案B)
                        </a>
                    </div>
                </div>

                {/* メインコンテンツエリア */}
                <div className="flex flex-col lg:flex-row p-4 sm:p-6 gap-6 bg-gray-50 lg:flex-1 lg:min-h-0 flex-shrink-0">

                    {/* 左カラム：ステータス＆リアルタイム文字起こし */}
                    <div className="w-full lg:flex-1 flex flex-col space-y-4 lg:overflow-hidden lg:h-full">
                        {/* モニター状況カード */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between relative overflow-hidden">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                                <div className="flex items-center space-x-3">
                                    <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${isListening ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}>
                                        {isListening && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                    </div>
                                    <span className="text-xs font-bold tracking-wider uppercase text-slate-600">
                                        {status === "listening" ? "音声の常時監視中 (Browser内処理)" : status === "connecting" ? "起動処理中..." : "待機中"}
                                    </span>
                                </div>
                                {isListening && (
                                    <div className="flex items-center space-x-1.5">
                                        <div className="text-[10px] text-slate-400 font-mono">Mic Input</div>
                                        <div className="w-24 bg-gray-100 h-2 rounded-full overflow-hidden border border-gray-200">
                                            <div
                                                style={{ width: `${Math.min(100, (volume / 100) * 100)}%` }}
                                                className="bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-500 h-full rounded-full transition-all duration-75"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 操作コントロール */}
                            <div className="flex items-center space-x-4">
                                {!isListening ? (
                                    <button
                                        onClick={startListening}
                                        className="w-full flex items-center justify-center space-x-2 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-bold rounded-xl shadow-md transition-all transform active:scale-99 text-sm"
                                    >
                                        <span>🎙️ リアルタイム監視を開始</span>
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleStopClick}
                                        className="w-full flex items-center justify-center space-x-2 py-3 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold rounded-xl shadow-md transition-all transform active:scale-99 text-sm"
                                    >
                                        <span>🛑 監視を終了</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* リアルタイム発話文字起こしパネル */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col lg:h-full lg:flex-1 lg:min-h-0 lg:overflow-hidden">
                            <h2 className="text-xs font-bold text-slate-400 tracking-widest uppercase mb-3 flex items-center justify-between flex-shrink-0">
                                <span>🗣️ 発話文字起こし履歴 (確定分)</span>
                                {isListening && <span className="text-[10px] text-cyan-600 font-mono animate-pulse">リアルタイム認識中</span>}
                            </h2>

                            {/* スクロール履歴 */}
                            <div className="space-y-3 pr-2 custom-scrollbar text-sm text-slate-700 leading-relaxed lg:flex-1 lg:overflow-y-auto">
                                {speechHistory.length === 0 && !currentText && (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs py-8">
                                        <p>監視を開始して話し始めると、ここに認識結果が表示されます。</p>
                                    </div>
                                )}

                                {speechHistory.map((text, index) => (
                                    <div key={index} className="p-3 bg-gray-50 rounded-xl border border-gray-150 animate-fadeIn">
                                        {text}
                                    </div>
                                ))}

                                {currentText && (
                                    <div className="p-3 bg-cyan-50/30 text-slate-500 italic rounded-xl border border-dashed border-cyan-200 animate-pulse">
                                        {currentText}...
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 右カラム：統計とアラートタイムライン */}
                    <div className="w-full lg:w-[480px] flex flex-col space-y-4">

                        {/* 簡易スタッツカード */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex-shrink-0">
                            <h2 className="text-xs font-bold text-slate-400 tracking-widest uppercase mb-3.5">🎯 アラート累積統計</h2>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div className="bg-amber-50/60 p-2.5 rounded-xl border border-amber-100">
                                    <div className="text-[10px] font-bold text-amber-700 uppercase">フィラー</div>
                                    <div className="text-xl font-black text-amber-800 mt-1">{stats.filler}</div>
                                </div>
                                <div className="bg-rose-50/60 p-2.5 rounded-xl border border-rose-100">
                                    <div className="text-[10px] font-bold text-rose-700 uppercase">滑舌低下</div>
                                    <div className="text-xl font-black text-rose-800 mt-1">{stats.clarity}</div>
                                </div>
                                <div className="bg-indigo-50/60 p-2.5 rounded-xl border border-indigo-100">
                                    <div className="text-[10px] font-bold text-indigo-700 uppercase">回りくどい</div>
                                    <div className="text-xl font-black text-indigo-800 mt-1">{stats.roundabout}</div>
                                </div>
                            </div>
                        </div>

                        {/* リアルタイムアラートタイムライン */}
                        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col lg:h-full lg:flex-1 lg:min-h-0 relative lg:overflow-hidden">
                            <h2 className="text-xs font-bold text-slate-400 tracking-widest uppercase mb-3 flex-shrink-0">⚠️ 検出された発話課題 (警告)</h2>

                            {/* タイムラインリスト */}
                            <div className="space-y-4 pr-1 custom-scrollbar lg:flex-1 lg:overflow-y-auto">
                                {alerts.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs text-center py-12 p-4">
                                        <span className="text-3xl mb-2">🌿</span>
                                        <p>まだ課題は検出されていません。</p>
                                    </div>
                                ) : (
                                    alerts.map((alert) => (
                                        <div
                                            key={alert.id}
                                            className="p-4 bg-white border border-gray-200 rounded-xl space-y-2.5 shadow-xs relative hover:border-cyan-300 transition-colors animate-slideUp"
                                        >
                                            <div className="flex justify-between items-center">
                                                {getCategoryBadge(alert.category)}
                                                <span className="text-[9px] text-slate-400 font-mono">{alert.timestamp}</span>
                                            </div>
                                            <div className="text-xs">
                                                <div className="text-slate-400 font-medium mb-1">発話抜粋:</div>
                                                <div className="text-slate-700 bg-gray-50 px-2.5 py-1.5 rounded border border-gray-150 italic font-mono">
                                                    「 {alert.detected_text} 」
                                                </div>
                                            </div>
                                            <div className="text-xs space-y-1">
                                                <div className="text-rose-600 font-bold flex items-center">
                                                    <span className="mr-1">❌</span> アラート理由:
                                                </div>
                                                <p className="text-slate-600 pl-4">{alert.reason}</p>
                                            </div>
                                            <div className="text-xs space-y-1 pt-1 border-t border-gray-100">
                                                <div className="text-emerald-600 font-bold flex items-center">
                                                    <span className="mr-1">💡</span> 改善アドバイス:
                                                </div>
                                                <p className="text-slate-600 pl-4 leading-relaxed">{alert.improvement}</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                                <div ref={timelineEndRef} />
                            </div>

                            {/* 最新アラートの即時ポップアップ */}
                            {latestAlert && (
                                <div className="absolute bottom-4 left-4 right-4 bg-white border-2 border-rose-500 p-4 rounded-xl shadow-xl animate-bounce flex items-start space-x-3 z-20">
                                    <span className="text-2xl flex-shrink-0">⚠️</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs font-bold text-rose-600 uppercase tracking-wider">即時警告アラート</span>
                                            {getCategoryBadge(latestAlert.category)}
                                        </div>
                                        <p className="text-xs text-slate-800 font-bold truncate">「{latestAlert.detected_text}」</p>
                                        <p className="text-[11px] text-rose-500 mt-1">{latestAlert.reason}</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                </div>

            </div>

            {/* 評価アップロード選択モーダル (プレミアムライト調) */}
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
                            <div className="grid grid-cols-1 gap-2.5 pt-2">
                                <button
                                    onClick={handleTextUpload}
                                    className="w-full py-2.5 px-4 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-700 hover:to-cyan-800 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center justify-between group"
                                >
                                    <span>📄 テキストで簡易評価</span>
                                    <span className="opacity-80 text-[9px] bg-white/20 px-2 py-0.5 rounded-full">文字のみ・即時評価</span>
                                </button>
                                <button
                                    onClick={handleAudioUpload}
                                    className="w-full py-2.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-750 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center justify-between group"
                                >
                                    <span>🎙️ 音声で詳細評価</span>
                                    <span className="opacity-80 text-[9px] bg-white/20 px-2 py-0.5 rounded-full">音声Up・滑舌/トーン含む</span>
                                </button>

                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                                    <button
                                        onClick={() => {
                                            setShowUploadModal(false);
                                            stopListening();
                                        }}
                                        className="py-2 bg-gray-100 hover:bg-gray-200 text-slate-600 text-xs font-bold rounded-lg transition-all text-center"
                                    >
                                        保存せずに終了
                                    </button>
                                    <button
                                        onClick={() => {
                                            // 監視再開（レコーダーと音声認識を戻す）
                                            setShowUploadModal(false);
                                            // 全体レコーダーが止まっているので再開させる
                                            if (totalRecorderRef.current && totalRecorderRef.current.state === "inactive") {
                                                try {
                                                    totalRecorderRef.current.start();
                                                } catch (err) { }
                                            }
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
