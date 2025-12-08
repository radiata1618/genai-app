"use client";

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

export default function DashboardPage() {
    const [routines, setRoutines] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCompleted, setShowCompleted] = useState(true);

    useEffect(() => {
        const init = async () => {
            try {
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
        setTasks(tasks.map(t => t.id === id ? { ...t, status: isDone ? 'DONE' : 'TODO' } : t));
        try {
            await api.toggleComplete(id, isDone);
        } catch (e) {
            console.error("Failed to toggle", e);
        }
    };

    const visibleTasks = showCompleted ? tasks : tasks.filter(t => t.status !== 'DONE');

    return (
        <div className="min-h-screen bg-slate-50 p-2 font-sans no-scrollbar">
            <div className="max-w-4xl mx-auto flex gap-6 items-start h-[calc(100vh-1rem)]">

                {/* Main Content */}
                <div className="flex-1 flex flex-col h-full space-y-2">

                    {/* Header */}
                    <div className="flex-shrink-0 flex justify-between items-end">
                        <div>
                            <h1 className="text-xl font-black text-slate-800 tracking-tight">Today's Focus</h1>
                            <p className="text-xs text-slate-500 font-medium">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                        </div>
                        <button
                            onClick={() => setShowCompleted(!showCompleted)}
                            className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-all flex items-center gap-1.5
                                ${showCompleted
                                    ? 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'
                                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                }`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${showCompleted ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                            {showCompleted ? 'Showing All' : 'Hiding Done'}
                        </button>
                    </div>

                    {/* Tasks List - Scrollable Area */}
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                        <div className="h-1 bg-indigo-500 w-full flex-shrink-0" />

                        <div className="overflow-y-auto flex-1 p-1 space-y-0.5 custom-scrollbar">
                            {loading ? <div className="text-center py-10 opacity-50 text-xs">Loading Focus...</div> : visibleTasks.length === 0 ? (
                                <div className="text-center py-20">
                                    <div className="text-4xl mb-2">☕</div>
                                    <h3 className="font-bold text-slate-800">
                                        {tasks.length > 0 && !showCompleted ? 'All done for now!' : 'All caught up!'}
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-1">
                                        {tasks.length > 0 && !showCompleted ? 'Toggle "Hiding Done" to see completed tasks.' : <span>Go to <a href="/backlog" className="text-indigo-600 underline">Backlog</a> to pick new tasks.</span>}
                                    </p>
                                </div>
                            ) : (
                                visibleTasks.map(t => (
                                    <div key={t.id}
                                        onClick={() => handleToggle(t.id, t.status)}
                                        className={`group cursor-pointer p-1.5 rounded-md border transition-all duration-200 flex items-center gap-2 select-none
                                             ${t.status === 'DONE'
                                                ? 'bg-slate-50 border-slate-50 opacity-50'
                                                : 'bg-white border-transparent hover:border-indigo-100 hover:bg-slate-50 hover:shadow-sm'
                                            }`}
                                    >
                                        <div className={`w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center transition-colors
                                           ${t.status === 'DONE' ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white group-hover:border-indigo-400'}
                                       `}>
                                            {t.status === 'DONE' && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                        </div>
                                        <div className="flex-1 min-w-0 flex items-center justify-between">
                                            <div className={`font-semibold text-sm truncate ${t.status === 'DONE' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                                                {t.title || 'Unknown Task'}
                                            </div>
                                            <div className="flex gap-2 text-[9px]">
                                                <span className="text-slate-300 font-mono uppercase tracking-wider group-hover:text-slate-400 transition-colors">
                                                    {t.source_type}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Sidebar - Mindset */}
                {routines.length > 0 && (
                    <div className="w-64 flex-shrink-0 space-y-2 hidden md:block">
                        <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pl-1">Mindset</h2>
                        <div className="space-y-2">
                            {routines.map(r => (
                                <div key={r.id} className="bg-white border border-slate-200 shadow-sm p-3 rounded-lg flex items-center gap-3 hover:shadow-md transition-shadow cursor-default">
                                    <div className="text-xl">{r.icon}</div>
                                    <div className="font-bold text-slate-700 text-xs leading-snug">{r.title}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
