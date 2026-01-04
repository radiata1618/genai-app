"use client";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import MobileMenuButton from "../../../components/MobileMenuButton";
import Link from 'next/link';

// Helper for sleek dates
const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
};

export default function ConsultingReviewPage() {
    const [tasks, setTasks] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    // Initial Load
    useEffect(() => {
        fetchTasks();
        const handleResize = () => {
            if (window.innerWidth < 1024) setIsSidebarOpen(false);
            else setIsSidebarOpen(true);
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const fetchTasks = async () => {
        try {
            const res = await fetch("/api/consulting/review");
            if (res.ok) {
                const data = await res.json();
                setTasks(data);
            }
        } catch (error) {
            console.error("Failed to fetch tasks", error);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        setProgress("Initializing Upload...");

        try {
            // 1. Get Signed URL
            const urlRes = await fetch(`/api/consulting/upload-url?filename=${encodeURIComponent(file.name)}&content_type=${encodeURIComponent(file.type)}`, {
                method: "POST"
            });
            if (!urlRes.ok) throw new Error("Failed to get upload URL");
            const { upload_url, gcs_path } = await urlRes.json();

            // 2. Upload to GCS
            setProgress("Uploading Media...");
            const uploadRes = await fetch(upload_url, {
                method: "PUT",
                headers: { "Content-Type": file.type },
                body: file,
            });
            if (!uploadRes.ok) throw new Error("Upload failed");

            // 3. Process Review
            setProgress("Analyzing with Gemini Pro... (This may take a while)");
            const reviewRes = await fetch("/api/consulting/review", {
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
            } else {
                throw new Error("Analysis failed");
            }
        } catch (error) {
            console.error("Error:", error);
            alert("Process Failed: " + error.message);
        } finally {
            setIsLoading(false);
            setProgress("");
        }
    };

    // Drag & Drop Handlers
    const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFileUpload({ target: { files: [file] } });
    };

    return (
        <div className="flex h-screen bg-[#0f172a] text-slate-200 font-sans overflow-hidden">
            {/* Backdrop for Mobile */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <div className={`
                fixed inset-y-0 left-0 z-40 bg-[#1e293b] w-80 border-r border-slate-700/50 transform transition-transform duration-300 ease-in-out
                lg:relative lg:translate-x-0 flex flex-col
                ${isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:w-0 lg:border-none"}
            `}>
                <div className="p-5 border-b border-slate-700/50">
                    <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
                        MTG Review
                    </h2>
                    <p className="text-xs text-slate-400 mt-1">Consulting Logs</p>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    <button
                        onClick={() => { setIsCreating(true); setSelectedTask(null); if (window.innerWidth < 1024) setIsSidebarOpen(false); }}
                        className="w-full flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg transition-all shadow-lg shadow-indigo-500/20 mb-4"
                    >
                        <span>+ New Analysis</span>
                    </button>

                    {tasks.map((task) => (
                        <div
                            key={task.id}
                            onClick={() => { setSelectedTask(task); setIsCreating(false); if (window.innerWidth < 1024) setIsSidebarOpen(false); }}
                            className={`
                                p-4 rounded-xl cursor-pointer transition-all border
                                ${selectedTask?.id === task.id
                                    ? "bg-slate-700/50 border-indigo-500/50 shadow-md"
                                    : "bg-slate-800/30 border-transparent hover:bg-slate-800 hover:border-slate-700"}
                            `}
                        >
                            <h3 className="font-medium text-slate-200 line-clamp-1 mb-1">{task.media_filename}</h3>
                            <div className="flex justify-between items-center text-xs text-slate-500">
                                <span>{formatDate(task.created_at)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Area */}
            <div className="flex-1 flex flex-col relative bg-[#0f172a] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#0f172a] to-[#0f172a]">

                {/* Header */}
                <header className="h-16 border-b border-slate-800/50 flex items-center px-4 justify-between bg-[#0f172a]/80 backdrop-blur-md sticky top-0 z-20">
                    <div className="flex items-center gap-3">
                        <MobileMenuButton />
                        <button
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className="hidden lg:block p-2 text-slate-400 hover:text-white transition-colors"
                        >
                            {isSidebarOpen ? "◀" : "▶"}
                        </button>
                        <h1 className="text-lg font-semibold text-slate-200">
                            {isCreating ? "Upload New MTG" : selectedTask ? selectedTask.media_filename : "Dashboard"}
                        </h1>
                    </div>
                </header>

                {/* Content */}
                <main className="flex-1 overflow-y-auto p-4 lg:p-8">
                    {isCreating ? (
                        <div className="h-full flex flex-col items-center justify-center animate-fadeIn">
                            <div className={`
                                w-full max-w-2xl border-2 border-dashed rounded-3xl p-12 text-center transition-all duration-300
                                ${isDragging
                                    ? "border-indigo-500 bg-indigo-500/10 scale-105"
                                    : "border-slate-700 hover:border-indigo-400/50 hover:bg-slate-800/50"}
                            `}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                            >
                                <div className="mb-6 inline-flex p-4 rounded-full bg-slate-800 text-indigo-400">
                                    <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                    </svg>
                                </div>
                                <h3 className="text-2xl font-bold text-slate-200 mb-2">Upload MTG Recording</h3>
                                <p className="text-slate-400 mb-8">Drag & drop video/audio files here, or click to browse</p>

                                <label className="inline-block">
                                    <span className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-medium cursor-pointer transition-colors shadow-lg shadow-indigo-500/25">
                                        Select File
                                    </span>
                                    <input type="file" className="hidden" accept="video/*,audio/*" onChange={handleFileUpload} />
                                </label>
                            </div>

                            {isLoading && (
                                <div className="mt-8 w-full max-w-md text-center">
                                    <div className="text-indigo-400 font-mono text-sm mb-2 animate-pulse">{progress}</div>
                                    <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-indigo-500 animate-progress-indeterminate"></div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : selectedTask ? (
                        <div className="max-w-4xl mx-auto space-y-8 animate-fadeIn">
                            <article className="prose prose-invert prose-slate max-w-none">
                                <ReactMarkdown
                                    components={{
                                        h1: ({ node, ...props }) => <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-200 to-white border-b border-indigo-500/30 pb-4 mb-8" {...props} />,
                                        h2: ({ node, ...props }) => <h2 className="text-xl font-semibold text-indigo-300 mt-10 mb-4 flex items-center gap-2" {...props} />,
                                        h3: ({ node, ...props }) => <h3 className="text-lg font-medium text-slate-200 mt-6 mb-3" {...props} />,
                                        strong: ({ node, ...props }) => <strong className="text-indigo-200 font-bold bg-indigo-500/10 px-1 rounded" {...props} />,
                                        a: ({ node, ...props }) => <a className="text-cyan-400 hover:text-cyan-300 underline decoration-cyan-400/30 underline-offset-4" {...props} />,
                                        ul: ({ node, ...props }) => <ul className="list-disc pl-6 space-y-2 text-slate-300" {...props} />,
                                        blockquote: ({ node, ...props }) => (
                                            <blockquote className="border-l-4 border-indigo-500/50 bg-slate-800/30 pl-4 py-2 italic text-slate-400 rounded-r-lg my-6" {...props} />
                                        )
                                    }}
                                >
                                    {selectedTask.feedback}
                                </ReactMarkdown>
                            </article>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500">
                            <div className="text-6xl mb-4 opacity-50">📊</div>
                            <p className="text-lg">Select a review from the sidebar or create a new one.</p>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
