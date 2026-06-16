"use client";
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export default function AgentChatSidebar({ isOpen, onClose }) {
    // 状態管理
    const [status, setStatus] = useState("disconnected"); // disconnected, connecting, connected
    const [messages, setMessages] = useState([
        { role: 'model', content: 'こんにちは！私は統合AIアシスタントです。何かお手伝いできることはありますか？' }
    ]);
    const [input, setInput] = useState("");
    const [selectedModel, setSelectedModel] = useState("gemini-2.5");
    const [logs, setLogs] = useState([]);

    // リアルタイム音声対話用 Refs
    const wsRef = useRef(null);
    const audioContextRef = useRef(null);
    const audioWorkletNodeRef = useRef(null);
    const sourceNodeRef = useRef(null);
    const isRecordingRef = useRef(false);
    const sessionHandleRef = useRef(null);

    // 多重接続防止フラグ
    const isConnectingRef = useRef(false);
    // ユーザーによる意図的な切断フラグ
    const userStoppedRef = useRef(true);
    // 再接続タイマー
    const reconnectTimerRef = useRef(null);
    // ハートビート Ping タイマー
    const pingTimerRef = useRef(null);

    // 音声再生スケジュール用
    const nextStartTimeRef = useRef(0);
    const jitterBufferSizeRef = useRef(0.5);

    // スクロール用 Ref
    const messagesEndRef = useRef(null);

    // アシスタントが発話中かどうかのフラグ（ビジュアライザーアニメーション用）
    const [isModelSpeaking, setIsModelSpeaking] = useState(false);

    // 接続時に一度だけログを追加
    const addLog = (msg) => {
        setLogs(prev => [...prev.slice(-2), msg]); // 最新3件を保持
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // アンマウント時の完全クリーンアップ
    useEffect(() => {
        return () => {
            userStoppedRef.current = true;
            clearReconnectTimer();
            clearPingTimer();
            stopAudioSession();
        };
    }, []);

    // タイマークリア
    const clearReconnectTimer = () => {
        if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
    };

    const clearPingTimer = () => {
        if (pingTimerRef.current) {
            clearInterval(pingTimerRef.current);
            pingTimerRef.current = null;
        }
    };

    // ハートビート開始（20秒ごと）
    const startPingTimer = () => {
        clearPingTimer();
        pingTimerRef.current = setInterval(() => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "ping" }));
            }
        }, 20000);
    };

    // 音声会話セッションの開始
    const startSession = async () => {
        if (isConnectingRef.current) return;

        isConnectingRef.current = true;
        userStoppedRef.current = false;
        setStatus("connecting");
        addLog("サーバーに接続中...");

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new AudioContext({ sampleRate: 16000 });
            }
            const ctx = audioContextRef.current;

            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            addLog("マイクの利用を許可してください...");
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // WebSocket接続先URLを決定（Next.js のプロキシ経由でFastAPIへ）
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const host = window.location.host;
            const wsUrl = `${protocol}//${host}/api/agent/ws`;

            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                isConnectingRef.current = false;
                setStatus("connected");
                addLog("接続完了。会話をどうぞ！");

                // 初期セットアップデータの送信
                const setupData = {
                    type: "setup",
                    session_handle: sessionHandleRef.current,
                    model: selectedModel
                };
                wsRef.current.send(JSON.stringify(setupData));

                // 音声入力の開始
                startAudioInput(ctx, stream);
                startPingTimer();
            };

            // Gemini からのデータストリーム受信処理
            let currentAssistantText = "";

            wsRef.current.onmessage = async (event) => {
                const data = JSON.parse(event.data);

                // セッションハンドルの更新
                if (data.type === "session_update" && data.session_handle) {
                    sessionHandleRef.current = data.session_handle;
                    return;
                }

                // ハートビート応答
                if (data.type === "pong") return;

                // ターン終了（発話終了）の検知
                if (data.type === "turn_complete") {
                    setIsModelSpeaking(false);
                    currentAssistantText = ""; // テキストバッファをクリア
                    return;
                }

                // 音声データの再生
                if (data.audio) {
                    setIsModelSpeaking(true);
                    playAudioChunk(data.audio);
                }

                // リアルタイムテキスト（字幕）の更新
                if (data.text) {
                    currentAssistantText += data.text;
                    setMessages(prev => {
                        // 最後のメッセージがmodelのものであれば更新し、そうでなければ新しく追加
                        const lastMsg = prev[prev.length - 1];
                        if (lastMsg && lastMsg.role === 'model') {
                            const updated = [...prev];
                            updated[updated.length - 1] = { role: 'model', content: currentAssistantText };
                            return updated;
                        } else {
                            return [...prev, { role: 'model', content: currentAssistantText }];
                        }
                    });
                }
            };

            wsRef.current.onclose = (event) => {
                isConnectingRef.current = false;
                clearPingTimer();
                stopAudio();
                addLog("接続が切断されました");
                setIsModelSpeaking(false);

                // ユーザーが意図的に切断した場合は再接続しない
                if (userStoppedRef.current) {
                    setStatus("disconnected");
                    return;
                }

                // 予期しない切断時の自動再接続処理
                setStatus("connecting");
                addLog("接続が切れました。3秒後に再接続します...");
                clearReconnectTimer();
                reconnectTimerRef.current = setTimeout(() => {
                    if (!userStoppedRef.current) {
                        startSession();
                    }
                }, 3000);
            };

            wsRef.current.onerror = (err) => {
                console.error("Agent WS Error:", err);
                addLog("通信エラーが発生しました");
            };

        } catch (err) {
            isConnectingRef.current = false;
            console.error("Failed to start agent session:", err);
            addLog("接続に失敗しました: " + err.message);
            setStatus("disconnected");
        }
    };

    // 音声入力（マイク）ストリームの処理
    const startAudioInput = async (ctx, stream) => {
        try {
            await ctx.audioWorklet.addModule("/pcm-processor.js");
        } catch (e) {
            console.error("Failed to load audio worklet in Agent:", e);
            return;
        }

        if (ctx.state === 'closed') return;

        sourceNodeRef.current = ctx.createMediaStreamSource(stream);
        try {
            audioWorkletNodeRef.current = new AudioWorkletNode(ctx, "pcm-processor");
        } catch (e) {
            console.error("Failed to create AudioWorkletNode in Agent:", e);
            return;
        }

        let inputBuffer = new Int16Array(0);

        audioWorkletNodeRef.current.port.onmessage = (event) => {
            const rawFloat32Data = event.data;
            let finalFloat32Data = rawFloat32Data;

            // 16000Hzへのダウンサンプリング（線形補間）
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

            // Int16への変換
            const int16Chunk = new Int16Array(finalFloat32Data.length);
            for (let i = 0; i < finalFloat32Data.length; i++) {
                let s = Math.max(-1, Math.min(1, finalFloat32Data[i]));
                int16Chunk[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            const newBuffer = new Int16Array(inputBuffer.length + int16Chunk.length);
            newBuffer.set(inputBuffer);
            newBuffer.set(int16Chunk, inputBuffer.length);
            inputBuffer = newBuffer;

            // 1024サンプル（約64ms）ごとに送信
            const CHUNK_SIZE = 1024;
            if (inputBuffer.length >= CHUNK_SIZE) {
                while (inputBuffer.length >= CHUNK_SIZE) {
                    const chunkToSend = inputBuffer.slice(0, CHUNK_SIZE);
                    inputBuffer = inputBuffer.slice(CHUNK_SIZE);

                    const base64Audio = arrayBufferToBase64(chunkToSend.buffer);
                    if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ audio: base64Audio }));
                    }
                }
            }
        };

        sourceNodeRef.current.connect(audioWorkletNodeRef.current);
        audioWorkletNodeRef.current.connect(ctx.destination);
        audioWorkletNodeRef.current.disconnect(); // ハウリング（ループバック）を防止
        isRecordingRef.current = true;
    };

    // セッションの手動停止
    const stopAudioSession = () => {
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
        setIsModelSpeaking(false);
    };

    // オーディオコンテキストとマイクノードの解放
    const stopAudio = () => {
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
                    audioContextRef.current.close().catch(e => console.error("Error closing AudioContext in Agent:", e));
                }
                audioContextRef.current = null;
            }
        } catch (e) {
            console.error("Error stopping audio in Agent:", e);
        }
        isRecordingRef.current = false;
    };

    // 受信した音声データの再生
    const playAudioChunk = (base64string) => {
        if (!audioContextRef.current) return;
        const ctx = audioContextRef.current;

        const arrayBuffer = base64ToArrayBuffer(base64string);
        const int16Data = new Int16Array(arrayBuffer);
        const float32Data = new Float32Array(int16Data.length);

        for (let i = 0; i < int16Data.length; i++) {
            float32Data[i] = int16Data[i] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000); // Gemini Live出力は24kHz
        audioBuffer.copyToChannel(float32Data, 0);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const now = ctx.currentTime;
        let start = nextStartTimeRef.current;

        // アダプティブジッターバッファリング
        if (start < now) {
            const currentBuffer = jitterBufferSizeRef.current;
            const newBuffer = Math.min(currentBuffer + 0.5, 3.0);
            jitterBufferSizeRef.current = newBuffer;
            start = now + newBuffer;
        }

        source.start(start);
        nextStartTimeRef.current = start + audioBuffer.duration;
    };

    // テキストメッセージの送信処理
    const handleSendText = (e) => {
        e.preventDefault();
        if (!input.trim()) return;

        const textMessage = input.trim();
        setInput("");

        // メッセージ履歴に追加
        setMessages(prev => [...prev, { role: 'user', content: textMessage }]);

        // WebSocketを通じてテキストを送信
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ text: textMessage }));
        } else {
            // 接続されていない場合は会話を開始するよう促す
            setMessages(prev => [...prev, { role: 'model', content: '会話セッションが開始されていません。マイクマークの「Start」ボタンを押して接続してください。' }]);
        }
    };

    // ヘルパー関数: ArrayBuffer <=> Base64
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
        <div className={`fixed inset-y-0 right-0 z-50 w-full sm:w-96 bg-[#0f172a]/95 text-white border-l border-slate-800 flex flex-col h-full shadow-2xl backdrop-blur-md transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            {/* ヘッダーエリア */}
            <div className="p-4 border-b border-slate-800 bg-[#1e293b]/70 flex justify-between items-center flex-shrink-0">
                <div className="flex items-center space-x-2">
                    <span className="text-xl animate-pulse">✨</span>
                    <div>
                        <h2 className="font-bold text-slate-100 text-sm">統合AIアシスタント</h2>
                        <span className="text-[10px] text-slate-400">Japanese Live Mode</span>
                    </div>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer">
                    ✕
                </button>
            </div>

            {/* モデル選択エリア */}
            <div className="px-4 py-2 border-b border-slate-800 bg-[#1e293b]/40 flex justify-between items-center text-xs flex-shrink-0">
                <span className="text-slate-400 font-medium">使用モデル:</span>
                <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    disabled={status !== "disconnected"}
                    className="bg-[#0f172a] text-slate-200 border border-slate-800 rounded px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-[11px]"
                >
                    <option value="gemini-2.5">Gemini 2.5 Flash</option>
                    <option value="gemini-3.1">Gemini 3.1 Flash (Live Preview)</option>
                </select>
            </div>

            {/* 音声対話ステータス・ビジュアライザー表示エリア */}
            <div className="p-4 border-b border-slate-800/60 bg-[#1e293b]/30 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center space-x-3">
                    {/* アニメーションインジケーター */}
                    <div className="relative flex items-center justify-center">
                        <div className={`absolute w-8 h-8 rounded-full bg-cyan-500/20 transition-transform duration-500 ${isModelSpeaking ? 'animate-ping' : ''}`}></div>
                        <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center bg-slate-900 transition-all ${status === "connected" ? 'border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]' : 'border-slate-700'}`}>
                            <span className="text-sm">{status === "connected" ? "🤖" : "💤"}</span>
                        </div>
                    </div>
                    <div>
                        <div className={`text-xs font-bold ${status === "connected" ? 'text-cyan-400' : status === "connecting" ? 'text-amber-400' : 'text-slate-400'}`}>
                            {status === "disconnected" && "オフライン"}
                            {status === "connecting" && "接続中..."}
                            {status === "connected" && (isModelSpeaking ? "アシスタント発話中..." : "リスニング中...")}
                        </div>
                        <div className="text-[9px] text-slate-500 overflow-hidden text-ellipsis whitespace-nowrap max-w-[180px]">
                            {logs[logs.length - 1] || "「Start」を押して会話を開始"}
                        </div>
                    </div>
                </div>

                {/* 音声セッションのコントロールトグル */}
                <div>
                    {status === "disconnected" ? (
                        <button
                            onClick={startSession}
                            className="px-3 py-1.5 bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 text-white font-bold text-xs rounded-lg shadow-md hover:shadow-lg transition-all active:scale-95 cursor-pointer"
                        >
                            🎤 Start
                        </button>
                    ) : (
                        <button
                            onClick={stopAudioSession}
                            className="px-3 py-1.5 bg-red-500/80 hover:bg-red-600 text-white font-bold text-xs rounded-lg shadow-md transition-all active:scale-95 cursor-pointer"
                        >
                            🛑 Stop
                        </button>
                    )}
                </div>
            </div>

            {/* チャット履歴エリア */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0b0f19]/40 scrollbar-thin scrollbar-thumb-slate-800">
                {messages.map((msg, index) => (
                    <div
                        key={index}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}
                    >
                        <div
                            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-md border
                                ${msg.role === 'user'
                                    ? 'bg-gradient-to-br from-cyan-600 to-teal-600 text-white border-cyan-500 rounded-br-none'
                                    : 'bg-[#1e293b] text-slate-200 border-slate-800 rounded-bl-none'
                                }
                            `}
                        >
                            <ReactMarkdown
                                components={{
                                    p: ({ node, ...props }) => <p className="mb-1 last:mb-0" {...props} />,
                                    ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-1" {...props} />,
                                    ol: ({ node, ...props }) => <ol className="list-decimal pl-4 mb-1" {...props} />,
                                    li: ({ node, ...props }) => <li className="mb-0.5" {...props} />,
                                    code: ({ node, inline, className, children, ...props }) => {
                                        return !inline ? (
                                            <div className="bg-slate-950 text-cyan-400 p-2 rounded my-1.5 overflow-x-auto text-[10px] font-mono border border-slate-900">
                                                <code className={className} {...props}>
                                                    {children}
                                                </code>
                                            </div>
                                        ) : (
                                            <code className="bg-slate-900 px-1 py-0.5 rounded font-mono text-[10px] text-cyan-300" {...props}>
                                                {children}
                                            </code>
                                        )
                                    }
                                }}
                            >
                                {msg.content}
                            </ReactMarkdown>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* テキスト入力エリア */}
            <div className="p-3 bg-[#1e293b]/80 border-t border-slate-800 flex-shrink-0">
                <form onSubmit={handleSendText} className="relative flex items-center">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={status === "connected" ? "メッセージを入力..." : "Startを押して会話を開始してください"}
                        disabled={status !== "connected"}
                        className="w-full pl-4 pr-10 py-2.5 bg-[#0f172a] border border-slate-800 rounded-full focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-xs text-slate-200 placeholder-slate-500"
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || status !== "connected"}
                        className="absolute right-2 p-1.5 bg-gradient-to-r from-cyan-500 to-teal-500 text-white rounded-full hover:from-cyan-600 hover:to-teal-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:from-slate-700 disabled:to-slate-700 transition-all cursor-pointer"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                        </svg>
                    </button>
                </form>
            </div>
        </div>
    );
}
