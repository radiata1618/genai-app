"use client";

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

export default function DashboardPage() {
    const [routines, setRoutines] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const init = async () => {
            try {
                // Ensure daily tasks are generated
                await api.generateDailyTasks();

                const r = await api.getRoutines();
                setRoutines(r.filter(x => x.routine_type === 'MINDSET'));

                const t = await api.getDaily();
                setTasks(t);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        init();
    }, []);

    const handleToggle = async (id, currentStatus) => {
        const isDone = currentStatus !== 'DONE';
        // Optimistic Update
        setTasks(tasks.map(t => t.id === id ? { ...t, status: isDone ? 'DONE' : 'TODO' } : t));
        try {
            await api.toggleComplete(id, isDone);
        } catch (e) {
            console.error("Failed to toggle", e);
            // Revert could be here
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8 font-sans">
            <div className="max-w-3xl mx-auto space-y-12">

                {/* Header */}
                <div>
                    <h1 className="text-4xl font-black text-slate-800 tracking-tighter">Today's Focus</h1>
                    <p className="text-slate-500 font-medium">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                </div>

                {/* Mindset Section */}
                <section>
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Mindset & Rules</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {routines.map(r => (
                            <div key={r.id} className="bg-white border-l-4 border-indigo-500 shadow-sm p-4 rounded-r-lg flex items-center gap-3">
                                <div className="text-2xl">{r.icon}</div>
                                <div className="font-bold text-slate-700">{r.title}</div>
                                <div className="ml-auto">
                                    <input type="checkbox" className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500" />
                                </div>
                            </div>
                        ))}
                        {routines.length === 0 && !loading && (
                            <div className="text-slate-400 text-sm italic">No mindsets defined. Go to Settings.</div>
                        )}
                    </div>
                </section>

                {/* Sprint Tasks Section */}
                <section>
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Today's Tasks</h2>
                    <div className="bg-white/60 backdrop-blur rounded-2xl p-6 shadow-xl shadow-slate-200/50 border border-white min-h-[200px]">

                        {loading ? <div className="text-center py-10 opacity-50">Loading Focus...</div> : tasks.length === 0 ? (
                            <div className="text-center py-10">
                                <div className="text-6xl mb-4">☕</div>
                                <h3 className="text-xl font-bold text-slate-800">All caught up!</h3>
                                <p className="text-slate-500 mt-2">Go to <a href="/backlog" className="text-indigo-600 underline">Backlog</a> to pick new tasks.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {tasks.map(t => (
                                    <div key={t.id}
                                        onClick={() => handleToggle(t.id, t.status)}
                                        className={`group cursor-pointer p-4 rounded-xl border transition-all duration-300 flex items-center gap-4
                                             ${t.status === 'DONE'
                                                ? 'bg-slate-50 border-slate-100 opacity-60'
                                                : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
                                            }`}
                                    >
                                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors
                                           ${t.status === 'DONE' ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 group-hover:border-indigo-400'}
                                       `}>
                                            {t.status === 'DONE' && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                        </div>
                                        <div className="flex-1">
                                            <span className={`font-semibold text-lg ${t.status === 'DONE' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                                                {t.title || 'Loading...'}
                                            </span>
                                            <div className="flex gap-2 text-xs mt-1">
                                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                                                    {t.source_type}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                    </div>
                </section>

            </div>
        </div>
    );
}
