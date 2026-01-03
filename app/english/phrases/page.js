"use client";
import React, { useState, useEffect } from "react";
import MobileMenuButton from "../../../components/MobileMenuButton";

export default function PhrasesPage() {
    const [activeTab, setActiveTab] = useState("list"); // "list" or "register"
    const [phrases, setPhrases] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    // List State
    const [showEnglish, setShowEnglish] = useState(false);
    const [hideMemorized, setHideMemorized] = useState(false);

    // Registration State
    const [inputJapanese, setInputJapanese] = useState("");
    const [suggestions, setSuggestions] = useState([]);
    const [selectedSuggestions, setSelectedSuggestions] = useState({}); // { index: bool }
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        fetchPhrases();
    }, [hideMemorized]);

    const fetchPhrases = async () => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            if (hideMemorized) params.append("filter_memorized", "true");

            const res = await fetch(`/api/english/phrases?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setPhrases(data);
            }
        } catch (error) {
            console.error("Failed to fetch phrases", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerate = async () => {
        if (!inputJapanese.trim()) return;
        setIsGenerating(true);
        setSuggestions([]);
        setSelectedSuggestions({});

        try {
            const res = await fetch("/api/english/phrases/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ japanese: inputJapanese }),
            });

            if (res.ok) {
                const data = await res.json();
                setSuggestions(data.suggestions);
                // Default selection to OFF (empty object)
                setSelectedSuggestions({});
            } else {
                alert("Failed to generate suggestions.");
            }
        } catch (error) {
            console.error("Generation error", error);
            alert("An error occurred.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleRegister = async () => {
        const toRegister = suggestions.filter((_, idx) => selectedSuggestions[idx]);
        if (toRegister.length === 0) return;

        try {
            const res = await fetch("/api/english/phrases", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(toRegister.map(s => ({
                    japanese: s.japanese,
                    english: s.english,
                    note: `${s.explanation} (${s.type})`
                }))),
            });

            if (res.ok) {
                alert("Phrases registered!");
                setInputJapanese("");
                setSuggestions([]);
                fetchPhrases();
                setActiveTab("list");
            } else {
                alert("Failed to register.");
            }
        } catch (error) {
            console.error("Registration error", error);
        }
    };

    const handleToggleMemorized = async (id, currentStatus) => {
        try {
            const res = await fetch(`/api/english/phrases/${id}/status?is_memorized=${!currentStatus}`, {
                method: "PATCH"
            });
            if (res.ok) {
                setPhrases(phrases.map(p => p.id === id ? { ...p, is_memorized: !currentStatus } : p));
            }
        } catch (error) {
            console.error("Update error", error);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm("Delete this phrase?")) return;
        try {
            const res = await fetch(`/api/english/phrases/${id}`, {
                method: "DELETE"
            });
            if (res.ok) {
                setPhrases(phrases.filter(p => p.id !== id));
            }
        } catch (error) {
            console.error("Delete error", error);
        }
    };

    return (
        <div className="h-full bg-gray-50 text-slate-800 font-sans overflow-y-auto">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
                <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        <div className="flex items-center gap-2">
                            <MobileMenuButton />
                            <h1 className="text-xl font-bold text-slate-800">Phrase Bank</h1>
                        </div>
                        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
                            <button
                                onClick={() => setActiveTab("list")}
                                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === "list" ? "bg-white text-cyan-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                            >
                                List
                            </button>
                            <button
                                onClick={() => setActiveTab("register")}
                                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === "register" ? "bg-white text-cyan-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                            >
                                Register
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {activeTab === "register" && (
                    <div className="space-y-8 animate-fadeIn">
                        <section className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <label className="block text-sm font-bold text-slate-700 mb-2">Japanese Phrase</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={inputJapanese}
                                    onChange={(e) => setInputJapanese(e.target.value)}
                                    placeholder="e.g. お腹が空いた"
                                    className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition-all"
                                    onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                                />
                                <button
                                    onClick={handleGenerate}
                                    disabled={isGenerating || !inputJapanese}
                                    className="bg-cyan-600 hover:bg-cyan-700 text-white px-6 py-3 rounded-xl font-bold shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                >
                                    {isGenerating ? "Analyzing..." : "Generate"}
                                </button>
                            </div>
                        </section>

                        {suggestions.length > 0 && (
                            <section className="space-y-4">
                                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                    <span>Suggestions</span>
                                    <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Select phrases to save</span>
                                </h2>
                                <div className="grid gap-4">
                                    {suggestions.map((item, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => setSelectedSuggestions(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                            className={`p-4 rounded-xl border-2 cursor-pointer transition-all relative ${selectedSuggestions[idx] ? "border-cyan-500 bg-cyan-50" : "border-transparent bg-white shadow-sm hover:bg-gray-50"}`}
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded ${item.type === "recommendation" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}`}>
                                                    {item.type}
                                                </span>
                                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedSuggestions[idx] ? "bg-cyan-500 border-cyan-500" : "border-gray-300"}`}>
                                                    {selectedSuggestions[idx] && <span className="text-white text-sm">✓</span>}
                                                </div>
                                            </div>
                                            <p className="text-sm text-gray-500 mb-1">{item.japanese}</p>
                                            <p className="text-lg font-bold text-slate-800 mb-2">{item.english}</p>
                                            <p className="text-sm text-slate-600 bg-white/50 p-2 rounded-lg">{item.explanation}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-end pt-4">
                                    <button
                                        onClick={handleRegister}
                                        className="bg-slate-900 hover:bg-slate-800 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-transform active:scale-95"
                                    >
                                        Register Selected ({Object.values(selectedSuggestions).filter(Boolean).length})
                                    </button>
                                </div>
                            </section>
                        )}
                    </div>
                )}

                {activeTab === "list" && (
                    <div className="space-y-6 animate-fadeIn">
                        {/* Filters */}
                        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100 sticky top-20 z-10">
                            <label className="flex items-center cursor-pointer select-none">
                                <div className="relative">
                                    <input type="checkbox" className="sr-only" checked={showEnglish} onChange={(e) => setShowEnglish(e.target.checked)} />
                                    <div className={`block w-10 h-6 rounded-full transition-colors ${showEnglish ? "bg-cyan-500" : "bg-gray-300"}`}></div>
                                    <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${showEnglish ? "transform translate-x-4" : ""}`}></div>
                                </div>
                                <span className="ml-3 text-sm font-medium text-slate-700">Show English</span>
                            </label>

                            <label className="flex items-center cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={hideMemorized}
                                    onChange={(e) => setHideMemorized(e.target.checked)}
                                    className="w-4 h-4 text-cyan-600 rounded border-gray-300 focus:ring-cyan-500"
                                />
                                <span className="ml-2 text-sm text-slate-600">Hide Memorized</span>
                            </label>
                        </div>

                        {/* List */}
                        {isLoading ? (
                            <div className="flex justify-center py-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-600"></div>
                            </div>
                        ) : phrases.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <p className="text-4xl mb-4">📭</p>
                                <p>No phrases found. Start adding some!</p>
                            </div>
                        ) : (
                            <div className="grid gap-3">
                                {phrases.map((phrase) => (
                                    <div
                                        key={phrase.id}
                                        className={`group bg-white p-4 rounded-xl shadow-sm border border-gray-100 transition-all hover:shadow-md ${phrase.is_memorized ? "opacity-60 bg-gray-50" : ""}`}
                                    >
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="flex-1">
                                                <p className="text-sm text-gray-500 mb-1">{phrase.japanese}</p>
                                                <div className="relative min-h-[1.75rem] flex items-center">
                                                    <p className={`text-lg font-bold text-slate-800 transition-opacity duration-300 ${showEnglish ? "opacity-100" : "opacity-0 blur-sm select-none"}`}>
                                                        {phrase.english}
                                                    </p>
                                                    {!showEnglish && (
                                                        <span className="absolute inset-0 flex items-center text-gray-300 text-sm font-medium select-none">
                                                            Hidden (Toggle to view)
                                                        </span>
                                                    )}
                                                </div>
                                                {showEnglish && phrase.note && (
                                                    <p className="text-xs text-slate-500 mt-2 bg-slate-50 p-2 rounded inline-block">
                                                        {phrase.note}
                                                    </p>
                                                )}
                                            </div>

                                            <div className="flex flex-col items-center gap-2">
                                                <button
                                                    onClick={() => handleToggleMemorized(phrase.id, phrase.is_memorized)}
                                                    className={`p-2 rounded-full transition-colors ${phrase.is_memorized ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400 hover:bg-green-50 hover:text-green-500"}`}
                                                    title={phrase.is_memorized ? "Mark as unmemorized" : "Mark as memorized"}
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(phrase.id)}
                                                    className="p-2 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Delete"
                                                >
                                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
