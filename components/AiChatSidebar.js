"use client";
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export default function AiChatSidebar({ isOpen, onClose, context, contextTitle, apiEndpoint = "/api/english/chat" }) {
    const [messages, setMessages] = useState([
        { role: 'model', content: 'こんにちは！このレビュー資料について何か質問はありますか？' }
    ]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Reset chat when context changes
    useEffect(() => {
        if (context) {
            setMessages([
                { role: 'model', content: `「${contextTitle || 'この資料'}」について何でも聞いてください！` }
            ]);
        }
    }, [context, contextTitle]);

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage = { role: 'user', content: input };
        setMessages(prev => [...prev, userMessage]);
        setInput("");
        setIsLoading(true);

        try {
            const conversationHistory = messages.filter(m => m.role !== 'system').concat(userMessage);

            const res = await fetch(apiEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: conversationHistory,
                    context: context
                }),
            });

            if (!res.ok) throw new Error("Failed to fetch response");

            const data = await res.json();
            setMessages(prev => [...prev, { role: 'model', content: data.response }]);

        } catch (error) {
            console.error("Chat error:", error);
            setMessages(prev => [...prev, { role: 'model', content: "すみません、エラーが発生しました。" }]);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="w-full sm:w-96 border-l border-gray-200 bg-white flex flex-col h-full shadow-xl flex-shrink-0 absolute inset-y-0 right-0 z-20 lg:relative lg:shadow-none transition-all duration-300">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                <div className="flex items-center space-x-2">
                    <span className="text-xl">✨</span>
                    <h2 className="font-bold text-slate-700">Gemini Chat</h2>
                </div>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600 lg:hidden">
                    ✕
                </button>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
                {messages.map((msg, index) => (
                    <div
                        key={index}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm
                                ${msg.role === 'user'
                                    ? 'bg-cyan-600 text-white rounded-br-none'
                                    : 'bg-white text-slate-700 border border-gray-100 rounded-bl-none'
                                }
                            `}
                        >
                            <ReactMarkdown
                                components={{
                                    p: ({ node, ...props }) => <p className="mb-1 last:mb-0" {...props} />,
                                    ul: ({ node, ...props }) => <ul className="list-disc pl-4 mb-2" {...props} />,
                                    ol: ({ node, ...props }) => <ol className="list-decimal pl-4 mb-2" {...props} />,
                                    li: ({ node, ...props }) => <li className="mb-0.5" {...props} />,
                                    code: ({ node, inline, className, children, ...props }) => {
                                        return !inline ? (
                                            <div className="bg-gray-800 text-gray-100 p-2 rounded my-2 overflow-x-auto text-xs">
                                                <code className={className} {...props}>
                                                    {children}
                                                </code>
                                            </div>
                                        ) : (
                                            <code className="bg-black/10 px-1 rounded font-mono text-xs" {...props}>
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
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-gray-100 px-4 py-3 rounded-2xl rounded-bl-none shadow-sm flex items-center space-x-1">
                            <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-gray-100">
                <form onSubmit={handleSend} className="relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask about the content..."
                        className="w-full pl-4 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:bg-white transition-all text-sm"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isLoading}
                        className="absolute right-2 top-1.5 p-1.5 bg-cyan-600 text-white rounded-full hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                            <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                        </svg>
                    </button>
                </form>
            </div>
        </div>
    );
}
