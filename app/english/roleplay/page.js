"use client";
import React, { useState, useEffect, useRef } from "react";
import MobileMenuButton from "../../../components/MobileMenuButton";

export default function RoleplayPage() {
    // State
    const [status, setStatus] = useState("disconnected"); // disconnected, connecting, connected
    const [preps, setPreps] = useState([]);
    const [selectedPrepId, setSelectedPrepId] = useState("");
    const [selectedModel, setSelectedModel] = useState("gemini-live-2.5-flash-native-audio");
    const [logs, setLogs] = useState([]);
    const [chatHistory, setChatHistory] = useState([]);
    const [activeUserText, setActiveUserText] = useState("");
    const [activeModelText, setActiveModelText] = useState("");
    // State - マイクモード (hands-free: 常時, push-to-talk: 長押し, muted: 消音)
    const [micMode, setMicMode] = useState("hands-free");
    const [isPTTActive, setIsPTTActive] = useState(false);

    // Refs - WebSocket / Audio / Text
    const wsRef = useRef(null);
    const activeUserTextRef = useRef("");
    const activeModelTextRef = useRef("");
    const chatEndRef = useRef(null);

    // Refs - マイク制御 / 音声トラッキング用
    const micModeRef = useRef("hands-free");
    const isPTTActiveRef = useRef(false);
    const activeSourcesRef = useRef([]); // 再生中の AudioBufferSourceNode を保持

    const changeMicMode = (mode) => {
        setMicMode(mode);
        micModeRef.current = mode;
        setIsPTTActive(false);
        isPTTActiveRef.current = false;
        console.log(`DEBUG: Mic mode changed to ${mode}`);
    };

    // AIの音声再生とテキスト生成を強制中断し、履歴にコミットする
    const interruptAudio = () => {
        console.log("DEBUG: interruptAudio triggered");

        // 1. 再生中のすべてのソースを停止
        activeSourcesRef.current.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // すでに再生終了している場合などのエラーを無視
            }
        });
        activeSourcesRef.current = [];

        // 2. 再生キューのタイムスタンプとバッファをリセット
        nextStartTimeRef.current = 0;
        jitterBufferSizeRef.current = 0.5;

        // 3. 現在の途中テキストがあれば、遮られた目印を付けてコミット
        const userText = activeUserTextRef.current.trim();
        const modelText = activeModelTextRef.current.trim();

        if (userText || modelText) {
            setChatHistory(prev => {
                const next = [...prev];
                if (userText) {
                    next.push({ id: Math.random().toString(), sender: "user", text: userText });
                }
                if (modelText) {
                    next.push({ id: Math.random().toString(), sender: "model", text: modelText + "... [Interrupted]" });
                }
                return next;
            });
            // リセット
            activeUserTextRef.current = "";
            activeModelTextRef.current = "";
            setActiveUserText("");
            setActiveModelText("");
        }
    };

    const handlePTTStart = (e) => {
        e.preventDefault();
        if (isPTTActiveRef.current) return;
        
        setIsPTTActive(true);
        isPTTActiveRef.current = true;
        console.log("DEBUG: PTT Started (Mic active)");

        // 自分が話し始めるため、AIの音声を即座に割り込み停止する
        interruptAudio();

        // バッファをリセットして新しい発話を開始
        inputBufferRef.current = new Int16Array(0);

        // サーバーに発話開始を通知
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "ptt_start" }));
        }
    };

    const handlePTTEnd = (e) => {
        if (e) e.preventDefault();
        if (!isPTTActiveRef.current) return;

        setIsPTTActive(false);
        isPTTActiveRef.current = false;
        console.log("DEBUG: PTT Ended (Mic inactive)");

        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        // 問題①修正: 1024サンプルに満たない末尾の音声バッファを即座に送信
        if (inputBufferRef.current.length > 0) {
            const remaining = inputBufferRef.current.slice(0); // コピーを作成
            inputBufferRef.current = new Int16Array(0);
            console.log(`DEBUG: Flushing ${remaining.length} remaining samples in roleplay`);
            const base64Remaining = arrayBufferToBase64(remaining.buffer);
            wsRef.current.send(JSON.stringify({ audio: base64Remaining }));
        }

        // 音声データが確実に送信されてから発話終了を認識させるため、100msのディレイを入れる
        setTimeout(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "ptt_end" }));
                console.log("DEBUG: Sent ptt_end in roleplay after delay");
            }
        }, 100);
    };

    // Auto-scroll to bottom on chat update
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatHistory, activeUserText, activeModelText]);

    const updateUserText = (text) => {
        activeUserTextRef.current = text;
        setActiveUserText(text);
    };

    const updateModelText = (text) => {
        activeModelTextRef.current = activeModelTextRef.current + text;
        setActiveModelText(activeModelTextRef.current);
    };

    const commitCurrentTurns = () => {
        const userText = activeUserTextRef.current.trim();
        const modelText = activeModelTextRef.current.trim();

        if (userText || modelText) {
            setChatHistory(prev => {
                const next = [...prev];
                if (userText) {
                    next.push({ id: Math.random().toString(), sender: "user", text: userText });
                }
                if (modelText) {
                    next.push({ id: Math.random().toString(), sender: "model", text: modelText });
                }
                return next;
            });

            // Reset
            activeUserTextRef.current = "";
            activeModelTextRef.current = "";
            setActiveUserText("");
            setActiveModelText("");
        }
    };
    const audioContextRef = useRef(null);
    const audioWorkletNodeRef = useRef(null);
    const sourceNodeRef = useRef(null);
    const isRecordingRef = useRef(false);
    const sessionHandleRef = useRef(null); // セッション再開用トークン
    const inputBufferRef = useRef(new Int16Array(0)); // 音声入力バッファ

    // 多重接続防止フラグ
    const isConnectingRef = useRef(false);
    // 意図的な切断フラグ（ユーザーが「End Session」を押した場合）
    const userStoppedRef = useRef(false);
    // 自動再接続タイマー
    const reconnectTimerRef = useRef(null);
    // ハートビート Ping タイマー
    const pingTimerRef = useRef(null);

    // 音声再生キュー
    const nextStartTimeRef = useRef(0);
    const jitterBufferSizeRef = useRef(0.5); // アダプティブバッファ（開始0.5s、不安定時は増加）

    useEffect(() => {
        fetchPreps();
        return () => {
            // アンマウント時の完全クリーンアップ
            userStoppedRef.current = true;
            clearReconnectTimer();
            clearPingTimer();
            stopSession();
        };
    }, []);

    async function fetchPreps() {
        try {
            const res = await fetch("/api/english/preparation");
            if (res.ok) {
                const data = await res.json();
                setPreps(data);
            }
        } catch (error) {
            console.error("Failed to fetch preps", error);
        }
    }

    function addLog(msg) {
        setLogs(prev => [...prev.slice(-4), msg]); // 最新5件を保持
    }

    // 再接続タイマーのクリア
    function clearReconnectTimer() {
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
    }

    // ハートビートタイマーのクリア
    function clearPingTimer() {
        if (pingTimerRef.current) {
            clearInterval(pingTimerRef.current);
            pingTimerRef.current = null;
        }
    }

    // ハートビート Ping 送信開始（20秒ごと）
    function startPingTimer() {
        clearPingTimer();
        pingTimerRef.current = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "ping" }));
                console.log("DEBUG: Sent heartbeat ping");
            }
        }, 20000);
    }

    async function startSession(keepHistory = false) {
        // 多重接続防止
        if (isConnectingRef.current) {
            console.log("DEBUG: Already connecting, skipping.");
            return;
        }

        if (!selectedPrepId && !confirm("No topic selected. Start free talk?")) return;

        // 会話ログの初期化
        if (!keepHistory) {
            setChatHistory([]);
        }
        activeUserTextRef.current = "";
        activeModelTextRef.current = "";
        setActiveUserText("");
        setActiveModelText("");

        isConnectingRef.current = true;
        userStoppedRef.current = false;
        setStatus("connecting");
        addLog("Connecting to server...");

        try {
            // AudioContext のセットアップ
            const AudioContext = window.AudioContext || window.webkitAudioContext;

            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new AudioContext({ sampleRate: 16000 });
            }
            const ctx = audioContextRef.current;

            // サスペンド中の場合は再開
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            addLog(`AudioContext started: ${ctx.sampleRate}Hz`);

            // マイクアクセス
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // WebSocket URL の決定
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const host = window.location.host;
            const wsUrl = `${protocol}//${host}/api/roleplay/ws`;

            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                isConnectingRef.current = false;
                setStatus("connected");
                addLog("WebSocket Connected");

                // セットアップ情報の送信
                const prep = preps.find(p => p.id === selectedPrepId);
                const setupData = {
                    type: "setup",
                    session_handle: sessionHandleRef.current, // 保存済みトークンがあれば送信
                    model: selectedModel, // 選択されたモデルを送信
                    mic_mode: micModeRef.current, // マイクモードを送信
                    context: {
                        topic: prep?.topic || "Free Talk",
                        role: "English Tutor",
                        phrases: [],
                        prompt: prep?.prompt || "" // トピック個別のプロンプトを含める
                    },
                    thinking_enabled: typeof window !== "undefined" ? (localStorage.getItem("thinking_enabled_roleplay") !== "false") : true, history: chatHistory.map(h => ({ sender: h.sender, text: h.text })) // 履歴を送信
                };
                if (sessionHandleRef.current) {
                    addLog("Resuming Session...");
                }
                wsRef.current.send(JSON.stringify(setupData));

                // 音声入力の開始
                startAudioInput(ctx, stream);

                // ハートビート Ping タイマーの開始
                startPingTimer();
            };

            wsRef.current.onmessage = async (event) => {
                const data = JSON.parse(event.data);

                // セッションハンドルの更新
                if (data.type === "session_update" && data.session_handle) {
                    sessionHandleRef.current = data.session_handle;
                    console.log("Updated Session Handle:", data.session_handle);
                    return;
                }

                // ハートビート Pong の受信
                if (data.type === "pong") {
                    console.log("DEBUG: Received pong");
                    return;
                }

                // サーバーからの割り込みイベントの受信
                if (data.type === "interrupted") {
                    console.log("DEBUG: Received interrupted from server");
                    interruptAudio();
                    return;
                }

                // ユーザー発話テキストの受信
                if (data.type === "user_transcript") {
                    updateUserText(data.text);
                    return;
                }

                // AI発話テキストの受信
                if (data.type === "model_transcript") {
                    updateModelText(data.text);
                    return;
                }

                // ターン完了イベント
                if (data.type === "turn_complete") {
                    commitCurrentTurns();
                    return;
                }

                if (data.audio) {
                    playAudioChunk(data.audio);
                }
            };

            wsRef.current.onclose = (event) => {
                isConnectingRef.current = false;
                clearPingTimer();
                stopAudio();
                addLog("Disconnected");

                // ユーザーが意図的に切断した場合は再接続しない
                if (userStoppedRef.current) {
                    setStatus("disconnected");
                    return;
                }

                // 予期しない切断 → 自動再接続
                console.log(`DEBUG: Unexpected disconnect (code=${event.code}). Reconnecting in 3s...`);
                setStatus("connecting");
                addLog("Connection lost. Reconnecting in 3s...");

                clearReconnectTimer();
                reconnectTimerRef.current = setTimeout(() => {
                    if (!userStoppedRef.current) {
                        addLog("Reconnecting...");
                        startSession(true); // 履歴を保持して再接続
                    }
                }, 3000);
            };

            wsRef.current.onerror = (e) => {
                console.error(e);
                addLog("WS Error");
            };

        } catch (e) {
            isConnectingRef.current = false;
            console.error(e);
            alert("Failed to start: " + e.message);
            setStatus("disconnected");
        }
    }

    const startAudioInput = async (ctx, stream) => {
        try {
            await ctx.audioWorklet.addModule("/pcm-processor.js");
        } catch (e) {
            console.error("Failed to load audio worklet:", e);
            return;
        }

        // audioWorkletのロード中にContextが閉じた場合の安全チェック
        if (ctx.state === 'closed') {
            console.warn("AudioContext invalid (closed) after loading worklet. Aborting input setup.");
            return;
        }

        sourceNodeRef.current = ctx.createMediaStreamSource(stream);
        try {
            audioWorkletNodeRef.current = new AudioWorkletNode(ctx, "pcm-processor");
        } catch (e) {
            console.error("Failed to create AudioWorkletNode:", e);
            return;
        }

        let inputBuffer = new Int16Array(0);

        audioWorkletNodeRef.current.port.onmessage = (event) => {
            // Workletから Float32 チャンクを受信
            const rawFloat32Data = event.data;
            let finalFloat32Data = rawFloat32Data;

            // 16000Hz へダウンサンプリング（線形補間）
            const targetRate = 16000;
            const currentRate = ctx.sampleRate;
            if (currentRate > targetRate) {
                const ratio = currentRate / targetRate;
                const newLength = Math.floor(rawFloat32Data.length / ratio);
                finalFloat32Data = new Float32Array(newLength);
                for (let i = 0; i < newLength; i++) {
                    const inputIndex = i * ratio;
                    const index0 = Math.floor(inputIndex);
                    const index1 = Math.min(index0 + 1, rawFloat32Data.length - 1);
                    const fraction = inputIndex - index0;
                    finalFloat32Data[i] = rawFloat32Data[index0] * (1 - fraction) + rawFloat32Data[index1] * fraction;
                }
            }

            // Int16 へ変換
            const int16Chunk = new Int16Array(finalFloat32Data.length);
            for (let i = 0; i < finalFloat32Data.length; i++) {
                let s = Math.max(-1, Math.min(1, finalFloat32Data[i]));
                int16Chunk[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // バッファに追加
            const newBuffer = new Int16Array(inputBuffer.length + int16Chunk.length);
            newBuffer.set(inputBuffer);
            newBuffer.set(int16Chunk, inputBuffer.length);
            inputBuffer = newBuffer;
            inputBufferRef.current = inputBuffer; // Refに同期

            // 1024サンプル（約64ms）ごとに送信
            const CHUNK_SIZE = 1024;
            if (inputBuffer.length >= CHUNK_SIZE) {
                while (inputBuffer.length >= CHUNK_SIZE) {
                    const chunkToSend = inputBuffer.slice(0, CHUNK_SIZE);
                    inputBuffer = inputBuffer.slice(CHUNK_SIZE);
                    inputBufferRef.current = inputBuffer; // Refに同期

                    const base64Audio = arrayBufferToBase64(chunkToSend.buffer);

                    // マイクモードおよびPTTアクティブ状態に基づく送信制御
                    let shouldSend = false;
                    if (micModeRef.current === "hands-free") {
                        shouldSend = true;
                    } else if (micModeRef.current === "push-to-talk") {
                        shouldSend = isPTTActiveRef.current;
                    }

                    if (shouldSend && wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ audio: base64Audio }));
                    }
                }
            }
        };

        sourceNodeRef.current.connect(audioWorkletNodeRef.current);
        audioWorkletNodeRef.current.connect(ctx.destination);
        audioWorkletNodeRef.current.disconnect(); // 入力音声のフィードバックを防止
    };

    function stopSession() {
        // 意図的な停止フラグを立てる（自動再接続を防ぐ）
        userStoppedRef.current = true;
        clearReconnectTimer();
        clearPingTimer();
        stopAudio();
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        isConnectingRef.current = false;
        setStatus("disconnected");
    }

    function stopAudio() {
        try {
            if (sourceNodeRef.current) {
                sourceNodeRef.current.disconnect();
                sourceNodeRef.current = null;
            }
            if (audioWorkletNodeRef.current) {
                audioWorkletNodeRef.current.disconnect();
                audioWorkletNodeRef.current = null;
            }
            if (audioContextRef.current) {
                if (audioContextRef.current.state !== 'closed') {
                    audioContextRef.current.close().catch(e => console.error("Error closing AudioContext:", e));
                }
                audioContextRef.current = null;
            }
        } catch (e) {
            console.error("Error stopping audio:", e);
        }
        isRecordingRef.current = false;
    }

    // 音声再生ロジック
    const playAudioChunk = (base64string) => {
        if (!audioContextRef.current) return;
        const ctx = audioContextRef.current;

        const arrayBuffer = base64ToArrayBuffer(base64string);
        const int16Data = new Int16Array(arrayBuffer);
        const float32Data = new Float32Array(int16Data.length);

        for (let i = 0; i < int16Data.length; i++) {
            // Int16Array の値はすでに符号付き (-32768 〜 32767)
            // Float32 [-1.0, 1.0] に変換
            float32Data[i] = int16Data[i] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000); // Gemini の出力は 24kHz
        audioBuffer.copyToChannel(float32Data, 0);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // スケジューリング
        const now = ctx.currentTime;
        let start = nextStartTimeRef.current;

        // アダプティブジッターバッファリング
        // バッファアンダーランが発生した場合、バッファサイズを拡大して安定性を優先
        if (start < now) {
            const currentBuffer = jitterBufferSizeRef.current;
            const newBuffer = Math.min(currentBuffer + 0.5, 3.0);

            jitterBufferSizeRef.current = newBuffer;
            console.log(`DEBUG: Audio Underrun. Increasing jitter buffer to ${newBuffer}s`);

            start = now + newBuffer;
        }

        // 再生ソースの追跡登録
        activeSourcesRef.current.push(source);
        source.onended = () => {
            activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
        };

        source.start(start);
        nextStartTimeRef.current = start + audioBuffer.duration;
    };

    // ヘルパー関数
    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
    function base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    return (
        <div className="h-screen bg-slate-900 text-white font-sans overflow-hidden flex flex-col">
            <div className="flex items-center p-4 border-b border-slate-700 flex-shrink-0">
                <MobileMenuButton />
                <h1 className="text-xl font-bold ml-2">AI Roleplay (Live)</h1>
            </div>

            {/* メインエリア */}
            <div className="flex-1 flex flex-col min-h-0">
                <main className="flex-1 flex flex-col p-6 min-h-0 relative">
                    {status === "disconnected" ? (
                        /* トピック選択と開始ボタン */
                        <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full space-y-6">
                            <div className="w-32 h-32 rounded-full border-4 border-slate-700 flex items-center justify-center bg-slate-800">
                                <span className="text-5xl">😴</span>
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-bold text-slate-400">Ready to Start</p>
                                <p className="text-xs text-slate-500 mt-1">トピックを選択して会話を始めてください。</p>
                            </div>

                            <div className="w-full space-y-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-400">Select Topic (Optional)</label>
                                    <select
                                        className="w-full p-4 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-cyan-500"
                                        value={selectedPrepId}
                                        onChange={(e) => setSelectedPrepId(e.target.value)}
                                    >
                                        <option value="">Free Talk</option>
                                        {preps.map(p => (
                                            <option key={p.id} value={p.id}>{p.topic}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-400">Select Model</label>
                                    <select
                                        className="w-full p-4 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-cyan-500"
                                        value={selectedModel}
                                        onChange={(e) => setSelectedModel(e.target.value)}
                                    >
                                        <option value="gemini-live-2.5-flash-native-audio">Gemini 2.5 Flash (Default)</option>
                                        <option value="gemini-live-3.1-flash-preview">Gemini 3.1 Flash (Live Preview)</option>
                                    </select>
                                </div>

                                <button
                                    onClick={startSession}
                                    className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-4 rounded-xl shadow-lg transition-all transform active:scale-95 flex items-center justify-center gap-2 text-lg"
                                >
                                    <span>🎙️</span>
                                    Start Conversation
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* 会話中のUI: アバター＋チャット履歴 */
                        <div className="flex-1 flex flex-col min-h-0 w-full max-w-3xl mx-auto space-y-4">
                            {/* 上部アバター＆ステータス */}
                            <div className="flex items-center justify-between bg-slate-850 p-4 rounded-2xl border border-slate-800 flex-shrink-0 shadow-md">
                                <div className="flex items-center gap-3">
                                    <div className={`w-12 h-12 rounded-full border-2 border-cyan-500 flex items-center justify-center bg-slate-800 ${status === "connected" ? "animate-pulse shadow-[0_0_15px_rgba(6,182,212,0.3)]" : ""}`}>
                                        <span className="text-2xl">{status === "connected" ? "🤖" : "🌀"}</span>
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-cyan-400">
                                            {status === "connected" ? "Listening & Speaking" : "Connecting..."}
                                        </p>
                                        <p className="text-[10px] text-slate-500">Live Gemini API Session</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {status === "connecting" && (
                                        <span className="text-xs text-yellow-400 animate-pulse">Connecting...</span>
                                    )}
                                    <button
                                        onClick={stopSession}
                                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95"
                                    >
                                        End Session
                                    </button>
                                </div>
                            </div>

                            {/* 会話ログ表示エリア */}
                            <div className="flex-1 overflow-y-auto bg-slate-950/40 border border-slate-800/60 rounded-2xl p-4 space-y-4 custom-scrollbar flex flex-col">
                                {chatHistory.length === 0 && !activeUserText && !activeModelText && (
                                    <div className="flex-1 flex flex-col items-center justify-center text-slate-500 text-xs py-12">
                                        <span className="text-2xl mb-2 animate-bounce">💬</span>
                                        <p>話しかけると、ここに会話の内容がリアルタイムに表示されます。</p>
                                    </div>
                                )}

                                {chatHistory.map((msg) => (
                                    <div
                                        key={msg.id}
                                        className={`flex flex-col max-w-[85%] ${msg.sender === "user" ? "ml-auto items-end" : "mr-auto items-start"
                                            } animate-fadeIn`}
                                    >
                                        <span className="text-[9px] text-slate-500 mb-1 px-1.5 uppercase font-bold tracking-wider">
                                            {msg.sender === "user" ? "You" : "Gemini"}
                                        </span>
                                        <div
                                            className={`p-3.5 rounded-2xl text-sm leading-relaxed shadow-sm whitespace-pre-wrap ${msg.sender === "user"
                                                    ? "bg-cyan-600 text-white rounded-tr-none"
                                                    : "bg-slate-800 text-slate-100 border border-slate-700/60 rounded-tl-none"
                                                }`}
                                        >
                                            {msg.text}
                                        </div>
                                    </div>
                                ))}

                                {/* アクティブな（発話中の）テキスト表示 */}
                                {activeUserText && (
                                    <div className="flex flex-col max-w-[85%] ml-auto items-end animate-pulse">
                                        <span className="text-[9px] text-cyan-400 mb-1 px-1.5 uppercase font-bold">You (Speaking...)</span>
                                        <div className="p-3.5 bg-cyan-650/20 text-cyan-200 border border-cyan-500/20 rounded-2xl rounded-tr-none text-sm italic">
                                            {activeUserText}
                                        </div>
                                    </div>
                                )}

                                {activeModelText && (
                                    <div className="flex flex-col max-w-[85%] mr-auto items-start">
                                        <span className="text-[9px] text-slate-400 mb-1 px-1.5 uppercase font-bold">Gemini (Speaking...)</span>
                                        <div className="p-3.5 bg-slate-800 text-slate-200 rounded-2xl rounded-tl-none text-sm border border-slate-700/60">
                                            {activeModelText}
                                            <span className="inline-block w-1.5 h-3.5 ml-1 bg-cyan-400 animate-blink" />
                                        </div>
                                    </div>
                                )}

                                <div ref={chatEndRef} />
                            </div>

                            {/* マイクモードと操作パネル */}
                            <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-4 flex flex-col items-center gap-3 flex-shrink-0 shadow-md">
                                {/* モード選択タブ */}
                                <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-700/50 w-full max-w-sm">
                                    <button
                                        onClick={() => changeMicMode("hands-free")}
                                        className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                                            micMode === "hands-free"
                                                ? "bg-cyan-600 text-white shadow-sm"
                                                : "text-slate-400 hover:text-white"
                                        }`}
                                    >
                                        Hands-Free
                                    </button>
                                    <button
                                        onClick={() => changeMicMode("push-to-talk")}
                                        className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                                            micMode === "push-to-talk"
                                                ? "bg-cyan-600 text-white shadow-sm"
                                                : "text-slate-400 hover:text-white"
                                        }`}
                                    >
                                        Push-to-Talk
                                    </button>
                                    <button
                                        onClick={() => changeMicMode("muted")}
                                        className={`flex-1 text-center py-2 text-xs font-bold rounded-lg transition-all ${
                                            micMode === "muted"
                                                ? "bg-rose-600 text-white shadow-sm"
                                                : "text-slate-400 hover:text-white"
                                        }`}
                                    >
                                        Muted
                                    </button>
                                </div>

                                {/* モードに応じたマイク操作ボタン・表示 */}
                                <div className="w-full flex justify-center items-center h-16">
                                    {micMode === "hands-free" && (
                                        <div className="flex items-center gap-2 text-cyan-400 text-xs font-medium animate-pulse">
                                            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" />
                                            マイクは常時ONです。そのままお話しください。
                                        </div>
                                    )}

                                    {micMode === "push-to-talk" && (
                                        <button
                                            onMouseDown={handlePTTStart}
                                            onMouseUp={handlePTTEnd}
                                            onMouseLeave={handlePTTEnd}
                                            onTouchStart={handlePTTStart}
                                            onTouchEnd={handlePTTEnd}
                                            className={`px-8 py-3.5 rounded-full font-bold text-sm flex items-center gap-2 select-none shadow-md transition-all transform active:scale-95 ${
                                                isPTTActive
                                                    ? "bg-cyan-500 text-white scale-98 shadow-inner animate-pulse"
                                                    : "bg-slate-700 text-slate-200 border border-slate-600 hover:bg-slate-650"
                                            }`}
                                        >
                                            <span className="text-base">{isPTTActive ? "🎙️" : "🤫"}</span>
                                            {isPTTActive ? "話しかけてください (長押し中)" : "ボタンを押しながら話す"}
                                        </button>
                                    )}

                                    {micMode === "muted" && (
                                        <div className="flex items-center gap-2 text-rose-400 text-xs font-medium">
                                            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                                            マイクはミュートされています。AIからの声のみを受信します。
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
