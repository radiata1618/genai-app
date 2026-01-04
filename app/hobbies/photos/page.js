"use client";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import MobileMenuButton from "../../../components/MobileMenuButton";
import AiChatSidebar from "../../../components/AiChatSidebar";

export default function PhotosPage() {
    const [tasks, setTasks] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [selectedImageUrl, setSelectedImageUrl] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState("");

    const [isDragging, setIsDragging] = useState(false);

    // Upload Mode
    const [uploadMode, setUploadMode] = useState("file"); // "file" or "url"
    const [photoUrl, setPhotoUrl] = useState("");

    // Camera Selection
    const [cameraModel, setCameraModel] = useState("RX100 VII"); // Default

    // UI State
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [isChatSidebarOpen, setIsChatSidebarOpen] = useState(false);

    const fetchTasks = async () => {
        try {
            const res = await fetch("/api/hobbies/photos");
            if (res.ok) {
                const data = await res.json();
                setTasks(data);
            }
        } catch (error) {
            console.error("Failed to fetch photos", error);
        }
    };

    useEffect(() => {
        fetchTasks();
        const handleResize = () => {
            if (window.innerWidth < 1024) {
                setIsSidebarOpen(false);
                setIsChatSidebarOpen(false); // Close chat on smaller screens
            } else {
                setIsSidebarOpen(true);
                setIsChatSidebarOpen(true); // Open chat on desktop
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const fetchImageUrl = async (taskId) => {
        try {
            const res = await fetch(`/api/hobbies/photos/${taskId}/image-url`);
            if (res.ok) {
                const data = await res.json();
                return data.url;
            }
        } catch (e) {
            console.error(e);
        }
        return null;
    };

    const handleSelectTask = async (task) => {
        setSelectedTask(task);
        if (window.innerWidth < 768) setIsSidebarOpen(false);

        // Fetch URL
        const url = await fetchImageUrl(task.id);
        setSelectedImageUrl(url);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        setProgress("Getting upload URL...");

        try {
            // 1. Get Signed URL
            const urlRes = await fetch(`/api/hobbies/photos/upload-url?filename=${encodeURIComponent(file.name)}&content_type=${encodeURIComponent(file.type)}`);
            if (!urlRes.ok) throw new Error("Failed to get upload URL");
            const { upload_url, gcs_path } = await urlRes.json();

            // 2. Upload to GCS
            setProgress("Uploading photo...");
            const uploadRes = await fetch(upload_url, {
                method: "PUT",
                headers: { "Content-Type": file.type },
                body: file,
            });
            if (!uploadRes.ok) throw new Error("Failed to upload to GCS");

            // 3. Analyze
            setProgress("Analyzing photo with Gemini 3 Flash...");
            const analyzeRes = await fetch("/api/hobbies/photos/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: file.name,
                    gcs_path: gcs_path,
                    camera_model: cameraModel
                }),
            });

            if (analyzeRes.ok) {
                const newTask = await analyzeRes.json();
                setTasks([newTask, ...tasks]);
                await handleSelectTask(newTask); // Select it immediately
                setIsCreating(false);
            } else {
                throw new Error("Analysis failed");
            }
        } catch (error) {
            console.error("Error:", error);
            alert("Failed: " + error.message);
        } finally {
            setIsLoading(false);
            setProgress("");
        }
    };

    const handleUrlImport = async (e) => {
        e.preventDefault();
        if (!photoUrl.trim()) return;

        setIsLoading(true);
        setProgress("Importing & Analyzing photo...");

        try {
            const analyzeRes = await fetch("/api/hobbies/photos/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: "Imported Photo",
                    photo_url: photoUrl,
                    camera_model: cameraModel
                }),
            });

            if (analyzeRes.ok) {
                const newTask = await analyzeRes.json();
                setTasks([newTask, ...tasks]);
                await handleSelectTask(newTask);
                setIsCreating(false);
                setPhotoUrl("");
            } else {
                const err = await analyzeRes.json();
                throw new Error(err.detail || "Analysis failed");
            }
        } catch (error) {
            console.error("Error:", error);
            alert("Failed: " + error.message);
        } finally {
            setIsLoading(false);
            setProgress("");
        }
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!confirm("Are you sure?")) return;
        try {
            const res = await fetch(`/api/hobbies/photos/${id}`, { method: "DELETE" });
            if (res.ok) {
                setTasks(tasks.filter((t) => t.id !== id));
                if (selectedTask?.id === id) {
                    setSelectedTask(null);
                    setSelectedImageUrl(null);
                }
            }
        } catch (error) {
            console.error("Failed to delete", error);
        }
    };

    // Drag & Drop handlers
    const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith("image/")) {
            handleFileUpload({ target: { files: [file] } });
        } else {
            alert("Please drop an image file.");
        }
    };

    return (
        <div className="flex h-full bg-gray-50 text-slate-800 font-sans overflow-hidden">
            {/* Mobile Sidebar Backdrop */}
            {isSidebarOpen && (
                <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
            )}

            {/* Left Sidebar */}
            <div className={`
                fixed inset-y-0 left-0 z-40 bg-white h-full transform transition-all duration-300 ease-in-out shadow-lg lg:shadow-none
                lg:relative lg:translate-x-0
                ${isSidebarOpen ? "translate-x-0 w-80 border-r" : "-translate-x-full lg:w-0 lg:border-none"} 
                border-gray-200 flex flex-col overflow-hidden flex-shrink-0
            `}>
                <div className="p-4 border-b border-gray-100 bg-gray-50">
                    <h2 className="text-lg font-bold text-slate-700">Photos</h2>
                    <p className="text-xs text-slate-500">Camera: {cameraModel}</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {tasks.map((task) => (
                        <div
                            key={task.id}
                            onClick={() => handleSelectTask(task)}
                            className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-cyan-50 transition-colors group relative
                                ${selectedTask?.id === task.id ? "bg-cyan-100 border-l-4 border-cyan-500" : ""}
                            `}
                        >
                            <div className="flex justify-between items-start">
                                <h3 className="font-semibold text-slate-800 line-clamp-1">{task.filename}</h3>
                                <button onClick={(e) => handleDelete(task.id, e)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2">×</button>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                                <p className="text-xs text-gray-500">{new Date(task.created_at).toLocaleDateString()}</p>
                                {task.score !== undefined && (
                                    <span className="text-xs font-bold text-cyan-600 bg-cyan-100 px-2 py-0.5 rounded">Score: {task.score}</span>
                                )}
                            </div>
                        </div>
                    ))}
                    {tasks.length === 0 && (
                        <div className="p-4 text-center text-gray-400 text-sm">No photos yet.</div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white relative">
                {/* Header */}
                <div className="flex items-center p-2 border-b border-gray-100 lg:border-none gap-2">
                    <MobileMenuButton />
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="hidden lg:block p-2 rounded-md hover:bg-gray-100 text-gray-500"
                    >
                        {isSidebarOpen ? "◀" : "▶"}
                    </button>

                    <button
                        onClick={() => setIsCreating(true)}
                        className="flex items-center space-x-1 bg-cyan-600 hover:bg-cyan-700 text-white font-medium px-3 py-1.5 rounded-full shadow-sm transition-colors text-sm"
                    >
                        <span>+ New Photo</span>
                    </button>

                    <span className="font-semibold text-slate-700 lg:hidden line-clamp-1">Photos</span>

                    <div className="flex-1" />

                    {selectedTask && !isCreating && (
                        <button
                            onClick={() => setIsChatSidebarOpen(!isChatSidebarOpen)}
                            className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${isChatSidebarOpen ? "text-cyan-600 bg-cyan-50" : "text-gray-400"}`}
                            title="Camera Guide"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
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
                        <div className="flex-1 flex items-center justify-center p-4 overflow-y-auto">
                            <div className="w-full max-w-lg bg-white p-8 rounded-2xl shadow-xl border border-gray-100 text-center">
                                <h3 className="text-2xl font-bold mb-4 text-slate-800">Upload Photo</h3>

                                {/* Camera Selection */}
                                <div className="mb-6 flex justify-center space-x-4">
                                    <button
                                        onClick={() => setCameraModel("RX100 VII")}
                                        className={`px-4 py-2 rounded-lg border ${cameraModel === "RX100 VII" ? "bg-cyan-50 border-cyan-500 text-cyan-700 font-bold" : "border-gray-200 text-gray-600"}`}
                                    >
                                        RX100 VII
                                    </button>
                                    <button
                                        onClick={() => setCameraModel("Oppo Smartphone")}
                                        className={`px-4 py-2 rounded-lg border ${cameraModel === "Oppo Smartphone" ? "bg-cyan-50 border-cyan-500 text-cyan-700 font-bold" : "border-gray-200 text-gray-600"}`}
                                    >
                                        Oppo
                                    </button>
                                </div>

                                {/* Tabs */}
                                <div className="flex justify-center mb-6 border-b border-gray-100">
                                    <button
                                        onClick={() => setUploadMode("file")}
                                        className={`pb-2 px-4 text-sm font-medium transition-colors relative ${uploadMode === "file" ? "text-cyan-600" : "text-gray-400 hover:text-gray-600"}`}
                                    >
                                        File Upload
                                        {uploadMode === "file" && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-cyan-600 rounded-t-full" />}
                                    </button>
                                    <button
                                        onClick={() => setUploadMode("url")}
                                        className={`pb-2 px-4 text-sm font-medium transition-colors relative ${uploadMode === "url" ? "text-cyan-600" : "text-gray-400 hover:text-gray-600"}`}
                                    >
                                        Google Photos Link
                                        {uploadMode === "url" && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-cyan-600 rounded-t-full" />}
                                    </button>
                                </div>

                                <div className="mb-8">
                                    {uploadMode === "file" ? (
                                        <label
                                            onDragOver={handleDragOver}
                                            onDragLeave={handleDragLeave}
                                            onDrop={handleDrop}
                                            className={`flex flex-col items-center px-4 py-10 bg-white text-cyan-600 rounded-lg shadow-lg tracking-wide uppercase border border-cyan-200 cursor-pointer transition-colors
                                                ${isDragging ? "bg-cyan-100 border-cyan-500 scale-105" : "hover:bg-cyan-50"}
                                            `}
                                        >
                                            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path d="M16.88 9.1A4 4 0 0 1 16 17H5a5 5 0 0 1-1-9.9V7a3 3 0 0 1 4.52-2.59A4.98 4.98 0 0 1 17 8c0 .38-.04.74-.12 1.1zM11 11h3l-4-4-4 4h3v3h2v-3z" /></svg>
                                            <span className="mt-2 text-base leading-normal">Select or Drop Photo</span>
                                            <input type='file' accept="image/*" className="hidden" onChange={handleFileUpload} />
                                        </label>
                                    ) : (
                                        <form onSubmit={handleUrlImport} className="flex flex-col space-y-4">
                                            <input
                                                type="url"
                                                placeholder="Paste Google Photos link (e.g. https://photos.app.goo.gl/...)"
                                                value={photoUrl}
                                                onChange={(e) => setPhotoUrl(e.target.value)}
                                                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-cyan-500 outline-none text-sm"
                                                required
                                            />
                                            <button
                                                type="submit"
                                                disabled={isLoading || !photoUrl}
                                                className="w-full py-3 bg-cyan-600 text-white rounded-lg font-bold shadow-md hover:bg-cyan-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                                            >
                                                Import & Analyze
                                            </button>
                                            <p className="text-xs text-gray-400 text-left">
                                                Note: Supports shared links from Google Photos. The image will be imported for analysis.
                                            </p>
                                        </form>
                                    )}
                                </div>
                                {isLoading && (
                                    <div className="space-y-4">
                                        <div className="text-cyan-600 font-medium animate-pulse">{progress}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : selectedTask ? (
                        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
                            <div className="max-w-4xl mx-auto">
                                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">{selectedTask.filename}</h1>
                                <div className="flex items-center space-x-2 mb-6">
                                    <span className="px-2 py-1 bg-gray-100 rounded text-xs text-gray-600">Captured with: {selectedTask.camera_model}</span>
                                    <span className="px-2 py-1 bg-cyan-100 text-cyan-700 rounded text-xs font-bold">Score: {selectedTask.score}/100</span>
                                </div>

                                {selectedImageUrl && (
                                    <div className="mb-8 bg-black/5 rounded-lg overflow-hidden flex justify-center shadow-lg">
                                        <img src={selectedImageUrl} alt={selectedTask.filename} className="max-h-[500px] w-auto object-contain" />
                                    </div>
                                )}

                                <article className="prose prose-slate max-w-none">
                                    <ReactMarkdown>{selectedTask.advice}</ReactMarkdown>
                                </article>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-400">
                            <div className="text-center">
                                <p className="text-6xl mb-4">📸</p>
                                <p className="text-xl">Select a photo or upload new</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Sidebar */}
            <AiChatSidebar
                isOpen={isChatSidebarOpen && selectedTask && !isCreating}
                onClose={() => setIsChatSidebarOpen(false)}
                context={selectedTask?.advice}
                contextTitle={selectedTask?.filename}
                apiEndpoint="/api/hobbies/photos/chat"
            />
        </div >
    );
}
