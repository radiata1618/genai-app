"use client";
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';

export default function KnowledgePage() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState(null);
    const fileInputRef = useRef(null);

    // Initial Fetch
    const fetchItems = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/consulting/knowledge?limit=50');
            const data = await res.json();
            setItems(data.items || []);
        } catch (e) {
            console.error("Failed to fetch items", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchItems();
    }, []);

    // Search Handler
    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchQuery.trim()) {
            setSearchResults(null);
            return;
        }

        setLoading(true);
        try {
            // Use Vector Search Endpoint
            const res = await fetch('/api/consulting/knowledge/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: searchQuery, top_k: 10 })
            });
            const data = await res.json();
            // Map results to item structure (or merge with existing if needed)
            // The search endpoint returns { results: [ {id, metadata: {...}} ] }
            const mappedResults = data.results.map(r => ({
                id: r.id,
                ...r.metadata,
                gcs_uri: r.metadata.gcs_uri || "", // Might be missing in metadata response if not added to projection
                // Only metadata fields explicitly set in search_knowledge_db are available
            }));
            setSearchResults(mappedResults);
        } catch (e) {
            console.error("Search failed", e);
        } finally {
            setLoading(false);
        }
    };

    // Upload Handler
    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch('/api/consulting/knowledge/upload', {
                method: 'POST',
                body: formData
            });
            if (!res.ok) throw new Error("Upload failed");

            // Refresh list (it will be pending initially)
            await fetchItems();
        } catch (e) {
            console.error("Upload error", e);
            alert("Upload failed");
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    // Delete Handler
    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to delete this item?")) return;

        try {
            const res = await fetch(`/api/consulting/knowledge/${id}`, {
                method: 'DELETE'
            });
            if (!res.ok) throw new Error("Delete failed");

            // Remove from state
            setItems(items.filter(i => i.id !== id));
            if (searchResults) {
                setSearchResults(searchResults.filter(i => i.id !== id));
            }
        } catch (e) {
            console.error("Delete error", e);
            alert("Failed to delete item.");
        }
    };

    const displayItems = searchResults || items;

    return (
        <div className="min-h-screen bg-gray-50 text-slate-800 p-4 md:p-8 font-sans">
            <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <div>
                    <Link href="/consulting" className="text-cyan-600 hover:text-cyan-700 text-sm mb-2 block font-medium">← Back to Suite</Link>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-teal-500 to-emerald-600">
                        Knowledge Base (RAG)
                    </h1>
                </div>

                <div className="flex gap-4 items-center w-full md:w-auto">
                    <button
                        onClick={() => fileInputRef.current.click()}
                        disabled={uploading}
                        className={`bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 shadow-sm ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        {uploading ? 'Uploading...' : 'Upload File / Photo'}
                    </button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        className="hidden"
                        accept="image/*,application/pdf"
                    />
                </div>
            </header>

            {/* Search Bar */}
            <form onSubmit={handleSearch} className="mb-8 relative max-w-2xl mx-auto">
                <input
                    type="text"
                    placeholder="Search knowledge... (e.g. 'Project Alpha timeline', 'Q3 Financials')"
                    value={searchQuery}
                    onChange={(e) => {
                        setSearchQuery(e.target.value);
                        if (e.target.value === "") setSearchResults(null);
                    }}
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 pl-12 text-slate-700 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors placeholder-gray-400 shadow-sm"
                />
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded text-sm text-slate-600 font-medium transition-colors">
                    Search
                </button>
            </form>

            {/* Content Grid */}
            {loading ? (
                <div className="text-center py-20 text-slate-500">Loading knowledge...</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {displayItems.map((item) => (
                        <div key={item.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-cyan-300 hover:shadow-md transition-all flex flex-col group relative shadow-sm">
                            {/* Delete Button */}
                            <button
                                onClick={(e) => handleDelete(item.id, e)}
                                className="absolute top-2 right-2 p-1.5 bg-white/80 hover:bg-red-50 text-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-all z-10 shadow-sm border border-gray-100"
                                title="Delete"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>

                            {/* Image Thumbnail */}
                            {item.signed_url ? (
                                <div className="h-40 w-full bg-gray-100 flex items-center justify-center overflow-hidden border-b border-gray-100">
                                    <img src={item.signed_url} alt={item.title} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                                </div>
                            ) : (
                                <div className="h-40 w-full bg-gray-50 flex items-center justify-center border-b border-gray-100 text-slate-300">
                                    {item.file_type?.includes('pdf') ?
                                        <span className="text-4xl text-slate-400">📄</span> :
                                        <span className="text-4xl text-slate-400">📝</span>
                                    }
                                </div>
                            )}

                            <div className="p-5 flex-1 flex flex-col">
                                <div className="flex justify-between items-start mb-2 gap-2">
                                    <h3 className="font-bold text-lg text-slate-800 line-clamp-2 leading-tight">
                                        {item.title || "Untitled Document"}
                                    </h3>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${item.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                        item.status === 'processing' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                                            'bg-gray-100 text-gray-500 border border-gray-200'
                                        }`}>
                                        {item.status}
                                    </span>
                                </div>
                                <p className="text-slate-500 text-sm mb-4 line-clamp-3 flex-1 leading-relaxed">
                                    {item.summary || "No summary available."}
                                </p>
                                <div className="mt-auto flex justify-between items-center text-xs text-slate-400 border-t border-gray-100 pt-3 font-medium">
                                    <span>{item.created_at ? format(new Date(item.created_at), 'yyyy-MM-dd') : 'Top Secret'}</span>
                                    <span className="uppercase tracking-wider text-[10px]">{item.file_type?.split('/')[1] || 'FILE'}</span>
                                </div>
                            </div>
                        </div>
                    ))}

                    {displayItems.length === 0 && !loading && (
                        <div className="col-span-full text-center py-20 text-slate-500 bg-white rounded-xl border border-dashed border-gray-300">
                            <div className="text-4xl mb-4 opacity-50">📂</div>
                            <p className="font-medium">No knowledge found. Upload some documents to get started.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
