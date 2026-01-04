"use client";
import React, { useState, useEffect, useRef } from "react";
import MobileMenuButton from "../../../components/MobileMenuButton";

export default function ConsultingSmePage() {
    const [isConnected, setIsConnected] = useState(false);
    const [messages, setMessages] = useState([]); // { role: 'model', text: '...' }
    const [error, setError] = useState(null);
    const [status, setStatus] = useState("disconnected"); // disconnected, connecting, connected

    // Audio Refs
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const streamRef = useRef(null);
    const websocketRef = useRef(null);

    // Initial Setup
    useEffect(() => {
        return () => {
            stopSession();
        };
    }, []);

    // Scroll to bottom
    const messagesEndRef = useRef(null);
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const startSession = async () => {
        setError(null);
        setStatus("connecting");

        try {
            // 1. WebSocket Connect
            // Determine Protocol (ws or wss)
            const protocol = window.location.protocol === "https:" ? "wss" : "ws";
            const wsUrl = `${protocol}://${window.location.host}/api/consulting/sme/ws`;
            const ws = new WebSocket(wsUrl);
            websocketRef.current = ws;

            ws.onopen = async () => {
                console.log("WebSocket Connected");
                // Init Handshake
                ws.send(JSON.stringify({ type: "setup" }));
                startAudioCapture();
                setStatus("connected");
                setIsConnected(true);
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.text) {
                    setMessages(prev => [...prev, { role: 'model', text: data.text, timestamp: new Date() }]);
                }
            };

            ws.onerror = (e) => {
                console.error("WebSocket Error:", e);
                setError("Connection Error");
                setStatus("disconnected");
            };

            ws.onclose = () => {
                console.log("WebSocket Closed");
                if (isConnected) stopSession(); // Cleanup if unexpected close
                setStatus("disconnected");
                setIsConnected(false);
            };

        } catch (e) {
            console.error(e);
            setError(e.message);
            setStatus("disconnected");
        }
    };

    const startAudioCapture = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000 // Try to request 16k, but browser might ignore
                }
            });
            streamRef.current = stream;

            const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            audioContextRef.current = audioContext;

            const source = audioContext.createMediaStreamSource(stream);

            // ScriptProcessor for raw PCM access (bufferSize, inputChannels, outputChannels)
            // 4096 samples approx 250ms at 16k
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
                if (!websocketRef.current || websocketRef.current.readyState !== WebSocket.OPEN) return;

                const inputData = e.inputBuffer.getChannelData(0);

                // Downsample if needed (Though we requested 16k, context might be 48k)
                // If context is 16k, inputData is already 16k float32
                // We need to convert Float32 [-1, 1] to Int16 [ -32768, 32767 ]

                // If sampleRate is not 16000, we should resample ideally. 
                // For simplicity, we assume context created at 16000 works or we skip resampling complex logic 
                // and rely on server robustnes or browser support for specific sampleRate.
                // Most modern browsers support new AudioContext({sampleRate: 16000}).

                const pcmData = convertFloat32ToInt16(inputData);

                // Send as base64
                const base64Audio = arrayBufferToBase64(pcmData);
                websocketRef.current.send(JSON.stringify({ audio: base64Audio }));
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

        } catch (e) {
            console.error("Audio Capture Error:", e);
            setError("Microphone Access Failed");
            stopSession();
        }
    };

    const stopSession = () => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (websocketRef.current) {
            websocketRef.current.close();
            websocketRef.current = null;
        }
        setIsConnected(false);
        setStatus("disconnected");
    };

    // Helpers
    const convertFloat32ToInt16 = (buffer) => {
        let l = buffer.length;
        let buf = new Int16Array(l);
        while (l--) {
            buf[l] = Math.min(1, Math.max(-1, buffer[l])) * 0x7FFF;
        }
        return buf.buffer;
    };

    const arrayBufferToBase64 = (buffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    };

    return (
        <div className="flex flex-col h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden">
            {/* Header */}
            <header className="h-16 px-6 flex items-center justify-between border-b border-slate-800 bg-slate-900/50 backdrop-blur-md z-10">
                <div className="flex items-center gap-4">
                    <MobileMenuButton />
                    <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
                        MTG SME (Live Monitor)
                    </h1>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${status === 'connected' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        status === 'connecting' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                            'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}>
                        <span className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-500 animate-pulse' :
                            status === 'connecting' ? 'bg-yellow-500' :
                                'bg-slate-500'
                            }`}></span>
                        {status === 'connected' ? 'LISTENING' : status}
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 flex flex-col relative max-w-5xl mx-auto w-full p-4 lg:p-6 overflow-hidden">

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto space-y-6 pb-20 scrollbar-hide">
                    {messages.length === 0 && status === 'connected' && (
                        <div className="flex flex-col items-center justify-center h-full text-center text-slate-500 animate-fadeIn">
                            <div className="relative w-24 h-24 mb-6">
                                <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <svg className="w-10 h-10 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                    </svg>
                                </div>
                            </div>
                            <h3 className="text-xl font-medium text-slate-300">Monitoring Meeting...</h3>
                            <p className="max-w-md mx-auto mt-2 text-sm">
                                I am listening silently. I will interrupt (text only) if corrections or critical insights are needed.
                            </p>
                        </div>
                    )}

                    {messages.length === 0 && status !== 'connected' && (
                        <div className="flex flex-col items-center justify-center h-full text-center text-slate-600">
                            <div className="w-20 h-20 mb-4 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center">
                                <span className="text-3xl">🛡️</span>
                            </div>
                            <p className="text-lg">Connect to start monitoring.</p>
                        </div>
                    )}

                    {messages.map((msg, idx) => (
                        <div key={idx} className="animate-slideUp">
                            <div className="flex gap-4 p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 shadow-xl backdrop-blur-sm">
                                <div className="flex-shrink-0">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-lg">
                                        <span className="text-white text-sm font-bold">AI</span>
                                    </div>
                                </div>
                                <div className="flex-1 space-y-2">
                                    <div className="flex justify-between items-baseline">
                                        <h4 className="text-emerald-400 font-bold text-sm tracking-wide">SME INSIGHT</h4>
                                        <span className="text-xs text-slate-500">{msg.timestamp.toLocaleTimeString()}</span>
                                    </div>
                                    <p className="text-slate-200 leading-relaxed whitespace-pre-wrap text-lg bg-slate-900/30 p-3 rounded-lg border border-slate-800/50">
                                        {msg.text}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Controls */}
                <div className="absolute bottom-8 left-0 right-0 flex justify-center px-4 pointer-events-none">
                    <div className="pointer-events-auto shadow-2xl rounded-full">
                        {!isConnected ? (
                            <button
                                onClick={startSession}
                                className="flex items-center gap-2 sm:gap-3 px-4 sm:px-8 py-3 sm:py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-bold transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-emerald-500/30 text-sm sm:text-base"
                            >
                                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>Start Monitoring</span>
                            </button>
                        ) : (
                            <button
                                onClick={stopSession}
                                className="flex items-center gap-2 sm:gap-3 px-4 sm:px-8 py-3 sm:py-4 bg-rose-600 hover:bg-rose-500 text-white rounded-full font-bold transition-all transform hover:scale-105 active:scale-95 shadow-lg shadow-rose-500/30 text-sm sm:text-base"
                            >
                                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                                </svg>
                                <span>Stop Session</span>
                            </button>
                        )}
                    </div>
                </div>

            </main>
        </div>
    );
}
