"use client";
import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MobileMenuButton from "../../components/MobileMenuButton";

export default function AiChatPage() {
    const [sessions, setSessions] = useState([]);
    const [selectedSessionId, setSelectedSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [selectedModel, setSelectedModel] = useState("gemini-3-flash-preview");
    const [selectedImage, setSelectedImage] = useState(null); // {data, mimeType}
    const [useGrounding, setUseGrounding] = useState(true);
    const [isRecording, setIsRecording] = useState(false);

    // UI State
    const [isHistoryOpen, setIsHistoryOpen] = useState(true);
    const [isMobile, setIsMobile] = useState(false);
    const [mounted, setMounted] = useState(false);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        setMounted(true);
        fetchSessions();
        const handleResize = () => {
            const mobile = window.innerWidth < 1024;
            setIsMobile(mobile);
            if (mobile) {
                setIsHistoryOpen(false);
            } else {
                setIsHistoryOpen(true);
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (selectedSessionId) {
            fetchMessages(selectedSessionId);
        } else {
            setMessages([]);
        }
    }, [selectedSessionId]);

    const fetchSessions = async () => {
        try {
            const res = await fetch("/api/ai-chat/sessions");
            if (res.ok) {
                const data = await res.json();
                setSessions(data);
                if (data.length > 0 && !selectedSessionId) {
                    setSelectedSessionId(data[0].id);
                }
            }
        } catch (error) {
            console.error("Failed to fetch sessions", error);
        }
    };

    const fetchMessages = async (sessionId) => {
        try {
            const res = await fetch(`/api/ai-chat/sessions/${sessionId}/messages`);
            if (res.ok) {
                const data = await res.json();
                setMessages(data);
            }
        } catch (error) {
            console.error("Failed to fetch messages", error);
        }
    };

    const handleCreateSession = async () => {
        setIsLoading(true);
        try {
            const res = await fetch("/api/ai-chat/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "New Chat" }),
            });
            if (res.ok) {
                const newSession = await res.json();
                setSessions([newSession, ...sessions]);
                setSelectedSessionId(newSession.id);
                setMessages([]);
                if (isMobile) setIsHistoryOpen(false);
            }
        } catch (error) {
            console.error("Failed to create session", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteSession = async (sessionId, e) => {
        e.stopPropagation();
        if (!confirm("Delete this chat?")) return;
        try {
            const res = await fetch(`/api/ai-chat/sessions/${sessionId}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setSessions(sessions.filter(s => s.id !== sessionId));
                if (selectedSessionId === sessionId) {
                    setSelectedSessionId(null);
                    setMessages([]);
                }
            }
        } catch (error) {
            console.error("Failed to delete session", error);
        }
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setSelectedImage({
                    data: event.target.result.split(",")[1], // Base64 only
                    mimeType: file.type,
                    preview: event.target.result
                });
            };
            reader.readAsDataURL(file);
        }
    };

    const handlePaste = (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") !== -1) {
                const file = items[i].getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    setSelectedImage({
                        data: event.target.result.split(",")[1],
                        mimeType: file.type,
                        preview: event.target.result
                    });
                };
                reader.readAsDataURL(file);
            }
        }
    };

    const handleVoiceInput = () => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Voice recognition is not supported in this browser.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = "ja-JP";
        recognition.interimResults = false;

        recognition.onstart = () => setIsRecording(true);
        recognition.onend = () => setIsRecording(false);
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            setInput(prev => prev + transcript);
        };

        if (isRecording) {
            recognition.stop();
        } else {
            recognition.start();
        }
    };

    const handleSend = async (e) => {
        e.preventDefault();
        if ((!input.trim() && !selectedImage) || isLoading) return;

        let sessionId = selectedSessionId;
        if (!sessionId) {
            await handleCreateSession();
            return;
        }

        const userMsg = {
            role: "user",
            content: input,
            image: selectedImage?.preview,
            timestamp: new Date()
        };
        setMessages(prev => [...prev, userMsg]);
        const currentInput = input;
        const currentImage = selectedImage;
        setInput("");
        setSelectedImage(null);
        setIsLoading(true);

        try {
            const res = await fetch(`/api/ai-chat/sessions/${sessionId}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: currentInput,
                    model: selectedModel,
                    image: currentImage?.data,
                    mimeType: currentImage?.mimeType,
                    use_grounding: useGrounding
                }),
            });

            if (res.ok) {
                const data = await res.json();
                setMessages(prev => [...prev, {
                    role: "model",
                    content: data.response,
                    timestamp: new Date(),
                    grounding_metadata: data.grounding_metadata
                }]);
                // Refresh sessions to update title/updated_at
                fetchSessions();
            }
        } catch (error) {
            console.error("Failed to send message", error);
            setMessages(prev => [...prev, { role: "model", content: "Error: Failed to get response.", timestamp: new Date() }]);
        } finally {
            setIsLoading(false);
        }
    };

    const speak = (text) => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ja-JP";
        window.speechSynthesis.speak(utterance);
    };

    return (
        <div className="flex h-full w-full bg-gray-50 text-slate-800 font-sans overflow-hidden">
            {/* Left Main Area */}
            <div className="flex-1 flex flex-col min-h-0 bg-white relative overflow-hidden">
                {/* Header */}
                <div className="flex-none flex items-center p-3 border-b border-gray-100 bg-white gap-2 sm:gap-3 z-10">
                    <MobileMenuButton />
                    <div className="flex items-center gap-2">
                        <span className="text-xl">✨</span>
                        <h1 className="font-bold text-slate-700 hidden sm:block">AI Chat</h1>
                    </div>

                    <div className="flex-1 px-2 sm:px-4 flex items-center gap-2 sm:gap-4 justify-end sm:justify-start">
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="text-sm p-1.5 rounded-lg border border-gray-200 bg-gray-50 text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 w-full max-w-[120px] sm:max-w-[180px]"
                        >
                            <option value="gemini-3-pro-preview">Gemini 3.0 Pro</option>
                            <option value="gemini-3-flash-preview">Gemini 3.0 Flash</option>
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                        </select>

                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 whitespace-nowrap bg-gray-50 px-2 sm:px-3 py-1.5 rounded-lg border border-gray-100">
                            <span className="hidden sm:inline">Google 検索</span>
                            <button
                                onClick={() => setUseGrounding(!useGrounding)}
                                className={`w-8 h-4 rounded-full relative transition-colors ${useGrounding ? "bg-cyan-500" : "bg-gray-300"}`}
                            >
                                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${useGrounding ? "left-4.5" : "left-0.5"}`} />
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                        className={`p-2 rounded-lg hover:bg-gray-100 transition-colors ${isHistoryOpen ? "text-cyan-600 bg-cyan-50" : "text-gray-400"}`}
                        title="History"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </button>

                    <button
                        onClick={handleCreateSession}
                        className="p-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700"
                        title="New Chat"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    </button>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-gray-50/30 flex flex-col">
                    {messages.length === 0 && !isLoading && (
                        <div className="my-auto flex flex-col items-center justify-center text-gray-400 opacity-50">
                            <span className="text-6xl mb-4">🚀</span>
                            <p className="text-xl font-medium">How can I help you today?</p>
                        </div>
                    )}
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"} mb-6`}>
                            {msg.role === "user" ? (
                                // User Message Bubble
                                <div className="max-w-[85%] sm:max-w-[75%] bg-cyan-50 text-slate-800 border border-cyan-200 rounded-2xl rounded-br-none px-4 py-3 shadow-sm">
                                    {msg.image && (
                                        <div className="mb-2">
                                            <img src={msg.image} alt="Uploaded" className="max-w-full rounded-lg max-h-60 object-contain border border-gray-100" />
                                        </div>
                                    )}
                                    <div className="prose prose-sm max-w-none prose-slate whitespace-pre-wrap">
                                        {msg.content}
                                    </div>
                                    <div className="text-right mt-1 opacity-50 text-[10px]">
                                        {msg.timestamp && new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                            ) : (
                                // Model Message (No Bubble, Full Width)
                                <div className="flex gap-3 sm:gap-4 w-full max-w-5xl">
                                    <div className="flex-none mt-1">
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-sm">
                                            <span className="text-white text-sm">✨</span>
                                        </div>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="prose prose-slate max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:border-none prose-pre:bg-transparent">
                                            <ReactMarkdown
                                                remarkPlugins={[remarkGfm]}
                                                components={{
                                                    h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mt-6 mb-4 text-slate-900" {...props} />,
                                                    h2: ({ node, ...props }) => <h2 className="text-xl font-bold mt-5 mb-3 text-slate-800 border-b border-gray-100 pb-1" {...props} />,
                                                    h3: ({ node, ...props }) => <h3 className="text-lg font-bold mt-4 mb-2 text-slate-700" {...props} />,
                                                    h4: ({ node, ...props }) => <h4 className="text-base font-bold mt-3 mb-1 text-slate-700" {...props} />,
                                                    p: ({ node, ...props }) => <p className="mb-4 text-slate-700 leading-7" {...props} />,
                                                    ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-4 space-y-1 text-slate-700" {...props} />,
                                                    ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-4 space-y-1 text-slate-700" {...props} />,
                                                    li: ({ node, ...props }) => <li className="pl-1" {...props} />,
                                                    blockquote: ({ node, ...props }) => (
                                                        <div className="border-l-4 border-cyan-400 pl-4 py-1 my-4 bg-gray-50 text-slate-700 italic rounded-r">
                                                            {props.children}
                                                        </div>
                                                    ),
                                                    table: ({ node, ...props }) => (
                                                        <div className="overflow-x-auto my-4 rounded-lg border border-gray-200">
                                                            <table className="min-w-full divide-y divide-gray-200 text-sm" {...props} />
                                                        </div>
                                                    ),
                                                    thead: ({ node, ...props }) => <thead className="bg-gray-50" {...props} />,
                                                    tbody: ({ node, ...props }) => <tbody className="bg-white divide-y divide-gray-200" {...props} />,
                                                    tr: ({ node, ...props }) => <tr className="hover:bg-gray-50 transition-colors" {...props} />,
                                                    th: ({ node, ...props }) => <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" {...props} />,
                                                    td: ({ node, ...props }) => <td className="px-4 py-3 whitespace-nowrap text-slate-700" {...props} />,
                                                    hr: ({ node, ...props }) => <hr className="my-6 border-gray-200" {...props} />,
                                                    a: ({ node, ...props }) => <a className="text-cyan-600 hover:text-cyan-700 hover:underline transition-colors" target="_blank" rel="noopener noreferrer" {...props} />,
                                                    code: ({ node, inline, className, children, ...props }) => {
                                                        const match = /language-(\w+)/.exec(className || '')
                                                        return !inline ? (
                                                            <div className="bg-slate-900 text-slate-50 p-4 rounded-xl my-4 overflow-x-auto font-mono text-sm leading-relaxed shadow-sm ring-1 ring-gray-900/5">
                                                                {match && (
                                                                    <div className="text-[10px] text-gray-400 uppercase mb-2 font-bold tracking-wider select-none border-b border-gray-700 pb-1">
                                                                        {match[1]}
                                                                    </div>
                                                                )}
                                                                <code className={className} {...props}>
                                                                    {children}
                                                                </code>
                                                            </div>
                                                        ) : (
                                                            <code className="bg-gray-100 text-slate-800 px-1.5 py-0.5 rounded font-mono text-xs font-bold ring-1 ring-gray-200" {...props}>
                                                                {children}
                                                            </code>
                                                        )
                                                    },
                                                    pre: ({ node, ...props }) => (
                                                        <pre className="not-prose my-0 bg-transparent" {...props} />
                                                    ),
                                                }}
                                            >
                                                {msg.content}
                                            </ReactMarkdown>
                                        </div>
                                        <div className="flex items-center gap-2 mt-2">
                                            <button
                                                onClick={() => speak(msg.content)}
                                                className="text-gray-400 hover:text-cyan-600 transition-colors p-1.5 rounded-full hover:bg-gray-100"
                                                title="Read Aloud"
                                            >
                                                <span className="text-lg">🔊</span>
                                            </button>
                                            <button
                                                onClick={() => navigator.clipboard.writeText(msg.content)}
                                                className="text-gray-400 hover:text-cyan-600 transition-colors p-1.5 rounded-full hover:bg-gray-100"
                                                title="Copy"
                                            >
                                                <span className="text-lg">�</span>
                                            </button>
                                            <span className="text-[10px] text-gray-300 ml-auto">
                                                {msg.timestamp && new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>
                                    {/* Grounding Metadata Display */}
                                    {msg.grounding_metadata && (
                                        <div className="mt-4 pt-4 border-t border-gray-100">
                                            {/* Sources List */}
                                            {msg.grounding_metadata.grounding_chunks && msg.grounding_metadata.grounding_chunks.length > 0 && (
                                                <div className="mb-4">
                                                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Sources</h4>
                                                    <div className="flex flex-wrap gap-2">
                                                        {msg.grounding_metadata.grounding_chunks.map((chunk, chunkIdx) => (
                                                            chunk.web && (
                                                                <a
                                                                    key={chunkIdx}
                                                                    href={chunk.web.uri}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="flex items-center gap-2 bg-white border border-gray-200 hover:border-cyan-300 hover:bg-cyan-50 px-3 py-1.5 rounded-full text-xs transition-all shadow-sm max-w-full"
                                                                >
                                                                    <div className="w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center flex-none text-[8px] font-bold text-gray-500 uppercase">
                                                                        {chunk.web.domain ? chunk.web.domain[0] : "W"}
                                                                    </div>
                                                                    <span className="truncate max-w-[150px] sm:max-w-[200px] text-slate-700 font-medium">
                                                                        {chunk.web.title || chunk.web.uri}
                                                                    </span>
                                                                </a>
                                                            )
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Google Search Widget (Search Entry Point) */}
                                            {msg.grounding_metadata.search_entry_point && (
                                                <div
                                                    className="mt-2"
                                                    dangerouslySetInnerHTML={{ __html: msg.grounding_metadata.search_entry_point.rendered_content }}
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white border border-gray-100 px-4 py-4 rounded-2xl rounded-bl-none shadow-sm flex items-center space-x-2">
                                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="flex-none p-4 bg-white border-t border-gray-100 shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">
                    <form onSubmit={handleSend} className="max-w-4xl mx-auto relative group">
                        {selectedImage && (
                            <div className="absolute bottom-full mb-4 left-0 p-2 bg-white border border-gray-100 rounded-xl shadow-lg flex items-center gap-2 group/img">
                                <img src={selectedImage.preview} className="w-16 h-16 object-cover rounded-lg" alt="Selected" />
                                <button
                                    type="button"
                                    onClick={() => setSelectedImage(null)}
                                    className="p-1 bg-red-500 text-white rounded-full hover:bg-red-600 shadow-sm"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        )}
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            accept="image/*"
                            className="hidden"
                        />
                        <div className="relative flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-2xl focus-within:ring-2 focus-within:ring-cyan-500 focus-within:bg-white transition-all overflow-hidden p-1">
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="p-2.5 text-gray-400 hover:text-cyan-600 transition-colors"
                                title="Upload Image"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                            </button>

                            <textarea
                                rows="1"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onPaste={handlePaste}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                        e.preventDefault();
                                        handleSend(e);
                                    }
                                }}
                                placeholder="Type a message or paste an image..."
                                className="flex-1 py-3 bg-transparent border-none focus:outline-none focus:ring-0 text-sm resize-none"
                                disabled={isLoading}
                            />

                            <button
                                type="button"
                                onClick={handleVoiceInput}
                                className={`p-2.5 transition-colors ${isRecording ? "text-red-500 animate-pulse" : "text-gray-400 hover:text-cyan-600"}`}
                                title="Voice Input"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 11v-4m0 0H9m3 0h3m-3-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                            </button>

                            <button
                                type="submit"
                                disabled={(!input.trim() && !selectedImage) || isLoading}
                                className="p-2.5 bg-cyan-600 text-white rounded-xl hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md active:scale-95 m-1"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                            </button>
                        </div>
                    </form>
                    <p className="text-[10px] text-center text-gray-400 mt-2">
                        AI may provide inaccurate info. Verification is recommended.
                    </p>
                </div>
            </div>

            {/* Right Sidebar (History) */}
            <div className={`
                fixed inset-y-0 right-0 z-40 bg-white border-l border-gray-100 transform transition-all duration-300 ease-in-out shadow-2xl lg:shadow-none
                lg:relative lg:translate-x-0
                ${isHistoryOpen ? "translate-x-0 w-72 sm:w-80" : "translate-x-full w-0"} 
                flex flex-col overflow-hidden
            `}>
                <div className="w-full flex flex-col h-full bg-slate-50/50">
                    <div className="p-4 border-b border-gray-100 bg-white flex justify-between items-center">
                        <h2 className="font-bold text-slate-700">Chat History</h2>
                        <button onClick={() => setIsHistoryOpen(false)} className="lg:hidden text-gray-400">✕</button>
                    </div>
                    <div className="flex-1 overflow-y-auto py-2">
                        {sessions.length === 0 && (
                            <div className="p-8 text-center text-gray-400 text-sm italic">No history yet</div>
                        )}
                        {sessions.map((session) => (
                            <div
                                key={session.id}
                                onClick={() => {
                                    setSelectedSessionId(session.id);
                                    if (isMobile) setIsHistoryOpen(false);
                                }}
                                className={`group mx-3 my-1 p-3 rounded-xl cursor-pointer transition-all border ${selectedSessionId === session.id
                                    ? "bg-white border-cyan-200 shadow-sm ring-1 ring-cyan-100"
                                    : "hover:bg-white hover:border-gray-200 border-transparent text-slate-500"
                                    }`}
                            >
                                <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                        <h3 className={`text-sm font-medium truncate ${selectedSessionId === session.id ? "text-cyan-700" : "text-slate-700"}`}>
                                            {session.title}
                                        </h3>
                                        <div className="flex items-center gap-1 mt-1">
                                            <span className="text-[10px] opacity-60">
                                                {new Date(session.updated_at).toLocaleDateString()}
                                            </span>
                                            {session.last_message && (
                                                <>
                                                    <span className="text-[10px] opacity-30">•</span>
                                                    <span className="text-[10px] opacity-60 truncate max-w-[100px]">
                                                        {session.last_message}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => handleDeleteSession(session.id, e)}
                                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 transition-all rounded-md"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Overlay for mobile */}
            {
                mounted && isHistoryOpen && isMobile && (
                    <div
                        className="fixed inset-0 bg-black/20 z-30 lg:hidden"
                        onClick={() => setIsHistoryOpen(false)}
                    />
                )
            }
        </div >
    );
}
