"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import MobileMenuButton from '../../../components/MobileMenuButton';

export default function AdminPage() {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    // Auto-refresh on mount
    useEffect(() => {
        fetchFiles();
    }, []);

    const fetchFiles = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/consulting/files');
            const data = await res.json();
            if (data.files) {
                setFiles(data.files);
            }
        } catch (e) {
            console.error("Failed to fetch files", e);
        } finally {
            setLoading(false);
        }
    };

    const [taskModal, setTaskModal] = useState({ open: false, title: '', logs: [] });
    // Keep track of active task ID to stream
    const [activeTaskId, setActiveTaskId] = useState(null);

    // Filter Files
    const filteredFiles = files.filter(f =>
        f.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // --- Task Streaming Logic ---
    useEffect(() => {
        if (!activeTaskId) return;

        console.log("Connecting to stream for", activeTaskId);
        const eventSource = new EventSource(`/api/consulting/tasks/${activeTaskId}/stream`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setTaskModal(prev => ({ ...prev, logs: [...prev.logs, data.message] }));

            if (data.message === "DONE" || data.message.includes("Critical Error")) {
                eventSource.close();
                setActiveTaskId(null);
            }
        };

        eventSource.onerror = () => {
            console.error("Stream error");
            eventSource.close();
            setActiveTaskId(null);
        };

        return () => {
            eventSource.close();
        };
    }, [activeTaskId]);

    const startTask = async (endpoint, title) => {
        setLoading(true);
        setTaskModal({ open: true, title, logs: ["Starting..."] });
        try {
            const res = await fetch(endpoint, { method: 'POST' });
            const data = await res.json();
            if (data.task_id) {
                setActiveTaskId(data.task_id);
            } else {
                setTaskModal(prev => ({ ...prev, logs: [...prev.logs, "Failed to start: No Task ID"] }));
            }
        } catch (e) {
            setTaskModal(prev => ({ ...prev, logs: [...prev.logs, "Error: " + e.message] }));
        } finally {
            setLoading(false);
        }
    };

    const handleToggleSelect = (filename) => {
        setSelectedFiles(prev => {
            if (prev.includes(filename)) return prev.filter(f => f !== filename);
            return [...prev, filename];
        });
    };

    const handleSelectAll = () => {
        const allFilteredSelected = filteredFiles.length > 0 && filteredFiles.every(f => selectedFiles.includes(f.name));

        if (allFilteredSelected) {
            const filteredNames = filteredFiles.map(f => f.name);
            setSelectedFiles(prev => prev.filter(name => !filteredNames.includes(name)));
        } else {
            const filteredNames = filteredFiles.map(f => f.name);
            setSelectedFiles(prev => [...new Set([...prev, ...filteredNames])]);
        }
    };

    const handleDelete = async () => {
        if (!confirm(`Are you sure you want to delete ${selectedFiles.length} files?`)) return;

        setLoading(true);
        try {
            await fetch('/api/consulting/files/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filenames: selectedFiles })
            });
            setSelectedFiles([]);
            await fetchFiles();
        } catch (e) {
            alert("Delete failed");
        } finally {
            setLoading(false);
        }
    };

    const handleView = async (filename) => {
        try {
            const res = await fetch('/api/consulting/files/signed-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename })
            });
            const data = await res.json();
            if (data.url) {
                window.open(data.url, '_blank');
            }
        } catch (e) {
            alert("Failed to open file");
        }
    };

    const handleIngest = async () => {
        if (!confirm("Start new ingestion batch? This process runs in the background.")) return;
        setLoading(true);
        try {
            const res = await fetch('/api/consulting/ingest', { method: 'POST' });
            if (!res.ok) throw new Error("Failed to start batch");
            const data = await res.json();
            alert(`Batch started! ID: ${data.batch_id}\nCheck 'History' for progress.`);
            // Optional: redirect to history?
            // window.location.href = '/consulting/batches';
        } catch (e) {
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/consulting/files/upload', {
                method: 'POST',
                body: formData
            });
            if (!res.ok) throw new Error("Upload failed");
            await fetchFiles();
        } catch (e) {
            alert("Upload failed: " + e.message);
        } finally {
            setUploading(false);
            e.target.value = null; // reset input
        }
    };

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-slate-800 overflow-hidden relative">

            {/* Task Monitor Modal */}
            {taskModal.open && (
                <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold flex items-center gap-2">
                                {activeTaskId && <span className="animate-spin">⏳</span>}
                                {taskModal.title}
                            </h3>
                            <button
                                onClick={() => setTaskModal(prev => ({ ...prev, open: false }))}
                                className="text-slate-400 hover:text-slate-600"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="p-4 bg-slate-900 overflow-y-auto flex-1 font-mono text-xs text-green-400 space-y-1">
                            {taskModal.logs.map((log, idx) => (
                                <div key={idx} className="break-all">{log}</div>
                            ))}
                            <div ref={(el) => el?.scrollIntoView({ behavior: "smooth" })} />
                        </div>
                    </div>
                </div>
            )}

            {/* Header - Compact */}
            <div className="flex-none bg-white shadow-sm border-b border-slate-200 z-20">
                <div className="flex items-center gap-3 p-3">
                    <MobileMenuButton />
                    <h1 className="text-lg font-bold text-slate-800">Consulting Data Manager</h1>
                </div>
            </div>

            {/* Fixed Control Area (Notice + Toolbar) */}
            <div className="flex-none p-4 max-w-6xl mx-auto w-full space-y-4">
                {/* NOTICE BLOCK - Local App Instruction */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 flex items-start gap-3">
                    <span className="text-lg">⚠️</span>
                    <div className="flex-1">
                        <p className="font-bold mb-1">Web Scraping / Data Collection</p>
                        <div className="flex flex-wrap items-center gap-2">
                            <span>To avoid blocking (403), use Local App:</span>
                            <code className="bg-white border text-xs px-1 rounded">backend/scripts/local_gui.py</code>
                        </div>
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-3 rounded-lg shadow-sm border border-slate-200 gap-3">
                    <div className="flex items-center gap-4 w-full sm:w-auto">
                        <div className="flex gap-2 mr-4 border-r border-slate-200 pr-4">
                            <button
                                onClick={handleIngest}
                                className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-md hover:bg-indigo-100 transition-colors font-bold text-xs flex items-center gap-1"
                            >
                                <span>📥</span> Ingest to DB
                            </button>
                            <Link
                                href="/consulting/batches"
                                className="bg-slate-100 text-slate-700 border border-slate-300 px-3 py-1.5 rounded-md hover:bg-slate-200 transition-colors font-bold text-xs flex items-center gap-1"
                            >
                                <span>📜</span> History
                            </Link>
                            <button
                                onClick={() => startTask('/api/consulting/index', 'Creating Vector Index...')}
                                className="bg-fuchsia-50 text-fuchsia-700 px-3 py-1.5 rounded-md hover:bg-fuchsia-100 transition-colors font-bold text-xs flex items-center gap-1"
                            >
                                <span>⚡</span> Create Index
                            </button>
                        </div>

                        <div className="relative w-full sm:w-64">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
                            <input
                                type="text"
                                placeholder="Search files..."
                                className="pl-9 pr-3 py-1.5 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none w-full"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <span className="text-slate-400 text-sm whitespace-nowrap">{filteredFiles.length} files</span>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <label className={`cursor-pointer bg-cyan-600 text-white px-3 py-1.5 rounded-md hover:bg-cyan-700 transition-colors font-bold text-sm flex items-center gap-2 ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <span>{uploading ? 'Uploading...' : 'Upload PDF'}</span>
                            <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
                        </label>

                        {selectedFiles.length > 0 && (
                            <button
                                onClick={handleDelete}
                                disabled={loading}
                                className="bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-md hover:bg-red-100 transition-colors font-bold text-sm"
                            >
                                Delete ({selectedFiles.length})
                            </button>
                        )}

                        <button
                            onClick={fetchFiles}
                            className="p-1.5 text-slate-500 hover:text-slate-800 transition-colors"
                            title="Refresh"
                        >
                            🔄
                        </button>
                    </div>
                </div>
            </div>

            {/* Scrollable File Table */}
            <div className="flex-1 overflow-y-auto px-4 pb-4">
                <div className="max-w-6xl mx-auto w-full h-full">
                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 h-full flex flex-col">
                        <div className="overflow-auto flex-1 rounded-lg">
                            <table className="w-full text-sm text-left relative border-collapse">
                                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="p-3 w-10 bg-slate-50">
                                            <input
                                                type="checkbox"
                                                checked={filteredFiles.length > 0 && filteredFiles.every(f => selectedFiles.includes(f.name))}
                                                onChange={handleSelectAll}
                                                className="rounded border-slate-300 focus:ring-cyan-500"
                                            />
                                        </th>
                                        <th className="p-3 bg-slate-50">Filename</th>
                                        <th className="p-3 w-32 bg-slate-50">Size</th>
                                        <th className="p-3 w-48 bg-slate-50">Uploaded</th>
                                        <th className="p-3 w-24 text-right bg-slate-50">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {loading && filteredFiles.length === 0 && files.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="p-8 text-center text-slate-400">Loading files...</td>
                                        </tr>
                                    ) : filteredFiles.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="p-8 text-center text-slate-400">
                                                {searchTerm ? "No matches found." : "No files found."}
                                            </td>
                                        </tr>
                                    ) : (
                                        filteredFiles.map((file) => (
                                            <tr key={file.name} className="hover:bg-slate-50 transition-colors group">
                                                <td className="p-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedFiles.includes(file.name)}
                                                        onChange={() => handleToggleSelect(file.name)}
                                                        className="rounded border-slate-300 focus:ring-cyan-500"
                                                    />
                                                </td>
                                                <td className="p-3 font-medium text-slate-700">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xl text-red-500">📄</span>
                                                        <span title={file.name}>{file.basename}</span>
                                                    </div>
                                                    {/* Optional: Show full path on hover or small text if needed, but basename is cleaner */}
                                                </td>
                                                <td className="p-3 text-slate-500 font-mono text-xs">{formatSize(file.size)}</td>
                                                <td className="p-3 text-slate-500">{new Date(file.updated).toLocaleString()}</td>
                                                <td className="p-3 text-right">
                                                    <button
                                                        onClick={() => handleView(file.name)}
                                                        className="opacity-0 group-hover:opacity-100 text-cyan-600 font-bold hover:underline transition-opacity"
                                                    >
                                                        Open
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
