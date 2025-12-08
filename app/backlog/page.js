"use client";

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import TaskCard from '../../components/TaskCard';

export default function BacklogPage() {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // New Task Form State
    const [title, setTitle] = useState('');
    const [category, setCategory] = useState('General');
    const [effort, setEffort] = useState(1);

    // Display State
    const [viewMode, setViewMode] = useState('LIST'); // LIST or BOARD

    const fetchTasks = async () => {
        try {
            const data = await api.getBacklog();
            setTasks(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!title.trim()) return;

        setIsSubmitting(true);
        try {
            await api.addBacklogItem(title, category, effort);
            setTitle('');
            await fetchTasks();
        } catch (e) {
            alert('Failed to create task');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleArchive = async (id) => {
        if (!confirm('Archive this task?')) return;
        try {
            setTasks(tasks.filter(t => t.id !== id)); // Optimistic update
            await api.archiveBacklogItem(id);
        } catch (e) {
            fetchTasks(); // Revert on error
        }
    };

    const handlePick = async (id) => {
        try {
            if (confirm('Add this task to Today?')) {
                await api.pickFromBacklog(id);
                alert('Added to Today!');
            }
        } catch (e) {
            alert('Failed to pick task');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 pb-20 sm:p-4 font-sans text-slate-900">
            {/* Background Decor */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
                <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-yellow-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
                <div className="absolute bottom-[-20%] left-[20%] w-[500px] h-[500px] bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
            </div>

            <div className="relative max-w-5xl mx-auto space-y-4">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Stock</h1>
                        <p className="text-slate-500 mt-1 text-sm">Manage your future intentions.</p>
                    </div>
                    <div className="bg-white/50 backdrop-blur rounded-lg p-1 flex gap-1 border border-slate-200/60 shadow-sm">
                        <button
                            onClick={() => setViewMode('LIST')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${viewMode === 'LIST' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            List
                        </button>
                        <button
                            onClick={() => setViewMode('BOARD')}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${viewMode === 'BOARD' ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            Kanban
                        </button>
                    </div>
                </div>

                {/* Add Input Area (Compact) */}
                <form onSubmit={handleCreate} className="bg-white/80 backdrop-blur-md shadow-sm rounded-xl p-3 border border-white/50 flex flex-col md:flex-row gap-3 items-center ring-1 ring-slate-900/5 transition-shadow hover:shadow-md">
                    <input
                        type="text"
                        placeholder="What needs to be done someday?"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="flex-1 bg-transparent border-none text-base font-medium placeholder-slate-400 focus:ring-0 w-full"
                    />

                    <div className="flex items-center gap-2 w-full md:w-auto">
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="bg-slate-100 border-transparent rounded-lg text-xs font-medium py-1.5 px-2 focus:ring-2 focus:ring-indigo-500 hover:bg-slate-200 transition-colors cursor-pointer"
                        >
                            <option value="General">General</option>
                            <option value="Work">Work</option>
                            <option value="Personal">Personal</option>
                            <option value="Learning">Learning</option>
                        </select>

                        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                            {[1, 3, 5].map((val) => (
                                <button
                                    key={val}
                                    type="button"
                                    onClick={() => setEffort(val)}
                                    className={`w-6 h-6 rounded text-[10px] font-bold transition-all ${effort === val ? 'bg-white shadow text-indigo-600 scale-110' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    {val}
                                </button>
                            ))}
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || !title.trim()}
                            className="bg-slate-900 text-white rounded-lg px-4 py-1.5 text-xs font-bold shadow-md shadow-slate-900/20 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0"
                        >
                            Stock It
                        </button>
                    </div>
                </form>

                {/* List Content */}
                {loading ? (
                    <div className="text-center py-20 text-slate-400 animate-pulse text-sm">Loading stocks...</div>
                ) : tasks.length === 0 ? (
                    <div className="text-center py-20 bg-slate-100/50 rounded-2xl border-2 border-dashed border-slate-200">
                        <p className="text-slate-400 font-medium text-sm">Your backlog is empty. Nice!</p>
                    </div>
                ) : (
                    viewMode === 'LIST' ? (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="divide-y divide-slate-100">
                                {tasks.map(task => (
                                    <div key={task.id} className="group flex items-center gap-3 p-2 hover:bg-slate-50 transition-colors">
                                        <div className="flex-shrink-0 text-xl w-6 text-center">
                                            {task.category === 'Work' ? '💼' : task.category === 'Personal' ? '🏠' : task.category === 'Learning' ? '📚' : '📌'}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-slate-700 text-sm truncate">{task.title}</div>
                                            <div className="flex gap-2 text-[10px] text-slate-400 items-center">
                                                <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500 font-medium">{task.category}</span>
                                                <span>Effort: {task.estimated_effort}</span>
                                                <span>•</span>
                                                <span>{new Date(task.created_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handlePick(task.id)}
                                                className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-md transition-colors"
                                                title="Move to Today"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                            </button>
                                            <button
                                                onClick={() => handleArchive(task.id)}
                                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                                title="Archive"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {tasks.map(task => (
                                <TaskCard key={task.id} task={task} onArchive={handleArchive} onPick={handlePick} />
                            ))}
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
