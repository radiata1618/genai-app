"use client";
import React, { useState, useEffect } from 'react';
import Link from 'next/link';

export default function AiChatSettingsPage() {
    const [settings, setSettings] = useState({
        system_prompt: "",
        user_profile: "",
        rag_top_k: 3,
        rag_threshold: 0.6
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/ai-chat/settings');
                if (res.ok) {
                    const data = await res.json();
                    setSettings(data);
                }
            } catch (e) {
                console.error("Failed to load settings", e);
            } finally {
                setLoading(false);
            }
        };
        fetchSettings();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            const res = await fetch('/api/ai-chat/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            if (res.ok) {
                alert("Settings saved successfully!");
            } else {
                alert("Failed to save settings.");
            }
        } catch (e) {
            console.error("Save error", e);
            alert("Error saving settings.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 text-slate-800 p-4 md:p-8 font-sans">
            <header className="flex justify-between items-center mb-8">
                <div>
                    <Link href="/ai-chat" className="text-cyan-600 hover:text-cyan-700 text-sm mb-2 block font-medium">← Back to Chat</Link>
                    <h1 className="text-3xl font-bold text-slate-800">
                        AI Chat Settings
                    </h1>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className={`bg-cyan-600 hover:bg-cyan-700 text-white px-6 py-2 rounded-lg font-bold transition-all shadow-md hover:shadow-lg ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </header>

            {loading ? (
                <div className="text-center text-slate-500 py-20">Loading settings...</div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
                    {/* System Prompt */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-2xl">🤖</span>
                            <h2 className="text-xl font-bold text-slate-800">System Prompt</h2>
                        </div>
                        <p className="text-slate-500 text-sm mb-4">
                            Define the core personality and behavior instructions for the AI. This is injected at the start of every conversation.
                        </p>
                        <textarea
                            value={settings.system_prompt}
                            onChange={(e) => setSettings({ ...settings, system_prompt: e.target.value })}
                            className="w-full h-64 bg-gray-50 border border-gray-200 rounded-xl p-4 text-slate-700 focus:outline-none focus:border-cyan-500 transition-colors font-mono text-sm leading-relaxed focus:bg-white"
                            placeholder="You are a helpful AI assistant..."
                        />
                    </div>

                    {/* User Profile */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-2xl">👤</span>
                            <h2 className="text-xl font-bold text-slate-800">User Profile</h2>
                        </div>
                        <p className="text-slate-500 text-sm mb-4">
                            Provide context about yourself (Role, Skills, Goals) to help the AI generate more relevant and personalized responses.
                        </p>
                        <textarea
                            value={settings.user_profile}
                            onChange={(e) => setSettings({ ...settings, user_profile: e.target.value })}
                            className="w-full h-64 bg-gray-50 border border-gray-200 rounded-xl p-4 text-slate-700 focus:outline-none focus:border-cyan-500 transition-colors font-sans text-sm leading-relaxed focus:bg-white"
                            placeholder="e.g. Senior Consultant specializing in M&A. Prefer concise, bullet-point answers."
                        />
                    </div>

                    {/* RAG Configuration */}
                    <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-2xl">📚</span>
                            <h2 className="text-xl font-bold text-slate-800">RAG Configuration</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div>
                                <label className="block text-slate-700 font-medium mb-2">
                                    Top-K Results ({settings.rag_top_k})
                                </label>
                                <input
                                    type="range"
                                    min="1" max="10"
                                    value={settings.rag_top_k}
                                    onChange={(e) => setSettings({ ...settings, rag_top_k: parseInt(e.target.value) })}
                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                                />
                                <p className="text-xs text-slate-500 mt-2">
                                    Number of relevant documents to retrieve and inject into the context.
                                </p>
                            </div>

                            {/* Threshold */}
                            <div>
                                <label className="block text-slate-700 font-medium mb-2">
                                    Similarity Threshold ({settings.rag_threshold})
                                </label>
                                <input
                                    type="range"
                                    min="0" max="1" step="0.05"
                                    value={settings.rag_threshold}
                                    onChange={(e) => setSettings({ ...settings, rag_threshold: parseFloat(e.target.value) })}
                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                                />
                                <p className="text-xs text-slate-500 mt-2">
                                    Minimum similarity score required to include a document.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
