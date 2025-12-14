"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function PageAnalysisResults() {
    const params = useParams();
    // Decode filename because it might be URL encoded
    const filename = decodeURIComponent(params.filename);
    const router = useRouter();

    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedPage, setSelectedPage] = useState(null); // For detail modal

    useEffect(() => {
        if (filename) {
            fetchPages();
        }
    }, [filename]);

    const fetchPages = async () => {
        try {
            setLoading(true);
            // Ensure we encode it again for the API call if needed, but fetch usually handles it
            const res = await fetch(`/api/consulting/files/${encodeURIComponent(filename)}/pages`);
            if (!res.ok) throw new Error("Failed to fetch pages");
            const data = await res.json();
            setPages(data.pages || []);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
                    Analysis Results: {filename}
                </h1>
                <button
                    onClick={fetchPages}
                    className="px-3 py-1 bg-gray-100 rounded hover:bg-gray-200 text-sm"
                >
                    Refresh
                </button>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-600 rounded">{error}</div>}

            {loading ? (
                <div className="text-center py-10 text-gray-500">Loading analysis results...</div>
            ) : pages.length === 0 ? (
                <div className="text-center py-10 text-gray-500 bg-gray-50 rounded-lg border border-dashed">
                    No processed pages found for this file.
                    <br /><span className="text-xs">Has ingestion completed correctly?</span>
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16">Page</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Type</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Key Message</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-l">Full Description</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20">JSON</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {pages.map((page) => (
                                <tr key={page.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {page.page_number}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                                            {page.structure_type || "Unknown"}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-700 max-w-xs">
                                        {page.key_message}
                                    </td>
                                    <td className="px-6 py-4 text-xs text-gray-500 max-w-sm truncate border-l cursor-help" title={page.description}>
                                        {page.description}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => setSelectedPage(page)}
                                            className="text-indigo-600 hover:text-indigo-900"
                                        >
                                            View
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* JSON Modal */}
            {selectedPage && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
                        <div className="p-4 border-b flex justify-between items-center">
                            <h3 className="font-bold text-lg">Page {selectedPage.page_number} Raw Data</h3>
                            <button onClick={() => setSelectedPage(null)} className="text-gray-500 hover:text-gray-700">✕</button>
                        </div>
                        <div className="p-4 overflow-auto flex-1 bg-gray-50 code font-mono text-xs">
                            <pre>{JSON.stringify(selectedPage, null, 2)}</pre>
                        </div>
                        <div className="p-4 border-t flex justify-end">
                            <button
                                onClick={() => setSelectedPage(null)}
                                className="px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
