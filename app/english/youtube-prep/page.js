"use client";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

export default function YouTubePrepPage() {
    const [tasks, setTasks] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newUrl, setNewUrl] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [filterDone, setFilterDone] = useState(false);

    // UI State
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [activeTab, setActiveTab] = useState("split"); // "video", "notes", "split"

    useEffect(() => {
        // Adjust default tab based on screen width
        const handleResize = () => {
            if (window.innerWidth < 1024) {
                if (activeTab === "split") setActiveTab("video");
            }
        };
        // Initial check
        if (typeof window !== 'undefined' && window.innerWidth < 1024) setActiveTab("video");

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [activeTab]);

    useEffect(() => {
        fetchTasks();
    }, []);

    const fetchTasks = async () => {
        try {
            const res = await fetch("/api/english/youtube-prep");
            if (res.ok) {
                const data = await res.json();
                setTasks(data);
            }
        } catch (error) {
            console.error("Failed to fetch tasks", error);
        }
    };

    const handleCreate = async () => {
        if (!newUrl.trim()) return;
        setIsLoading(true);
        try {
            const res = await fetch("/api/english/youtube-prep", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: newUrl }),
            });
            if (res.ok) {
                const newTask = await res.json();
                setTasks([newTask, ...tasks]);
                setSelectedTask(newTask);
                setIsCreating(false);
                setNewUrl("");
                alert("Generation Successful! \n\n作成が完了しました。");
            } else {
                const err = await res.json();
                alert(`Failed: ${err.detail}`);
            }
        } catch (error) {
            console.error("Failed to create task", error);
            alert("An error occurred. Please check your connection.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!confirm("Are you sure?")) return;
        try {
            const res = await fetch(`/api/english/youtube-prep/${id}`, {
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

    const handleToggleStatus = async (task, e) => {
        e.stopPropagation();
        const newStatus = task.status === "DONE" ? "TODO" : "DONE";
        try {
            const res = await fetch(`/api/english/youtube-prep/${task.id}/status?status=${newStatus}`, {
                method: "PATCH"
            });
            if (res.ok) {
                setTasks(tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
                if (selectedTask?.id === task.id) {
                    setSelectedTask({ ...selectedTask, status: newStatus });
                }
            }
        } catch (error) {
            console.error("Failed to update status", error);
        }
    };

    const filteredTasks = tasks.filter(t => filterDone ? true : t.status !== "DONE");

    return (
        <div className="flex h-screen bg-gray-50 text-slate-800 font-sans">
            {/* Left Sidebar for List */}
            <div className={`
                ${isSidebarOpen ? "w-80 border-r" : "w-0 border-none"} 
                transition-all duration-300 ease-in-out
                bg-white flex flex-col overflow-hidden border-gray-200
            `}>
                <div className="p-4 border-b border-gray-100 bg-gray-50 w-80">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-bold text-slate-700">YouTube Prep</h2>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="bg-red-600 hover:bg-red-700 text-white p-2 rounded-full shadow-md transition-colors"
                        >
                            + New
                        </button>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-slate-500">
                        <label className="flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={filterDone}
                                onChange={(e) => setFilterDone(e.target.checked)}
                                className="mr-2"
                            />
                            Show Completed
                        </label>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto w-80">
                    {filteredTasks.map((task) => (
                        <div
                            key={task.id}
                            onClick={() => setSelectedTask(task)}
                            className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-red-50 transition-colors group relative
                                ${selectedTask?.id === task.id ? "bg-red-100 border-l-4 border-red-500" : ""}
                            `}
                        >
                            <div className="flex justify-between items-start">
                                <h3 className="font-semibold text-slate-800 line-clamp-2">{task.topic || task.video_id}</h3>
                                <button
                                    onClick={(e) => handleDelete(task.id, e)}
                                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                                >
                                    ×
                                </button>
                            </div>
                            <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                                <span>{new Date(task.created_at).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
                                <button
                                    onClick={(e) => handleToggleStatus(task, e)}
                                    className={`px-2 py-0.5 rounded border ${task.status === "DONE" ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}
                                >
                                    {task.status}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
                {/* Sidebar Toggle Button (Floating or fixed in header) */}
                <div className="absolute top-4 left-4 z-20">
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="bg-white p-2 rounded-full shadow-md border border-gray-200 text-gray-500 hover:text-slate-800 transition-colors flex items-center justify-center w-8 h-8"
                        title={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
                    >
                        {isSidebarOpen ? "◀" : "▶"}
                    </button>
                </div>

                {isCreating ? (
                    <div className="flex-1 flex items-center justify-center p-8">
                        <div className="w-full max-w-lg bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
                            <h3 className="text-2xl font-bold mb-6 text-slate-800">New YouTube Prep</h3>
                            <input
                                type="text"
                                value={newUrl}
                                onChange={(e) => setNewUrl(e.target.value)}
                                placeholder="Paste YouTube URL here..."
                                disabled={isLoading}
                                className="w-full p-4 border border-gray-300 rounded-xl mb-6 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
                            />
                            <div className="text-sm text-gray-500 mb-6">
                                The system will fetch subtitles and generate a study guide for you.
                            </div>
                            <div className="flex justify-end space-x-4">
                                <button
                                    onClick={() => setIsCreating(false)}
                                    className="px-6 py-2 text-gray-500 hover:text-gray-700 font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCreate}
                                    disabled={isLoading || !newUrl}
                                    className="px-6 py-2 bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 text-white rounded-xl shadow-lg font-bold flex items-center"
                                >
                                    {isLoading ? "Generating..." : "Start Learning"}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : selectedTask ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Tab Header */}
                        <div className="flex items-center justify-center space-x-1 p-2 bg-gray-50 border-b border-gray-200 pl-16">
                            <button
                                onClick={() => setActiveTab("video")}
                                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${activeTab === "video" ? "bg-white text-red-600 shadow-sm ring-1 ring-gray-200" : "text-gray-500 hover:text-gray-700"}`}
                            >
                                Video
                            </button>
                            <button
                                onClick={() => setActiveTab("notes")}
                                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${activeTab === "notes" ? "bg-white text-red-600 shadow-sm ring-1 ring-gray-200" : "text-gray-500 hover:text-gray-700"}`}
                            >
                                Notes
                            </button>
                            <button
                                onClick={() => setActiveTab("split")}
                                className={`hidden lg:block px-4 py-1.5 rounded-full text-sm font-medium transition-all ${activeTab === "split" ? "bg-white text-red-600 shadow-sm ring-1 ring-gray-200" : "text-gray-500 hover:text-gray-700"}`}
                            >
                                Split View
                            </button>
                            <div className="ml-auto pr-4 text-xs text-gray-400 hidden sm:block">
                                Created: {new Date(selectedTask.created_at).toLocaleDateString()}
                            </div>
                        </div>

                        {/* Content Area */}

                        <div className="flex-1 overflow-hidden relative">
                            {/* Video View */}
                            <div className={`absolute inset-0 bg-black flex items-center justify-center transition-all duration-300
                                 ${activeTab === "video" ? "z-10 opacity-100" :
                                    activeTab === "split" ? "w-1/2 z-10 opacity-100 border-r border-gray-800" : "z-0 opacity-0 pointer-events-none"}
                             `}>
                                <iframe
                                    src={`https://www.youtube.com/embed/${selectedTask.video_id}`}
                                    title="YouTube video player"
                                    frameBorder="0"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                    className="w-full h-full"
                                ></iframe>
                            </div>

                            {/* Notes View */}
                            <div className={`absolute inset-0 bg-white overflow-y-auto p-4 md:p-8 transition-all duration-300
                                 ${activeTab === "notes" ? "z-10 opacity-100" :
                                    activeTab === "split" ? "left-1/2 w-1/2 z-10 opacity-100" : "z-0 opacity-0 pointer-events-none"}
                             `}>
                                <div className="max-w-3xl mx-auto">
                                    <h1 className="text-2xl font-extrabold text-slate-900 mb-2">{selectedTask.topic}</h1>
                                    <article className="prose prose-slate max-w-none">
                                        <ReactMarkdown
                                            components={{
                                                h2: ({ node, ...props }) => (
                                                    <h2 className="text-xl font-bold text-slate-800 mt-8 mb-4 pb-2 border-b border-gray-200" {...props} />
                                                ),
                                                h3: ({ node, ...props }) => (
                                                    <h3 className="text-lg font-semibold text-slate-700 mt-6 mb-3 border-l-4 border-red-200 pl-3" {...props} />
                                                ),
                                                ul: ({ node, ...props }) => (
                                                    <ul className="list-disc pl-5 space-y-2 mb-6 text-slate-600" {...props} />
                                                ),
                                                strong: ({ node, ...props }) => {
                                                    const text = typeof props.children === 'string' ? props.children : props.children[0];
                                                    const isEnglish = typeof text === 'string' && /^[A-Za-z0-9\s\-\.\?\'"!]+$/.test(text);
                                                    return (
                                                        <span className="inline-flex items-center">
                                                            <strong className="font-bold text-slate-900 bg-yellow-50 px-1 rounded" {...props} />
                                                            {isEnglish && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const synth = window.speechSynthesis;
                                                                        const cleanText = text.replace(/^[0-9]+[\.\s]+/, '').trim();
                                                                        const u = new SpeechSynthesisUtterance(cleanText);
                                                                        u.lang = 'en-US';
                                                                        synth.speak(u);
                                                                    }}
                                                                    className="ml-2 text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded-full transition-colors"
                                                                    title="Listen"
                                                                >
                                                                    🔊
                                                                </button>
                                                            )}
                                                        </span>
                                                    )
                                                }
                                            }}
                                        >
                                            {selectedTask.content}
                                        </ReactMarkdown>
                                    </article>
                                    <div className="h-20"></div> {/* Bottom spacer */}
                                </div>
                            </div>
                        </div>

                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-400 relative">
                        {/* Sidebar Toggle even in empty state */}
                        <div className="absolute top-4 left-4 z-20">
                            <button
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                className="bg-white p-2 rounded-full shadow-md border border-gray-200 text-gray-500 hover:text-slate-800 transition-colors flex items-center justify-center w-8 h-8"
                            >
                                {isSidebarOpen ? "◀" : "▶"}
                            </button>
                        </div>
                        <div className="text-center">
                            <p className="text-6xl mb-4">📺</p>
                            <p className="text-xl font-medium">Select a video or add a new one</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
