"use client";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

export default function ReviewPage() {
    const [tasks, setTasks] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState("");
    const [uploadProgress, setUploadProgress] = useState(0);

    const fetchTasks = async () => {
        try {
            const res = await fetch("/api/english/review");
            if (res.ok) {
                const data = await res.json();
                setTasks(data);
            }
        } catch (error) {
            console.error("Failed to fetch tasks", error);
        }
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        setUploadProgress(0);
        setProgress("Getting upload URL...");

        try {
            // 1. Get Signed URL
            const urlRes = await fetch(`/api/english/upload-url?filename=${encodeURIComponent(file.name)}&content_type=${encodeURIComponent(file.type)}`);
            if (!urlRes.ok) throw new Error("Failed to get upload URL");
            const { upload_url, gcs_path } = await urlRes.json();

            // 2. Upload to GCS
            setProgress("Uploading video...");
            const uploadRes = await fetch(upload_url, {
                method: "PUT",
                headers: {
                    "Content-Type": file.type,
                },
                body: file,
            });

            if (!uploadRes.ok) throw new Error("Failed to upload to GCS");

            // 3. Process Review (Analysis)
            setProgress("Analyzing with Gemini... (this may take a minute)");
            const reviewRes = await fetch("/api/english/review", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    video_filename: file.name,
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
            alert("Failed to process video: " + error.message);
        } finally {
            setIsLoading(false);
            setProgress("");
            setUploadProgress(0);
        }
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!confirm("Are you sure?")) return;
        try {
            const res = await fetch(`/api/english/review/${id}`, {
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
        <div className="flex h-screen bg-gray-50 text-slate-800 font-sans">
            {/* Left Sidebar */}
            <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
                <div className="p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-700">Review History</h2>
                    <button
                        onClick={() => setIsCreating(true)}
                        className="bg-cyan-600 hover:bg-cyan-700 text-white p-2 rounded-full shadow-md transition-colors"
                    >
                        + New
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {tasks.map((task) => (
                        <div
                            key={task.id}
                            onClick={() => setSelectedTask(task)}
                            className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-cyan-50 transition-colors group relative
                                ${selectedTask?.id === task.id ? "bg-cyan-100 border-l-4 border-cyan-500" : ""}
                            `}
                        >
                            <div className="flex justify-between items-start">
                                <h3 className="font-semibold text-slate-800 line-clamp-1">{task.video_filename}</h3>
                                <button
                                    onClick={(e) => handleDelete(task.id, e)}
                                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                                >
                                    ×
                                </button>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">{new Date(task.created_at).toLocaleDateString()}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
                {isCreating ? (
                    <div className="flex-1 flex items-center justify-center p-8">
                        <div className="w-full max-w-lg bg-white p-8 rounded-2xl shadow-xl border border-gray-100 text-center">
                            <h3 className="text-2xl font-bold mb-6 text-slate-800">Upload Lesson Video</h3>
                            <div className="mb-8">
                                <label className="flex flex-col items-center px-4 py-10 bg-white text-blue rounded-lg shadow-lg tracking-wide uppercase border border-blue cursor-pointer hover:bg-blue-50 transition-colors">
                                    <svg className="w-8 h-8 text-blue-500" fill="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                                        <path d="M16.88 9.1A4 4 0 0 1 16 17H5a5 5 0 0 1-1-9.9V7a3 3 0 0 1 4.52-2.59A4.98 4.98 0 0 1 17 8c0 .38-.04.74-.12 1.1zM11 11h3l-4-4-4 4h3v3h2v-3z" />
                                    </svg>
                                    <span className="mt-2 text-base leading-normal text-slate-600">Select a video file</span>
                                    <input type='file' accept="video/*" className="hidden" onChange={handleFileUpload} />
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
                    <div className="flex-1 overflow-y-auto p-8">
                        <div className="max-w-4xl mx-auto">
                            <h1 className="text-3xl font-extrabold text-slate-900 mb-2">{selectedTask.video_filename}</h1>
                            <div className="flex items-center space-x-4 mb-8 text-sm text-gray-500">
                                <span>Reviewed on {new Date(selectedTask.created_at).toLocaleString()}</span>
                            </div>
                            <article className="prose prose-slate lg:prose-lg max-w-none">
                                <ReactMarkdown>{selectedTask.content}</ReactMarkdown>
                            </article>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        <div className="text-center">
                            <p className="text-6xl mb-4">🎥</p>
                            <p className="text-xl font-medium">Select a review or upload a new video</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
