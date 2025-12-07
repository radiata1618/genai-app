"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

export default function FilesPage() {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);

    const fetchFiles = async () => {
        setLoading(true);
        try {
            const data = await api.getFiles();
            setFiles(data);
        } catch (e) {
            console.error(e);
            alert("Failed to load files");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFiles();
    }, []);

    // Native DnD State
    const [isDragActive, setIsDragActive] = useState(false);

    const onDragOver = useCallback((e) => {
        e.preventDefault();
        setIsDragActive(true);
    }, []);

    const onDragLeave = useCallback((e) => {
        e.preventDefault();
        setIsDragActive(false);
    }, []);

    const onDrop = useCallback(async (e) => {
        e.preventDefault();
        setIsDragActive(false);
        const acceptedFiles = e.dataTransfer.files;

        if (acceptedFiles.length > 0) {
            setUploading(true);
            try {
                for (const file of acceptedFiles) {
                    await api.uploadFile(file);
                }
                fetchFiles();
            } catch (e) {
                console.error(e);
                alert("Failed to upload");
            } finally {
                setUploading(false);
            }
        }
    }, []);

    // File Input Helper
    const fileInputRef = React.useRef(null);
    const onFileInputChange = async (e) => {
        const files = e.target.files;
        if (files.length > 0) {
            setUploading(true);
            try {
                for (const file of files) {
                    await api.uploadFile(file);
                }
                fetchFiles();
            } catch (e) {
                console.error(e);
                alert("Failed to upload");
            } finally {
                setUploading(false);
            }
        }
    };
    const openFileDialog = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };

    const handleDelete = async (filename) => {
        if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
        try {
            await api.deleteFile(filename);
            setFiles(files.filter(f => f.name !== filename));
        } catch (e) {
            console.error(e);
            alert("Failed to delete");
        }
    };

    const formatBytes = (bytes, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8 font-sans">
            <div className="max-w-6xl mx-auto space-y-8">

                <h1 className="text-3xl font-black text-slate-800">File Management</h1>
                <p className="text-slate-500">Manage files in <code>GCS/manual_pages/</code> for RAG.</p>

                {/* Dropzone */}
                <div
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onClick={openFileDialog}
                    className={`border-4 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors
                        ${isDragActive ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-200'}
                    `}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={onFileInputChange}
                        style={{ display: 'none' }}
                        multiple
                    />
                    {uploading ? (
                        <p className="text-xl font-bold text-indigo-600 animate-pulse">Uploading...</p>
                    ) : (
                        <div>
                            <p className="text-4xl mb-4">📂</p>
                            <p className="text-lg font-bold text-slate-600">Drag & drop files here, or click to select files</p>
                            <p className="text-sm text-slate-400 mt-2">Supports images, PDFs, etc. Uploaded to `manual_pages/`.</p>
                        </div>
                    )}
                </div>

                {/* Loading State */}
                {loading && (
                    <div className="text-center py-12">
                        <div className="animate-spin text-4xl mb-2">🌀</div>
                        <p className="text-slate-400">Loading files...</p>
                    </div>
                )}

                {/* File Grid */}
                {!loading && files.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {files.map((file) => (
                            <div key={file.name} className={`relative group p-4 rounded-xl border shadow-sm transition-all
                                ${file.type === 'folder'
                                    ? 'bg-amber-50 border-amber-200'
                                    : 'bg-white border-slate-200 hover:shadow-md'}
                            `}>
                                <div className="aspect-square bg-slate-100 rounded-lg mb-4 flex items-center justify-center overflow-hidden relative">
                                    {file.type === 'folder' ? (
                                        <span className="text-6xl opacity-80">📁</span>
                                    ) : (
                                        <>
                                            {/* Simple Image Preview Check */}
                                            {['jpg', 'jpeg', 'png', 'gif', 'webp'].some(ext => file.name.toLowerCase().endsWith(ext)) ? (
                                                <img src={file.media_link} alt={file.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="text-4xl opacity-50">📄</span>
                                            )}
                                        </>
                                    )}
                                </div>

                                <h3 className="font-bold text-slate-700 text-sm truncate" title={file.name}>{file.name}</h3>
                                {file.type !== 'folder' && <p className="text-xs text-slate-400 mt-1">{formatBytes(file.size)}</p>}

                                {file.type !== 'folder' && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDelete(file.name); }}
                                        className="absolute top-2 right-2 bg-red-100 text-red-600 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-200"
                                        title="Delete"
                                    >
                                        🗑️
                                    </button>
                                )}

                                {file.type === 'folder' && (
                                    <div className="absolute top-2 right-2 text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                                        Read Only
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {!loading && files.length === 0 && (
                    <div className="text-center py-12 text-slate-400 italic">No files found in manual_pages/.</div>
                )}

            </div>
        </div>
    );
}
