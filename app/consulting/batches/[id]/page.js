"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import MobileMenuButton from '@/components/MobileMenuButton';

export default function BatchDetailPage() {
    const params = useParams();
    const batchId = params.id;

    const [batch, setBatch] = useState(null);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [retrying, setRetrying] = useState(false);

    useEffect(() => {
        if (batchId) fetchDetails();
    }, [batchId]);

    const fetchDetails = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/consulting/batches/${batchId}`);
            const data = await res.json();
            if (data.batch) setBatch(data.batch);
            if (data.items) setItems(data.items);
        } catch (e) {
            console.error("Failed to fetch details", e);
        } finally {
            setLoading(false);
        }
    };

    const handleRetryAllFailed = async () => {
        if (!confirm("Are you sure you want to retry all failed items?")) return;
        setRetrying(true);
        try {
            await fetch(`/api/consulting/batches/${batchId}/retry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_ids: null }) // Retry all failed
            });
            alert("Retry started in background.");
            fetchDetails(); // Reload to see status update (optional, polling better)
        } catch (e) {
            alert("Retry failed: " + e.message);
        } finally {
            setRetrying(false);
        }
    };

    const handleRetryItem = async (itemId) => {
        setRetrying(true);
        try {
            await fetch(`/api/consulting/batches/${batchId}/retry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_ids: [itemId] })
            });
            alert("Retry task queued.");
            // Optimistic update or refresh
            fetchDetails();
        } catch (e) {
            alert("Retry failed");
        } finally {
            setRetrying(false);
        }
    };

    const StatusBadge = ({ status }) => {
        const colors = {
            completed: 'bg-green-100 text-green-800',
            success: 'bg-green-100 text-green-800',
            failed: 'bg-red-100 text-red-800',
            processing: 'bg-blue-100 text-blue-800',
            pending: 'bg-gray-100 text-gray-800',
            skipped: 'bg-yellow-100 text-yellow-800',
        };
        return (
            <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${colors[status] || 'bg-gray-100'}`}>
                {status}
            </span>
        );
    };

    if (!batch && loading) return <div className="p-8 text-center">Loading...</div>;
    if (!batch && !loading) return <div className="p-8 text-center">Batch not found.</div>;

    const failedCount = items.filter(i => i.status === 'failed').length;

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-slate-800 relative">
            {/* Header */}
            <div className="flex-none bg-white shadow-sm border-b border-slate-200 z-20">
                <div className="flex items-center gap-3 p-3">
                    <MobileMenuButton />
                    <div className="flex items-center gap-2">
                        <Link href="/consulting/batches" className="text-slate-500 hover:text-slate-800">
                            ← Back
                        </Link>
                        <h1 className="text-lg font-bold text-slate-800">Job Details</h1>
                    </div>
                </div>
            </div>

            {/* Scrollable Content Area */}
            <div className="flex-1 overflow-y-auto w-full">
                {/* Batch Summary */}
                <div className="p-4 max-w-6xl mx-auto w-full">
                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                {batch.summary || "Ingestion Job"}
                                <StatusBadge status={batch.status} />
                            </h2>
                            <div className="text-sm text-slate-500 mt-1">
                                ID: <span className="font-mono bg-slate-100 px-1 rounded">{batch.id}</span>
                                <span className="mx-2">•</span>
                                Created: {new Date(batch.created_at).toLocaleString()}
                            </div>
                            <div className="text-sm mt-2 flex gap-4">
                                <div className="font-bold text-slate-700">Total: {batch.total_files}</div>
                                <div className="font-bold text-blue-600">Processing: {items.filter(i => i.status === 'processing').length}</div>
                                <div className="font-bold text-green-600">Success: {items.filter(i => i.status === 'success').length}</div>
                                <div className="font-bold text-yellow-600">Skipped: {items.filter(i => i.status === 'skipped').length}</div>
                                <div className="font-bold text-red-600">Failed: {items.filter(i => i.status === 'failed').length}</div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <button onClick={fetchDetails} className="bg-white border border-slate-300 text-slate-600 px-3 py-1.5 rounded hover:bg-slate-50 text-sm font-medium">
                                Refresh
                            </button>
                            {failedCount > 0 && (
                                <button
                                    onClick={handleRetryAllFailed}
                                    disabled={retrying}
                                    className="bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-100 font-bold text-sm flex items-center gap-1"
                                >
                                    {retrying ? 'Retrying...' : `Retry All Failed (${failedCount})`}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* File List */}
                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                                    <tr>
                                        <th className="p-3 w-12">No.</th>
                                        <th className="p-3">Filename</th>
                                        <th className="p-3 w-32">Status</th>
                                        <th className="p-3">Message / Error</th>
                                        <th className="p-3 w-24 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {items.map((item, idx) => (
                                        <tr key={item.filename} className="hover:bg-slate-50 group">
                                            <td className="p-3 text-slate-400 text-xs">{idx + 1}</td>
                                            <td className="p-3 font-medium text-slate-700 break-all">
                                                <Link
                                                    href={`/consulting/files/${encodeURIComponent(item.filename)}`}
                                                    className="text-indigo-600 hover:text-indigo-900 hover:underline"
                                                >
                                                    {item.filename}
                                                </Link>
                                                {item.pages_processed ? <span className="ml-2 text-xs text-green-600">({item.pages_processed} pages)</span> : null}
                                            </td>
                                            <td className="p-3">
                                                <StatusBadge status={item.status} />
                                            </td>
                                            <td className="p-3 text-slate-600 break-all max-w-xs">
                                                {item.error ? (
                                                    <span className="text-red-600 font-mono text-xs">{item.error}</span>
                                                ) : (
                                                    item.status === 'success' ? 'Indexed successfully' : '-'
                                                )}
                                            </td>
                                            <td className="p-3 text-right">
                                                {item.status === 'failed' && (
                                                    <button
                                                        onClick={() => handleRetryItem(item.id || `${batch.id}_${item.filename.replace(/[^a-zA-Z0-9._-]/g, '')}`)}
                                                        disabled={retrying}
                                                        className="text-cyan-600 hover:text-cyan-800 font-bold text-xs"
                                                    >
                                                        Retry
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
