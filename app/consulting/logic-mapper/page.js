"use client";
import React, { useState } from 'react';
import MobileMenuButton from '../../../components/MobileMenuButton';

export default function LogicMapperPage() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [metadata, setMetadata] = useState(null);
    const [loading, setLoading] = useState(false);

    const handleSearch = async () => {
        if (!query) return;
        setLoading(true);
        setMetadata(null); // Reset
        try {
            const res = await fetch('/api/consulting/logic-mapper', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            if (!res.ok) {
                const text = await res.text();
                console.error("API Error:", res.status, text);
                throw new Error(`API Error ${res.status}: ${text.slice(0, 100)}`);
            }

            const data = await res.json();
            setResults(data.results || []);
            setMetadata(data.metadata || null);
        } catch (e) {
            console.error(e);
            alert(`Search failed: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-slate-800">
            <div className="flex items-center gap-4 p-4 bg-white shadow-sm border-b border-slate-200">
                <MobileMenuButton />
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Logic Mapper</h1>
                    <p className="text-xs text-slate-500">Find slide structures from your logic/intent</p>
                </div>
            </div>

            <div className="p-4 md:p-6 flex flex-col md:flex-row gap-6 h-full overflow-hidden">
                {/* Input Area */}
                <div className="w-full md:w-1/3 flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex-shrink-0 overflow-y-auto">
                    <h3 className="font-bold text-slate-700">Your Message</h3>
                    <textarea
                        className="w-full h-40 p-4 border border-slate-200 rounded-lg resize-none focus:ring-2 focus:ring-cyan-500 outline-none"
                        placeholder="e.g. Although the market is shrinking overall, the EV sector is growing rapidly..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                        onClick={handleSearch}
                        disabled={loading || !query}
                        className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Analyzing Logic...' : 'Find Structure'}
                    </button>

                    <div className="text-xs text-slate-400 mt-4 leading-relaxed">
                        <p>💡 Tip: Describe the relationship between elements (e.g., "Comparison", "Process", "Hierarchy").</p>
                    </div>
                </div>

                {/* Results Area */}
                <div className="flex-1 bg-slate-100 rounded-xl border border-slate-200 p-6 overflow-y-auto">
                    <h3 className="font-bold text-slate-700 mb-4 sticky top-0 bg-slate-100 py-2 z-10 flex justify-between items-center">
                        <span>Suggested Structures</span>
                        <span className="text-xs font-normal text-slate-500">{results.length} found</span>
                    </h3>

                    {/* Logic Visualization Box */}
                    {metadata && metadata.refinedQuery && (
                        <div className="mb-6 bg-blue-50 border border-blue-100 p-4 rounded-lg text-sm text-blue-800">
                            <div className="font-bold mb-1 flex items-center gap-2">
                                <span>🧠 AI Interpretation Logic</span>
                            </div>
                            <p>{metadata.refinedQuery}</p>
                        </div>
                    )}

                    {/* Hack: The refinedQuery is in metadata but we put it in results[0] for easy access or pass it separately? */}
                    {/* Ideally we should store metadata in state. Let's fix handleSearch first. */}

                    {results.length === 0 && !loading && (
                        <div className="text-center py-20 text-slate-400">
                            <div className="text-4xl mb-2">🧠</div>
                            <p>Enter your logic to see suggestions.</p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {results.map((item, idx) => (
                            <div key={idx} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow group cursor-pointer">
                                <div className="aspect-video bg-slate-200 relative overflow-hidden">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={item.url} alt="Slide Template" className="w-full h-full object-cover" />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                </div>
                                <div className="p-3">
                                    <div className="text-xs text-slate-400 font-mono mb-1">{item.id || item.uri || 'Reference'}</div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-indigo-500 rounded-full"
                                                style={{ width: `${(item.score * 100).toFixed(0)}%` }}
                                            />
                                        </div>
                                        <div className="text-sm font-bold text-indigo-600">{(item.score * 100).toFixed(0)}% Match</div>
                                    </div>
                                    <p className="text-xs text-slate-500 line-clamp-2">{item.key_message || item.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
