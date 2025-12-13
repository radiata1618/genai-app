"use client";
import React, { useState, useEffect } from 'react';
import MobileMenuButton from '../../../components/MobileMenuButton';

export default function AdminPage() {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [uploading, setUploading] = useState(false);

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

    const handleToggleSelect = (filename) => {
        setSelectedFiles(prev => {
            if (prev.includes(filename)) return prev.filter(f => f !== filename);
            return [...prev, filename];
        });
    };

    const handleSelectAll = () => {
        if (selectedFiles.length === files.length) {
            setSelectedFiles([]);
        } else {
            setSelectedFiles(files.map(f => f.name));
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
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-slate-800 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center gap-4 p-4 bg-white shadow-sm border-b border-slate-200">
                <MobileMenuButton />
                <h1 className="text-xl font-bold text-slate-800">Consulting Data Manager</h1>
            </div>

            <div className="p-6 max-w-6xl mx-auto w-full space-y-6">

                {/* NOTICE BLOCK - Local App Instruction */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
                    <div className="font-bold flex items-center gap-2 mb-2">
                        <span>⚠️</span> Web Scraping / Data Collection
                    </div>
                    <p className="mb-2">
                        To avoid blocking (Error 403), data collection must be performed using the <strong>Local App</strong>.
                    </p>
                    <div className="bg-white border border-amber-200 rounded p-2 font-mono text-xs">
                        streamlit run backend/scripts/local_gui.py
                    </div>
                </div>

                {/* Toolbar */}
                <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-slate-200">
                    <div className="flex items-center gap-4">
                        <h2 className="font-bold text-lg">Stored Files (GCS)</h2>
                        <span className="text-slate-400 text-sm">{files.length} files</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <label className={`cursor-pointer bg-cyan-600 text-white px-4 py-2 rounded-md hover:bg-cyan-700 transition-colors font-bold text-sm flex items-center gap-2 ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <span>{uploading ? 'Uploading...' : 'Upload PDF'}</span>
                            <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
                        </label>

                        {selectedFiles.length > 0 && (
                            <button
                                onClick={handleDelete}
                                disabled={loading}
                                className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-md hover:bg-red-100 transition-colors font-bold text-sm"
                            >
                                Delete ({selectedFiles.length})
                            </button>
                        )}

                        <button
                            onClick={fetchFiles}
                            className="p-2 text-slate-500 hover:text-slate-800 transition-colors"
                            title="Refresh"
                        >
                            🔄
                        </button>
                    </div>
                </div>

                {/* File Table */}
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                            <tr>
                                <th className="p-4 w-10">
                                    <input
                                        type="checkbox"
                                        checked={files.length > 0 && selectedFiles.length === files.length}
                                        onChange={handleSelectAll}
                                        className="rounded border-slate-300 focus:ring-cyan-500"
                                    />
                                </th>
                                <th className="p-4">Filename</th>
                                <th className="p-4 w-32">Size</th>
                                <th className="p-4 w-48">Uploaded</th>
                                <th className="p-4 w-24 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && files.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-400">Loading files...</td>
                                </tr>
                            ) : files.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-400">No files found.</td>
                                </tr>
                            ) : (
                                files.map((file) => (
                                    <tr key={file.name} className="hover:bg-slate-50 transition-colors group">
                                        <td className="p-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedFiles.includes(file.name)}
                                                onChange={() => handleToggleSelect(file.name)}
                                                className="rounded border-slate-300 focus:ring-cyan-500"
                                            />
                                        </td>
                                        <td className="p-4 font-medium text-slate-700">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xl text-red-500">📄</span>
                                                {file.basename}
                                            </div>
                                            <div className="text-xs text-slate-400 pl-7">{file.name}</div>
                                        </td>
                                        <td className="p-4 text-slate-500 font-mono text-xs">{formatSize(file.size)}</td>
                                        <td className="p-4 text-slate-500">{new Date(file.updated).toLocaleString()}</td>
                                        <td className="p-4 text-right">
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
    );
}
