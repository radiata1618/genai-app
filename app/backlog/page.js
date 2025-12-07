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
        <div className="min-h-screen bg-slate-50 p-4 pb-20 sm:p-8 font-sans">
            {/* Background Decor */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
                <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-yellow-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
                <div className="absolute bottom-[-20%] left-[20%] w-[500px] h-[500px] bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
            </div>

            <div className="relative max-w-5xl mx-auto space-y-8">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-4xl font-extrabold text-slate-800 tracking-tight">Stock</h1>
                        <p className="text-slate-500 mt-1">Manage your future intentions.</p>
                    </div>
                    <div className="bg-white/50 backdrop-blur rounded-lg p-1.5 flex gap-1 border border-slate-200/60 shadow-sm">
                        <button className="px-4 py-1.5 text-sm font-medium bg-white shadow-sm rounded-md text-slate-800">List</button>
                        <button className="px-4 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-700">Kanban</button>
                    </div>
                </div>

                {/* Add Input Area (Floating style) */}
                <form onSubmit={handleCreate} className="bg-white/80 backdrop-blur-md shadow-lg rounded-2xl p-4 border border-white/50 flex flex-col md:flex-row gap-4 items-center ring-1 ring-slate-900/5 transition-shadow hover:shadow-xl">
                    <input
                        type="text"
                        placeholder="What needs to be done someday?"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="flex-1 bg-transparent border-none text-lg font-medium placeholder-slate-400 focus:ring-0 w-full"
                        autoFocus
                    />

                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="bg-slate-100 border-transparent rounded-lg text-sm font-medium py-2 px-3 focus:ring-2 focus:ring-indigo-500 hover:bg-slate-200 transition-colors cursor-pointer"
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
                                    className={`w-8 h-8 rounded-md text-xs font-bold transition-all ${effort === val ? 'bg-white shadow text-indigo-600 scale-110' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    {val}
                                </button>
                            ))}
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || !title.trim()}
                            className="bg-slate-900 text-white rounded-lg px-6 py-2.5 text-sm font-bold shadow-lg shadow-slate-900/20 hover:bg-slate-800 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0"
                        >
                            Stock It
                        </button>
                    </div>
                </form>

                {/* List */}
                {loading ? (
                    <div className="text-center py-20 text-slate-400 animate-pulse">Loading stocks...</div>
                ) : tasks.length === 0 ? (
                    <div className="text-center py-20 bg-slate-100/50 rounded-3xl border-2 border-dashed border-slate-200">
                        <p className="text-slate-400 font-medium">Your backlog is empty. Nice!</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {tasks.map(task => (
                            <TaskCard key={task.id} task={task} onArchive={handleArchive} onPick={handlePick} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
