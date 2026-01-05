"use client";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import MobileMenuButton from "../../../components/MobileMenuButton";
import AiChatSidebar from "../../../components/AiChatSidebar";

export default function ConsultingReviewPage() {
    const [tasks, setTasks] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState("");
    const [isDragging, setIsDragging] = useState(false);

    // UI State
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false);

    // Initial Load
    useEffect(() => {
        fetchTasks();
        const handleResize = () => {
            if (window.innerWidth < 1024) {
                setIsSidebarOpen(false);
                setIsChatSidebarOpen(false);
            } else {
                setIsSidebarOpen(true);
                setIsChatSidebarOpen(true);
            }
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
            let contentType = file.type;
            if (!contentType) {
                const ext = file.name.split('.').pop().toLowerCase();
                if (['mp4', 'm4v', 'mov', '3gp', 'mkv', 'avi'].includes(ext)) contentType = 'video/mp4';
                else if (['mp3', 'mpeg'].includes(ext)) contentType = 'audio/mpeg';
                else if (ext === 'wav') contentType = 'audio/wav';
                else if (ext === 'm4a' || ext === 'aac') contentType = 'audio/mp4';
                else if (ext === 'webm') contentType = 'video/webm';
                else if (ext === 'amr') contentType = 'audio/amr';
                else contentType = 'application/octet-stream';
            }

            const urlRes = await fetch(`/api/consulting/upload-url?filename=${encodeURIComponent(file.name)}&content_type=${encodeURIComponent(contentType)}`);
            if (!urlRes.ok) throw new Error("Failed to get upload URL");
            const { upload_url, gcs_path } = await urlRes.json();

            // 2. Upload to GCS
            setProgress("Uploading Media...");
            const uploadRes = await fetch(upload_url, {
                method: "PUT",
                headers: { "Content-Type": contentType },
                body: file,
            });
            if (!uploadRes.ok) {
                const errText = await uploadRes.text();
                throw new Error(`Upload failed to GCS: ${uploadRes.status} ${uploadRes.statusText}`);
            }

            // 3. Process Review
            setProgress("Analyzing with Gemini... (This may take a while)");
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
                if (window.innerWidth < 768) {
                    setIsSidebarOpen(false);
                }
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

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to delete this review?")) return;
        try {
            const res = await fetch(`/api/consulting/review/${id}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setTasks(tasks.filter((t) => t.id !== id));
                if (selectedTask?.id === id) setSelectedTask(null);
            }
        } catch (error) {
            console.error("Failed to delete", error);
        }
    };

    return (
        <div className="flex h-full bg-gray-50 text-slate-800 font-sans overflow-hidden">
            {/* Mobile Sidebar Backdrop */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-30 lg:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Left Sidebar */}
            <div className={`
                fixed inset-y-0 left-0 z-40 bg-white h-full transform transition-all duration-300 ease-in-out shadow-2xl lg:shadow-none
                lg:relative lg:translate-x-0
                ${isSidebarOpen ? "translate-x-0 w-80 border-r" : "-translate-x-full lg:w-0 lg:border-none"} 
                border-gray-200 flex flex-col overflow-hidden flex-shrink-0
            `}>
                <div className="w-80 flex flex-col h-full">
                    <div className="p-4 border-b border-gray-100 bg-gray-50 flex-col flex flex-shrink-0">
                        <div className="flex justify-between items-center mb-2">
                            <h2 className="text-lg font-bold text-slate-700">MTG Review</h2>
                        </div>
                        <p className="text-xs text-slate-500">Consulting Support</p>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {tasks.map((task) => (
                            <div
                                key={task.id}
                                onClick={() => {
                                    setSelectedTask(task);
                                    setIsCreating(false);
                                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                                }}
                                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-cyan-50 transition-colors group relative
                                    ${selectedTask?.id === task.id ? "bg-cyan-100 border-l-4 border-cyan-500" : ""}
                                `}
                            >
                                <div className="flex justify-between items-start">
                                    <h3 className="font-semibold text-slate-800 line-clamp-1">{task.media_filename}</h3>
                                    <button
                                        onClick={(e) => handleDelete(task.id, e)}
                                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                                    >
                                        ×
                                    </button>
                                </div>
                                <div className="flex justify-between items-center mt-1">
                                    <p className="text-xs text-gray-500">
                                        {new Date(task.created_at).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
                {/* Header / Sidebar Toggle */}
                <div className="flex items-center p-2 border-b border-gray-100 lg:border-none gap-2">
                    <MobileMenuButton />
                    {/* Desktop Toggle */}
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="hidden lg:block p-2 rounded-md hover:bg-gray-100 text-gray-500"
                        title={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
                    >
                        {isSidebarOpen ? "◀" : "▶"}
                    </button>

                    <button
                        onClick={() => setIsCreating(true)}
                        className="flex items-center space-x-1 bg-cyan-600 hover:bg-cyan-700 text-white font-medium px-3 py-1.5 rounded-full shadow-sm transition-colors text-sm"
                    >
                        <span>+ New Review</span>
                    </button>

                    <span className="font-semibold text-slate-700 lg:hidden line-clamp-1">
                        {isCreating ? "New Review" : selectedTask ? selectedTask.media_filename : "Review"}
                    </span>

                    <div className="flex-1" />

                    {selectedTask && !isCreating && (
                        <button
                            onClick={() => setIsChatSidebarOpen(!isChatSidebarOpen)}
                            className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${isChatSidebarOpen ? "text-cyan-600 bg-cyan-50" : "text-gray-400"}`}
                            title="Toggle AI Chat"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* Mobile FAB */}
                <button
                    onClick={() => setIsSidebarOpen(true)}
                    className={`lg:hidden fixed bottom-6 right-6 z-50 w-14 h-14 bg-cyan-600 text-white rounded-full shadow-lg hover:bg-cyan-700 transition-all ${isSidebarOpen ? "hidden" : "flex"} items-center justify-center`}
                >
                    <span className="text-xl">☰</span>
                </button>

                <div className="flex-1 flex overflow-hidden relative">
                    {isCreating ? (
                        <div className="flex-1 flex items-center justify-center p-4 sm:p-8 overflow-y-auto">
                            <div className="w-full max-w-lg bg-white p-4 sm:p-8 rounded-2xl shadow-xl border border-gray-100 text-center">
                                <h3 className="text-2xl font-bold mb-6 text-slate-800">Upload Recording</h3>
                                <div className="mb-8">
                                    <label
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                        className={`flex flex-col items-center px-4 py-10 bg-white text-blue rounded-lg shadow-lg tracking-wide uppercase border border-blue cursor-pointer transition-colors
                                        ${isDragging ? "bg-cyan-100 border-cyan-500 scale-105" : "hover:bg-blue-50"}
                                    `}
                                    >
                                        <svg className="w-8 h-8 text-blue-500" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                            <path d="M16.88 9.1A4 4 0 0 1 16 17H5a5 5 0 0 1-1-9.9V7a3 3 0 0 1 4.52-2.59A4.98 4.98 0 0 1 17 8c0 .38-.04.74-.12 1.1zM11 11h3l-4-4-4 4h3v3h2v-3z" />
                                        </svg>
                                        <span className="mt-2 text-base leading-normal text-slate-600">
                                            {isDragging ? "Drop video/audio here" : "Select or Drop a file"}
                                        </span>
                                        <input type='file' accept="video/*,audio/*" className="hidden" onChange={handleFileUpload} />
                                    </label>
                                </div>
                                {isLoading && (
                                    <div className="space-y-4">
                                        <div className="text-cyan-600 font-medium animate-pulse">{progress}</div>
                                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                                            <div className="bg-cyan-600 h-2.5 rounded-full animate-progress-indeterminate"></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : selectedTask ? (
                        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
                            <div className="max-w-4xl mx-auto">
                                <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-2">{selectedTask.media_filename}</h1>
                                <div className="flex items-center space-x-4 mb-4 text-sm text-gray-500">
                                    <span>Analyzed on {new Date(selectedTask.created_at).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                </div>

                                <article className="prose prose-slate lg:prose-lg max-w-none">
                                    <ReactMarkdown
                                        components={{
                                            h2: ({ node, ...props }) => (
                                                <h2 className="text-2xl font-bold text-slate-800 mt-10 mb-6 pb-2 border-b border-gray-200" {...props} />
                                            ),
                                            h3: ({ node, ...props }) => (
                                                <h3 className="text-xl font-semibold text-slate-700 mt-8 mb-4 border-l-4 border-cyan-200 pl-3" {...props} />
                                            ),
                                            ul: ({ node, ...props }) => (
                                                <ul className="list-disc pl-6 space-y-2 mb-6 text-slate-600" {...props} />
                                            ),
                                            blockquote: ({ node, ...props }) => (
                                                <div className="bg-cyan-50 border-l-4 border-cyan-500 p-4 my-6 rounded-r-lg shadow-sm text-slate-700 relative font-medium not-italic" {...props}>
                                                    <div className="pt-2">
                                                        {props.children}
                                                    </div>
                                                </div>
                                            )
                                        }}
                                    >
                                        {selectedTask.feedback}
                                    </ReactMarkdown>
                                </article>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-400">
                            <div className="text-center">
                                <p className="text-6xl mb-4">📊</p>
                                <p className="text-xl font-medium">Select a review or upload a new recording</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Sidebar (Chat) */}
            <AiChatSidebar
                isOpen={isChatSidebarOpen && selectedTask && !isCreating}
                onClose={() => setIsChatSidebarOpen(false)}
                context={selectedTask ? `**File**: ${selectedTask.media_filename}
**Date**: ${new Date(selectedTask.created_at).toLocaleString()}

[MTG REVIEW ANALYSIS]
${selectedTask.feedback}` : ""}
                contextTitle={selectedTask?.media_filename}
            />
        </div>
    );
}
