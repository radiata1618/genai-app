"use client";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

export default function PhraseRegisterModal({ isOpen, onClose, initialText = "" }) {
    if (!isOpen) return null;

    const [inputText, setInputText] = useState(initialText);
    const [suggestions, setSuggestions] = useState([]);
    const [selectedSuggestions, setSelectedSuggestions] = useState({}); // { index: bool }
    const [isGenerating, setIsGenerating] = useState(false);
    const [editingState, setEditingState] = useState({}); // { index: { english: str, explanation: str } }

    useEffect(() => {
        if (isOpen && initialText) {
            setInputText(initialText);
            setSuggestions([]);
            setSelectedSuggestions({});
            // Optional: Auto-generate on open
            // handleGenerate(initialText); 
        }
    }, [isOpen, initialText]);

    const handleGenerate = async (overrideText = null) => {
        const textToUse = overrideText || inputText;
        if (!textToUse.trim()) return;

        setIsGenerating(true);
        setSuggestions([]);
        setSelectedSuggestions({});

        try {
            const res = await fetch("/api/english/phrases/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ japanese: textToUse }), // backend key is 'japanese' but now accepts english too
            });

            if (res.ok) {
                const data = await res.json();
                setSuggestions(data.suggestions);
                // Default select all suggestions
                const initialSelection = {};
                data.suggestions.forEach((_, idx) => {
                    initialSelection[idx] = true;
                });
                setSelectedSuggestions(initialSelection);
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
                onClose();
            } else {
                alert("Failed to register.");
            }
        } catch (error) {
            console.error("Registration error", error);
        }
    };

    // Helper to toggle selection
    const toggleSelection = (idx) => {
        setSelectedSuggestions(prev => ({
            ...prev,
            [idx]: !prev[idx]
        }));
    };

    // Edit handlers
    const handleEditClick = (idx, item) => {
        setEditingState(prev => ({
            ...prev,
            [idx]: { english: item.english, explanation: item.explanation }
        }));
    };

    const handleSaveEdit = (idx) => {
        const newValues = editingState[idx];
        if (!newValues) return;

        const newSuggestions = [...suggestions];
        newSuggestions[idx] = {
            ...newSuggestions[idx],
            english: newValues.english,
            explanation: newValues.explanation
        };
        setSuggestions(newSuggestions);
        setEditingState(prev => {
            const next = { ...prev };
            delete next[idx];
            return next;
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-fadeIn">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <h3 className="font-bold text-slate-700">Add to Phrase Bank</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>

                <div className="p-4 overflow-y-auto flex-1">
                    <div className="flex gap-2 mb-6">
                        <input
                            type="text"
                            className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-none"
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            placeholder="Enter phrase (English or Japanese)"
                            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                        />
                        <button
                            onClick={() => handleGenerate()}
                            disabled={isGenerating || !inputText.trim()}
                            className="bg-cyan-600 hover:bg-cyan-700 text-white px-6 rounded-xl font-bold transition-colors disabled:opacity-50"
                        >
                            {isGenerating ? "Analyzing..." : "Analyze"}
                        </button>
                    </div>

                    {suggestions.length > 0 ? (
                        <div className="space-y-3">
                            {suggestions.map((item, idx) => {
                                const isEditing = !!editingState[idx];
                                const editValues = editingState[idx] || {};

                                return (
                                    <div
                                        key={idx}
                                        className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${selectedSuggestions[idx] ? "border-cyan-500 bg-cyan-50" : "border-gray-200 hover:border-cyan-300 bg-white"}`}
                                        onClick={() => !isEditing && toggleSelection(idx)}
                                    >
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-xs font-bold uppercase tracking-wider px-2 py-1 rounded bg-blue-100 text-blue-700">
                                                {item.type}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                {!isEditing && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleEditClick(idx, item); }}
                                                        className="text-gray-400 hover:text-cyan-600 p-1 rounded transition-colors"
                                                    >
                                                        ✏️
                                                    </button>
                                                )}
                                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedSuggestions[idx] ? "bg-cyan-500 border-cyan-500" : "border-gray-300"}`}>
                                                    {selectedSuggestions[idx] && <span className="text-white text-xs">✓</span>}
                                                </div>
                                            </div>
                                        </div>

                                        {isEditing ? (
                                            <div className="space-y-2 mt-2" onClick={e => e.stopPropagation()}>
                                                <input
                                                    className="w-full p-2 border rounded font-bold"
                                                    value={editValues.english}
                                                    onChange={e => setEditingState(prev => ({ ...prev, [idx]: { ...prev[idx], english: e.target.value } }))}
                                                />
                                                <textarea
                                                    className="w-full p-2 border rounded text-sm"
                                                    value={editValues.explanation}
                                                    onChange={e => setEditingState(prev => ({ ...prev, [idx]: { ...prev[idx], explanation: e.target.value } }))}
                                                />
                                                <div className="flex justify-end gap-2">
                                                    <button onClick={() => setEditingState(prev => { const n = { ...prev }; delete n[idx]; return n; })} className="px-3 py-1 text-sm text-gray-500">Cancel</button>
                                                    <button onClick={() => handleSaveEdit(idx)} className="px-3 py-1 text-sm bg-cyan-600 text-white rounded">Save</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="font-bold text-slate-800 mb-1">{item.english}</p>
                                                <p className="text-sm text-gray-600 mb-2">{item.japanese}</p>
                                                <div className="text-xs text-slate-500 bg-white/50 p-2 rounded prose prose-sm max-w-none">
                                                    <ReactMarkdown>{item.explanation}</ReactMarkdown>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        !isGenerating && (
                            <div className="text-center py-10 text-gray-400">
                                Enter a word or phrase to analyze.
                            </div>
                        )
                    )}
                </div>

                <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-2 text-gray-500 font-medium hover:text-gray-700">Cancel</button>
                    <button
                        onClick={handleRegister}
                        disabled={suggestions.length === 0 || Object.values(selectedSuggestions).filter(Boolean).length === 0}
                        className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold shadow-lg transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Register Selected
                    </button>
                </div>
            </div>
        </div>
    );
}
