"use client";
import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import MobileMenuButton from "../../components/MobileMenuButton";

export default function AiChatPage() {
    const [sessions, setSessions] = useState([]);
    const [selectedSessionId, setSelectedSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [selectedModel, setSelectedModel] = useState("gemini-3-flash-preview");

    // UI State
    const [isHistoryOpen, setIsHistoryOpen] = useState(true);
    const [isMobile, setIsMobile] = useState(false);
    const [mounted, setMounted] = useState(false);
    const messagesEndRef = useRef(null);

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

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        let sessionId = selectedSessionId;
        if (!sessionId) {
            // Auto create session if none selected
            // But for simplicity, let's assume one must be selected or we create one here
            await handleCreateSession();
            // Note: handleCreateSession updates selectedSessionId, but state update is async.
            // In a real app, we'd handle this more robustly.
            return;
        }

        const userMsg = { role: "user", content: input, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setIsLoading(true);

        try {
            const res = await fetch(`/api/ai-chat/sessions/${sessionId}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: input,
                    model: selectedModel
                }),
            });

            if (res.ok) {
                const data = await res.json();
                setMessages(prev => [...prev, { role: "model", content: data.response, timestamp: new Date() }]);
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

    return (
        <div className="flex h-full bg-gray-50 text-slate-800 font-sans overflow-hidden">
            {/* Left Main Area */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
                {/* Header */}
                <div className="flex items-center p-3 border-b border-gray-100 bg-white gap-3 sticky top-0 z-10">
                    <MobileMenuButton />
                    <div className="flex items-center gap-2">
                        <span className="text-xl">✨</span>
                        <h1 className="font-bold text-slate-700 hidden sm:block">AI Chat</h1>
                    </div>

                    <div className="flex-1 px-4">
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="text-sm p-1.5 rounded-lg border border-gray-200 bg-gray-50 text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 w-full max-w-[180px]"
                        >
                            <option value="gemini-3-pro-preview">Gemini 3.0 Pro</option>
                            <option value="gemini-3-flash-preview">Gemini 3.0 Flash</option>
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                        </select>
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
                <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-gray-50/30">
                    {messages.length === 0 && !isLoading && (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50">
                            <span className="text-6xl mb-4">🚀</span>
                            <p className="text-xl font-medium">How can I help you today?</p>
                        </div>
                    )}
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm ${msg.role === "user"
                                ? "bg-cyan-600 text-white rounded-br-none"
                                : "bg-white text-slate-700 border border-gray-100 rounded-bl-none"
                                }`}>
                                <div className="prose prose-sm max-w-none prose-slate">
                                    <ReactMarkdown
                                        components={{
                                            p: ({ node, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                                            code: ({ node, inline, className, children, ...props }) => {
                                                const match = /language-(\w+)/.exec(className || '')
                                                return !inline ? (
                                                    <div className="bg-gray-800 text-gray-100 p-3 rounded-lg my-2 overflow-x-auto">
                                                        <code className={className} {...props}>{children}</code>
                                                    </div>
                                                ) : (
                                                    <code className="bg-gray-100 px-1.5 py-0.5 rounded text-cyan-600 font-mono text-xs" {...props}>{children}</code>
                                                )
                                            }
                                        }}
                                    >
                                        {msg.content}
                                    </ReactMarkdown>
                                </div>
                                <div className={`text-[10px] mt-1 opacity-50 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                                    {msg.timestamp && new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </div>
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
                <div className="p-4 bg-white border-t border-gray-100 shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">
                    <form onSubmit={handleSend} className="max-w-4xl mx-auto relative group">
                        <textarea
                            rows="1"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    handleSend(e);
                                }
                            }}
                            placeholder="Type a message..."
                            className="w-full pl-5 pr-14 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:bg-white transition-all text-sm resize-none"
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={!input.trim() || isLoading}
                            className="absolute right-2.5 top-2.5 p-2 bg-cyan-600 text-white rounded-xl hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md active:scale-95"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                        </button>
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
            {mounted && isHistoryOpen && isMobile && (
                <div
                    className="fixed inset-0 bg-black/20 z-30 lg:hidden"
                    onClick={() => setIsHistoryOpen(false)}
                />
            )}
        </div>
    );
}
