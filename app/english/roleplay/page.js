"use client";
import React, { useState, useEffect, useRef } from "react";
import MobileMenuButton from "../../../components/MobileMenuButton";

export default function RoleplayPage() {
    // State
    const [status, setStatus] = useState("disconnected"); // disconnected, connecting, connected, speaking
    const [preps, setPreps] = useState([]);
    const [selectedPrepId, setSelectedPrepId] = useState("");
    const [logs, setLogs] = useState([]);

    // Refs
    const wsRef = useRef(null);
    const audioContextRef = useRef(null);
    const audioWorkletNodeRef = useRef(null);
    const sourceNodeRef = useRef(null);
    const isRecordingRef = useRef(false);
    const sessionHandleRef = useRef(null); // Keep session token for reconnection

    // Audio Queue for playback
    const nextStartTimeRef = useRef(0);
    const jitterBufferSizeRef = useRef(0.5); // Adaptive Buffer (Starts at 0.5s, increases if unstable)

    useEffect(() => {
        fetchPreps();
        return () => stopSession();
    }, []);

    const fetchPreps = async () => {
        try {
            const res = await fetch("/api/english/preparation");
            if (res.ok) {
                const data = await res.json();
                setPreps(data);
            }
        } catch (error) {
            console.error("Failed to fetch preps", error);
        }
    };

    const addLog = (msg) => {
        setLogs(prev => [...prev.slice(-4), msg]); // Keep last 5
    };

    const startSession = async () => {
        if (!selectedPrepId && !confirm("No topic selected. Start free talk?")) return;

        setStatus("connecting");
        addLog("Connecting to server...");

        try {
            // 1. Audio Context Setup (16kHz for input preference, but browser might override)
            // We'll resample in worklet or just send whatever browser gives (usually 44.1/48k)
            // Gemini 2.0 Flash Live API actually handles 48k fine usually, or we downsample.
            // Let's try native sample rate.

            // 1. Audio Context Setup (Robust Check)
            const AudioContext = window.AudioContext || window.webkitAudioContext;

            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new AudioContext({ sampleRate: 16000 });
            }
            const ctx = audioContextRef.current;

            // Resume if suspended (browser autoplay policy)
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }

            addLog(`AudioContext started: ${ctx.sampleRate}Hz`);

            // 2. Microphone Access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // 3. WebSocket Setup
            // Determine WS URL (assume same host)
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            const host = window.location.host; // e.g. localhost:3000
            // On dev, backend is often on 8000. Nextjs rewrites /api -> backend:8000
            // WS rewrite support in Nextjs proxy is sometimes tricky.
            // If we use `/api/roleplay/ws`, next.js config must support WS proxy.
            // If not, we might need direct port 8000. 
            // Assuming standard setup where /api is proxied:
            const wsUrl = `${protocol}//${host}/api/roleplay/ws`;

            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                setStatus("connected");
                addLog("WebSocket Connected");

                // Send Setup
                const prep = preps.find(p => p.id === selectedPrepId);
                const setupData = {
                    type: "setup",
                    session_handle: sessionHandleRef.current, // Send stored token if valid
                    context: {
                        topic: prep?.topic || "Free Talk",
                        role: "English Tutor",
                        phrases: [] // Could fetch phrases too
                    }
                };
                if (sessionHandleRef.current) {
                    addLog("Resuming Session...");
                }
                wsRef.current.send(JSON.stringify(setupData));

                // Start Audio Flow
                startAudioInput(ctx, stream);
            };

            wsRef.current.onmessage = async (event) => {
                const data = JSON.parse(event.data);

                // Handle session updates
                if (data.type === "session_update" && data.session_handle) {
                    sessionHandleRef.current = data.session_handle;
                    console.log("Updated Session Handle:", data.session_handle);
                    return; // Control message, no audio
                }

                if (data.audio) {
                    playAudioChunk(data.audio);
                }
            };

            wsRef.current.onclose = () => {
                setStatus("disconnected");
                stopAudio();
                addLog("Disconnected");
            };

            wsRef.current.onerror = (e) => {
                console.error(e);
                addLog("WS Error");
            };

        } catch (e) {
            console.error(e);
            alert("Failed to start: " + e.message);
            setStatus("disconnected");
        }
    };

    const startAudioInput = async (ctx, stream) => {
        try {
            await ctx.audioWorklet.addModule("/pcm-processor.js");
        } catch (e) {
            console.error("Failed to load audio worklet:", e);
            return;
        }

        // Safety check: Context might have closed while awaiting addModule
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
            // Received Float32 chunk from Worklet
            const rawFloat32Data = event.data;
            let finalFloat32Data = rawFloat32Data;

            // Downsample to 16000Hz (Linear Interpolation)
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
                    // Linear interpolation
                    finalFloat32Data[i] = rawFloat32Data[index0] * (1 - fraction) + rawFloat32Data[index1] * fraction;
                }
            }

            // Convert to Int16
            const int16Chunk = new Int16Array(finalFloat32Data.length);
            for (let i = 0; i < finalFloat32Data.length; i++) {
                let s = Math.max(-1, Math.min(1, finalFloat32Data[i]));
                int16Chunk[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // Append to buffer
            const newBuffer = new Int16Array(inputBuffer.length + int16Chunk.length);
            newBuffer.set(inputBuffer);
            newBuffer.set(int16Chunk, inputBuffer.length);
            inputBuffer = newBuffer;

            // Send if >= 1024 samples (2048 bytes, ~64ms) - Low latency
            const CHUNK_SIZE = 1024;
            if (inputBuffer.length >= CHUNK_SIZE) {
                // Extract chunks
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
        audioWorkletNodeRef.current.connect(ctx.destination); // Mute self? If connected to destination, user hears self.
        // Usually we don't connect to destination to avoid echo, unless we want self-monitoring.
        audioWorkletNodeRef.current.disconnect(); // Don't play back input
    };

    const stopSession = () => {
        stopAudio();
        if (wsRef.current) wsRef.current.close();
        setStatus("disconnected");
    };

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
                    audioContextRef.current.close().catch(e => console.error("Error closing AudioContext:", e));
                }
                audioContextRef.current = null;
            }
        } catch (e) {
            console.error("Error stopping audio:", e);
        }
        isRecordingRef.current = false;
    };

    // Playback Logic
    const playAudioChunk = (base64string) => {
        if (!audioContextRef.current) return;
        const ctx = audioContextRef.current;

        const arrayBuffer = base64ToArrayBuffer(base64string);
        const int16Data = new Int16Array(arrayBuffer);
        const float32Data = new Float32Array(int16Data.length);

        for (let i = 0; i < int16Data.length; i++) {
            // Int16Array values are already signed (-32768 to 32767)
            // Convert to Float32 [-1.0, 1.0]
            float32Data[i] = int16Data[i] / 32768.0;
        }

        const audioBuffer = ctx.createBuffer(1, float32Data.length, 24000); // Gemini output is often 24kHz
        audioBuffer.copyToChannel(float32Data, 0);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // Scheduling
        const now = ctx.currentTime;
        let start = nextStartTimeRef.current;

        // Adaptive Jitter Buffering Logic
        // If we fell behind (buffer underrun), it means our current buffer size was too small for the network jitter.
        if (start < now) {
            // Increase buffer size to handle the instability
            // Start with 0.5s, step up by 0.5s each time we fail, max 3.0s
            const currentBuffer = jitterBufferSizeRef.current;
            const newBuffer = Math.min(currentBuffer + 0.5, 3.0);

            jitterBufferSizeRef.current = newBuffer;
            console.log(`DEBUG: Audio Underrun. Increasing jitter buffer to ${newBuffer}s`);

            start = now + newBuffer;
        } else {
            // Optional: Slowly decrease buffer if stable? 
            // For now, prioritize stability over recovering latency.
        }

        source.start(start);
        nextStartTimeRef.current = start + audioBuffer.duration;
    };

    // Helpers
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
        <div className="h-full bg-slate-900 text-white font-sans overflow-hidden flex flex-col">
            <div className="flex items-center p-4 border-b border-slate-700">
                <MobileMenuButton />
                <h1 className="text-xl font-bold ml-2">AI Roleplay (Live)</h1>
            </div>

            <main className="flex-1 flex flex-col items-center justify-center p-6 relative">

                {/* Visualizer / Avatar Circle */}
                <div className={`w-48 h-48 rounded-full border-4 flex items-center justify-center mb-8 transition-all duration-500
                    ${status === "connected" ? "border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.5)] animate-pulse" : "border-slate-700"}
                `}>
                    <div className="text-4xl">
                        {status === "connected" ? "🤖" : "😴"}
                    </div>
                </div>

                {/* Status Text */}
                <div className="mb-8 text-center h-20">
                    <p className={`text-lg font-bold ${status === "connected" ? "text-cyan-400" : "text-slate-400"}`}>
                        {status === "disconnected" && "Ready to Start"}
                        {status === "connecting" && "Connecting..."}
                        {status === "connected" && "Listening..."}
                    </p>
                    {logs.map((l, i) => <p key={i} className="text-xs text-slate-500">{l}</p>)}
                </div>

                {/* Controls */}
                <div className="w-full max-w-md space-y-4">
                    {status === "disconnected" && (
                        <>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-400">Select Topic (Optional)</label>
                                <select
                                    className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-cyan-500"
                                    value={selectedPrepId}
                                    onChange={(e) => setSelectedPrepId(e.target.value)}
                                >
                                    <option value="">Free Talk</option>
                                    {preps.map(p => (
                                        <option key={p.id} value={p.id}>{p.topic}</option>
                                    ))}
                                </select>
                            </div>

                            <button
                                onClick={startSession}
                                className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-4 rounded-xl shadow-lg transition-all transform active:scale-95 flex items-center justify-center gap-2"
                            >
                                <span>🎙️</span>
                                Start Conversation
                            </button>
                        </>
                    )}

                    {status !== "disconnected" && (
                        <button
                            onClick={stopSession}
                            className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-xl shadow-lg transition-all transform active:scale-95"
                        >
                            End Session
                        </button>
                    )}
                </div>
            </main>
        </div>
    );
}
