"use client";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import MobileMenuButton from "../../../components/MobileMenuButton";

export default function FinancePage() {
    const [assets, setAssets] = useState([]);
    const [analysis, setAnalysis] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    // Form State
    const [newItem, setNewItem] = useState({ asset_type: 'stock', ticker: '', name: '', note: '' });

    useEffect(() => {
        fetchAssets();
        fetchLatestAnalysis();
    }, []);

    const fetchAssets = async () => {
        try {
            const res = await fetch("/api/hobbies/finance/assets");
            if (res.ok) setAssets(await res.json());
        } catch (e) {
            console.error(e);
        }
    };

    const fetchLatestAnalysis = async () => {
        try {
            const res = await fetch("/api/hobbies/finance/latest-analysis");
            if (res.ok) {
                const data = await res.json();
                if (data) setAnalysis(data);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch("/api/hobbies/finance/assets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newItem)
            });
            if (res.ok) {
                setAssets([await res.json(), ...assets]);
                setIsCreating(false);
                setNewItem({ asset_type: 'stock', ticker: '', name: '', note: '' });
            }
        } catch (e) {
            alert("Failed to add asset");
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("Are you sure?")) return;
        await fetch(`/api/hobbies/finance/assets/${id}`, { method: "DELETE" });
        setAssets(assets.filter(a => a.id !== id));
    };

    const runAnalysis = async () => {
        setIsAnalyzing(true);
        try {
            const res = await fetch("/api/hobbies/finance/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ target: "all" })
            });
            if (res.ok) {
                const data = await res.json();
                setAnalysis(data);
            }
        } catch (e) {
            alert("Analysis failed.");
        } finally {
            setIsAnalyzing(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 text-slate-800 font-sans overflow-hidden">
            {/* Header */}
            <div className="flex items-center p-4 bg-white border-b border-gray-200 shadow-sm flex-shrink-0">
                <MobileMenuButton />
                <h1 className="text-xl font-bold ml-4">Financial Assets</h1>
                <div className="flex-1" />
                <button
                    onClick={() => setIsCreating(true)}
                    className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg shadow-sm font-medium transition-colors"
                >
                    + Add Asset
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-8 flex flex-col lg:flex-row gap-8">
                {/* Left: Assets List */}
                <div className="w-full lg:w-1/3 flex flex-col space-y-4">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h2 className="text-lg font-bold mb-4 text-slate-700">Portfolio</h2>
                        {assets.length === 0 ? (
                            <p className="text-gray-400">No assets registered.</p>
                        ) : (
                            <div className="space-y-3">
                                {assets.map(asset => (
                                    <div key={asset.id} className="p-4 border border-gray-100 rounded-lg bg-gray-50 flex justify-between items-start hover:bg-white hover:shadow-md transition-all">
                                        <div>
                                            <div className="flex items-center space-x-2">
                                                <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider
                                                    ${asset.asset_type === 'stock' ? 'bg-blue-100 text-blue-700' :
                                                        asset.asset_type === 'crypto' ? 'bg-orange-100 text-orange-700' : 'bg-gray-200 text-gray-700'}
                                                `}>
                                                    {asset.asset_type}
                                                </span>
                                                <span className="font-mono text-sm text-gray-400">{asset.ticker}</span>
                                            </div>
                                            <h3 className="font-bold text-slate-800 mt-1">{asset.name}</h3>
                                            {asset.note && <p className="text-sm text-gray-500 mt-1">{asset.note}</p>}
                                        </div>
                                        <button onClick={() => handleDelete(asset.id)} className="text-gray-300 hover:text-red-500">×</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Analysis */}
                <div className="w-full lg:w-2/3 flex flex-col">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex-1 flex flex-col">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold flex items-center">
                                <span className="text-2xl mr-2">📈</span> Market Outlook
                            </h2>
                            <button
                                onClick={runAnalysis}
                                disabled={isAnalyzing || assets.length === 0}
                                className={`px-4 py-2 rounded-lg font-bold text-white transition-all shadow-md
                                    ${isAnalyzing ? "bg-gray-400 cursor-not-allowed animate-pulse" : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700"}
                                `}
                            >
                                {isAnalyzing ? "Analyzing with Gemini..." : "⚡ Run AI Analysis"}
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto bg-slate-50 p-6 rounded-lg border border-slate-200 prose prose-slate max-w-none">
                            {analysis ? (
                                <div>
                                    <div className="text-xs text-gray-400 mb-4 text-right">Last Updated: {new Date(analysis.created_at).toLocaleString()}</div>
                                    <ReactMarkdown>{analysis.analysis}</ReactMarkdown>
                                </div>
                            ) : (
                                <div className="text-center text-gray-400 mt-20">
                                    <p className="text-4xl mb-2">🤖</p>
                                    <p>Add assets and run analysis to get AI insights.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Create Modal */}
            {isCreating && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
                        <h2 className="text-xl font-bold mb-6">Add New Asset</h2>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                                <select
                                    className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-cyan-500 outline-none"
                                    value={newItem.asset_type}
                                    onChange={e => setNewItem({ ...newItem, asset_type: e.target.value })}
                                >
                                    <option value="stock">Stock</option>
                                    <option value="crypto">Crypto</option>
                                    <option value="currency">Currency</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Ticker / Symbol</label>
                                <input
                                    className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-cyan-500 outline-none"
                                    placeholder="e.g. AAPL, BTC"
                                    value={newItem.ticker}
                                    onChange={e => setNewItem({ ...newItem, ticker: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                                <input
                                    className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-cyan-500 outline-none"
                                    placeholder="e.g. Apple Inc."
                                    value={newItem.name}
                                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Note</label>
                                <textarea
                                    className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-cyan-500 outline-none"
                                    value={newItem.note}
                                    onChange={e => setNewItem({ ...newItem, note: e.target.value })}
                                />
                            </div>
                            <div className="flex justify-end space-x-3 mt-6">
                                <button type="button" onClick={() => setIsCreating(false)} className="px-4 py-2 text-gray-500 hover:text-gray-700">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 font-bold">Add</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
