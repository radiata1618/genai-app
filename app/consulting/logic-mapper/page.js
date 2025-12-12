"use client";
import React, { useState } from 'react';
import MobileMenuButton from '../../../components/MobileMenuButton';

export default function LogicMapperPage() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    const handleSearch = async () => {
        if (!query) return;
        setLoading(true);
        try {
            const res = await fetch('/api/consulting/logic-mapper', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            const data = await res.json();
            setResults(data.results || []);
        } catch (e) {
            console.error(e);
            alert("Search failed");
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
                                    <div className="text-sm font-bold text-slate-700">Relevance Score: {(item.score || 0).toFixed(2)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
