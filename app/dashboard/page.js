"use client";

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { formatDate } from '../utils/date';

const CATEGORIES = {
    'Research': { label: '情報収集', icon: '🔍' },
    'Digital': { label: 'Digital', icon: '💻' },
    'English': { label: '英語', icon: '🅰️' },
    'Food': { label: '食', icon: '🍔' },
    'Dog': { label: '犬', icon: '🐕' },
    'Outing': { label: 'お出かけ', icon: '🏞️' },
    'Chores': { label: '雑務', icon: '🧹' },
    'Shopping': { label: '買い物', icon: '🛒' },
    'Book': { label: '本', icon: '📚' },
    'Other': { label: 'その他', icon: '📦' },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);

const PRIORITIES = {
    'High': { label: '高', color: 'text-red-600 bg-red-50 border-red-200' },
    'Medium': { label: '中', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    'Low': { label: '低', color: 'text-slate-600 bg-slate-50 border-slate-200' },
};

export default function DashboardPage() {
    const [routines, setRoutines] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCompleted, setShowCompleted] = useState(false);

    // Add Task Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [newTask, setNewTask] = useState({
        title: '',
        category: 'Research',
        priority: 'Medium'
    });

    // Drag State
    const [draggedItem, setDraggedItem] = useState(null);
    const [todayStr, setTodayStr] = useState('');

    const init = async () => {
        setLoading(true);
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

    useEffect(() => {
        setTodayStr(formatDate(new Date()));
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

    const handleAddTask = async (e) => {
        e.preventDefault();
        if (!newTask.title.trim()) return;

        setIsSubmitting(true);
        try {
            const todayStr = new Date().toISOString().split('T')[0];
            // 1. Create in Backlog
            const createdItem = await api.addBacklogItem({
                ...newTask,
                deadline: todayStr,
                scheduled_date: todayStr
            });

            // 2. Pick for Today
            await api.pickFromBacklog(createdItem.id);

            // 3. Refresh
            await init();

            setIsModalOpen(false);
            setNewTask({ title: '', category: 'Research', priority: 'Medium' });
        } catch (e) {
            console.error(e);
            alert('Failed to add task');
        } finally {
            setIsSubmitting(false);
        }
    };

    const visibleTasks = showCompleted ? tasks : tasks.filter(t => t.status !== 'DONE' && t.status !== 'SKIPPED');

    const [openMenuId, setOpenMenuId] = useState(null);

    const handleSkip = async (id, e) => {
        e.stopPropagation();
        setOpenMenuId(null);
        // Optimistic update
        setTasks(tasks.map(t => t.id === id ? { ...t, status: 'SKIPPED' } : t));
        try {
            await api.skipTask(id);
        } catch (e) {
            console.error("Failed to skip", e);
            // Revert on error? For now simple log
        }
    };

    // Drag & Drop Handlers
    const onDragStart = (e, task) => {
        setDraggedItem(task);
        e.dataTransfer.effectAllowed = 'move';
        // e.dataTransfer.setDragImage(e.target, 0, 0); // Optional: customize drag image
    };

    const onDragOver = (e, targetTask) => {
        e.preventDefault();
        if (!draggedItem || draggedItem.id === targetTask.id) return;

        const oldIndex = tasks.findIndex(t => t.id === draggedItem.id);
        const newIndex = tasks.findIndex(t => t.id === targetTask.id);

        if (oldIndex === -1 || newIndex === -1) return;

        // Create new array
        const newTasks = [...tasks];
        // Remove dragged item
        newTasks.splice(oldIndex, 1);
        // Insert at new position
        newTasks.splice(newIndex, 0, draggedItem);

        setTasks(newTasks);
    };

    const onDragEnd = async () => {
        if (!draggedItem) return;
        setDraggedItem(null);

        const ids = tasks.map(t => t.id);
        try {
            await api.reorderDaily(ids);
        } catch (e) {
            console.error("Failed to reorder", e);
        }
    };

    return (
        <div className="fixed inset-0 left-64 bg-slate-50 font-sans text-slate-900 flex flex-col z-0 overflow-hidden">
            <div className="flex-1 flex overflow-hidden">
                {/* Main Content */}
                <div className="flex-1 flex flex-col h-full p-4 gap-2">

                    {/* Header */}
                    <div className="flex-none flex justify-between items-end">
                        <div onClick={() => setOpenMenuId(null)} className="flex-1">
                            <h1 className="text-xl font-black text-slate-800 tracking-tight">Today's Focus</h1>
                            <p className="text-xs text-slate-500 font-medium">{todayStr}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="bg-slate-900 text-white text-[10px] font-bold px-3 py-1 rounded-full shadow-md hover:bg-slate-800 transition-all flex items-center gap-1"
                            >
                                <span>+</span> Add Task
                            </button>
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
                    </div>

                    {/* Tasks List - Scrollable Area */}
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col" onClick={() => setOpenMenuId(null)}>
                        <div className="h-1 bg-indigo-500 w-full flex-shrink-0" />

                        <div className="overflow-y-auto flex-1 p-1 space-y-0.5 custom-scrollbar">
                            {loading && tasks.length === 0 ? <div className="text-center py-10 opacity-50 text-xs">Loading Focus...</div> : visibleTasks.length === 0 ? (
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
                                        draggable
                                        onDragStart={(e) => onDragStart(e, t)}
                                        onDragOver={(e) => onDragOver(e, t)}
                                        onDragEnd={onDragEnd}

                                        className={`group cursor-default p-1.5 rounded-md border transition-all duration-200 flex items-center gap-2 select-none relative
                                             ${t.status === 'DONE' || t.status === 'SKIPPED'
                                                ? 'bg-slate-50 border-slate-50 opacity-50'
                                                : 'bg-white border-transparent hover:border-indigo-100 hover:bg-slate-50 hover:shadow-sm'
                                            }`}
                                        style={{ opacity: draggedItem?.id === t.id ? 0.3 : (t.status === 'DONE' || t.status === 'SKIPPED' ? 0.5 : 1) }}
                                    >
                                        {/* Drag Handle */}
                                        <div
                                            className="text-slate-300 cursor-grab active:cursor-grabbing p-0.5 hover:bg-slate-100 rounded transition-colors flex flex-col justify-center items-center h-5 w-3 opacity-0 group-hover:opacity-100"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <div className="flex gap-0.5">
                                                <div className="w-0.5 h-0.5 bg-slate-400 rounded-full"></div>
                                                <div className="w-0.5 h-0.5 bg-slate-400 rounded-full"></div>
                                            </div>
                                            <div className="flex gap-0.5 mt-0.5">
                                                <div className="w-0.5 h-0.5 bg-slate-400 rounded-full"></div>
                                                <div className="w-0.5 h-0.5 bg-slate-400 rounded-full"></div>
                                            </div>
                                            <div className="flex gap-0.5 mt-0.5">
                                                <div className="w-0.5 h-0.5 bg-slate-400 rounded-full"></div>
                                                <div className="w-0.5 h-0.5 bg-slate-400 rounded-full"></div>
                                            </div>
                                        </div>

                                        <div
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleToggle(t.id, t.status);
                                            }}
                                            className={`w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center transition-colors cursor-pointer hover:ring-2 hover:ring-indigo-100
                                           ${t.status === 'DONE' ? 'bg-indigo-500 border-indigo-500' :
                                                    t.status === 'SKIPPED' ? 'bg-slate-200 border-slate-200' :
                                                        'border-slate-300 bg-white group-hover:border-indigo-400'}
                                       `}>
                                            {t.status === 'DONE' && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                            {t.status === 'SKIPPED' && <span className="text-[8px]">⏭️</span>}
                                        </div>
                                        <div className="flex-1 min-w-0 flex items-center justify-between">
                                            <div className={`font-semibold text-sm truncate ${t.status === 'DONE' || t.status === 'SKIPPED' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                                                {t.title || 'Unknown Task'}
                                            </div>
                                            <div className="flex gap-2 text-[9px] items-center">
                                                <span className="text-slate-300 font-mono uppercase tracking-wider group-hover:text-slate-400 transition-colors">
                                                    {t.source_type}
                                                </span>
                                                {/* Menu Trigger */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setOpenMenuId(openMenuId === t.id ? null : t.id);
                                                    }}
                                                    className="p-1 hover:bg-slate-200 rounded-full text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                                                    </svg>
                                                </button>

                                                {/* Menu Dropdown */}
                                                {openMenuId === t.id && (
                                                    <div className="absolute right-0 top-6 w-24 bg-white border border-slate-200 shadow-xl rounded-lg z-50 overflow-hidden animate-in fade-in zoom-in duration-100">
                                                        <button
                                                            onClick={(e) => handleSkip(t.id, e)}
                                                            className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                                        >
                                                            <span>⏭️</span> Skip
                                                        </button>
                                                    </div>
                                                )}
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
                    <div className="w-64 flex-none space-y-2 hidden md:block border-l border-slate-100 bg-white/50 p-4 overflow-y-auto">
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

            {/* Add Task Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="font-bold text-slate-800 text-lg">Add to Today</h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <form onSubmit={handleAddTask} className="p-6 space-y-5">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Task Title</label>
                                <input
                                    type="text"
                                    value={newTask.title}
                                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                                    className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700"
                                    placeholder="What do you want to do today?"
                                    autoFocus
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Category</label>
                                    <div className="relative">
                                        <select
                                            value={newTask.category}
                                            onChange={(e) => setNewTask({ ...newTask, category: e.target.value })}
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all appearance-none text-slate-700 font-medium text-sm"
                                        >
                                            {CATEGORY_KEYS.map(key => (
                                                <option key={key} value={key}>{CATEGORIES[key].label}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Priority</label>
                                    <div className="relative">
                                        <select
                                            value={newTask.priority}
                                            onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all appearance-none text-slate-700 font-medium text-sm"
                                        >
                                            {Object.keys(PRIORITIES).map(key => (
                                                <option key={key} value={key}>{PRIORITIES[key].label}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="pt-2 flex justify-end gap-3 border-t border-slate-100 mt-4">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-slate-500 hover:text-slate-700 font-bold text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting || !newTask.title.trim()}
                                    className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-md hover:bg-indigo-700 hover:shadow-lg transform active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isSubmitting ? 'Adding...' : 'Add Task'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
