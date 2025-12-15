"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import MobileMenuButton from '../../../components/MobileMenuButton';

export default function BatchHistoryPage() {
    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchBatches();
    }, []);

    const fetchBatches = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/consulting/batches');
            const data = await res.json();
            if (data.batches) {
                setBatches(data.batches);
            }
        } catch (e) {
            console.error("Failed to fetch batches", e);
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = async (batchId) => {
        if (!confirm("Are you sure you want to stop this batch? It may take a moment to halt.")) return;
        try {
            await fetch(`/api/consulting/batches/${batchId}/cancel`, { method: 'POST' });
            alert("Cancellation requested. Please refresh in a moment.");
            fetchBatches();
        } catch (e) {
            alert("Failed to cancel: " + e.message);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'completed': return 'bg-green-100 text-green-800';
            case 'failed': return 'bg-red-100 text-red-800';
            case 'processing': return 'bg-blue-100 text-blue-800';
            case 'pending': return 'bg-gray-100 text-gray-800';
            case 'discovering': return 'bg-yellow-100 text-yellow-800';
            case 'cancelling': return 'bg-orange-100 text-orange-800';
            case 'cancelled': return 'bg-gray-200 text-gray-600';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-slate-800 relative">
            {/* Header */}
            <div className="flex-none bg-white shadow-sm border-b border-slate-200 z-20">
                <div className="flex items-center gap-3 p-3">
                    <MobileMenuButton />
                    <div className="flex items-center gap-2">
                        <Link href="/consulting/data" className="text-slate-500 hover:text-slate-800">
                            ← Back
                        </Link>
                        <h1 className="text-lg font-bold text-slate-800">Ingestion Job History</h1>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="p-4 max-w-6xl mx-auto w-full">
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                        <h2 className="font-bold">Execution Logs</h2>
                        <button onClick={fetchBatches} className="text-sm text-cyan-600 hover:underline">Refresh</button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                                <tr>
                                    <th className="p-3">Status</th>
                                    <th className="p-3">Summary</th>
                                    <th className="p-3">Progress</th>
                                    <th className="p-3">Created At</th>
                                    <th className="p-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading && batches.length === 0 ? (
                                    <tr><td colSpan="5" className="p-4 text-center">Loading...</td></tr>
                                ) : batches.length === 0 ? (
                                    <tr><td colSpan="5" className="p-4 text-center text-slate-400">No jobs found.</td></tr>
                                ) : (
                                    batches.map((batch) => (
                                        <tr key={batch.id} className="hover:bg-slate-50">
                                            <td className="p-3">
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold capitalize ${getStatusColor(batch.status)}`}>
                                                    {batch.status}
                                                </span>
                                            </td>
                                            <td className="p-3">
                                                <div className="font-medium text-slate-700">{batch.summary || "Batch Job"}</div>
                                                <div className="text-xs text-slate-400 font-mono">{batch.id.slice(0, 8)}...</div>
                                            </td>
                                            <td className="p-3">
                                                <div className="text-xs">
                                                    Files: {batch.processed_files || 0} / {batch.total_files || "?"}
                                                </div>
                                                <div className="text-xs text-green-600">
                                                    Success: {batch.success_files || 0}
                                                </div>
                                                {batch.failed_files > 0 && (
                                                    <div className="text-xs text-red-600">
                                                        Failed: {batch.failed_files}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-3 text-slate-500">
                                                {batch.created_at ? new Date(batch.created_at).toLocaleString() : "-"}
                                            </td>
                                            <td className="p-3 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {(batch.status === 'processing' || batch.status === 'discovering' || batch.status === 'pending') && (
                                                        <button
                                                            onClick={() => handleCancel(batch.id)}
                                                            className="px-3 py-1.5 bg-red-50 border border-red-200 rounded text-red-600 hover:bg-red-100 font-medium shadow-sm transition-colors text-xs"
                                                        >
                                                            Stop
                                                        </button>
                                                    )}
                                                    <Link
                                                        href={`/consulting/batches/${batch.id}`}
                                                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-slate-600 hover:bg-slate-50 hover:text-cyan-600 font-medium shadow-sm transition-colors"
                                                    >
                                                        Details
                                                    </Link>
                                                </div>
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
    );
}
