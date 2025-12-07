"use client";

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

export default function MindsetsPage() {
    const [mindsets, setMindsets] = useState([]);
    const [title, setTitle] = useState('');
    const [icon, setIcon] = useState('🧠');
    const [loading, setLoading] = useState(true);

    const fetchMindsets = async () => {
        try {
            const data = await api.getRoutines('MINDSET');
            setMindsets(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMindsets();
    }, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        try {
            await api.addRoutine(title, 'MINDSET', null, icon);
            setTitle('');
            fetchMindsets();
        } catch (e) {
            alert('Failed to create mindset');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8 font-sans">
            <div className="max-w-4xl mx-auto space-y-8">

                <div>
                    <h1 className="text-3xl font-black text-slate-800">Mindsets & Rules</h1>
                    <p className="text-slate-500">Principles to keep in mind every day.</p>
                </div>

                {/* Creator Card */}
                <form onSubmit={handleCreate} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex gap-4 items-end">
                    <div className="flex-1">
                        <label className="text-xs font-bold text-slate-400">Rule / Mindset</label>
                        <input
                            value={title} onChange={e => setTitle(e.target.value)}
                            className="w-full mt-1 p-2 border rounded-lg bg-slate-50 focus:bg-white transition-colors"
                            placeholder="e.g. Always be kind"
                        />
                    </div>
                    <div className="w-20">
                        <label className="text-xs font-bold text-slate-400">Icon</label>
                        <input
                            value={icon} onChange={e => setIcon(e.target.value)}
                            className="w-full mt-1 p-2 border rounded-lg bg-slate-50 text-center"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={!title}
                        className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold hover:opacity-90 disabled:opacity-50"
                    >
                        Add Rule
                    </button>
                </form>

                {/* List */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {mindsets.map(m => (
                        <div key={m.id} className="bg-white border-l-4 border-indigo-400 p-4 rounded-r-xl shadow-sm flex items-center gap-4">
                            <span className="text-2xl">{m.icon}</span>
                            <span className="font-bold text-slate-700">{m.title}</span>
                        </div>
                    ))}
                    {mindsets.length === 0 && !loading && (
                        <div className="text-slate-400 italic">No mindsets defined yet.</div>
                    )}
                </div>

            </div>
        </div>
    );
}
