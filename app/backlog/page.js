"use client";

import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';

const CATEGORIES = {
    'Research': { label: '情報収集', icon: '🔍' },
    'Digital': { label: 'Digital', icon: '💻' },
    'English': { label: '英語', icon: '🅰️' },
    'Food': { label: '食', icon: '🍔' },
    'Dog': { label: '犬', icon: '🐕' },
    'Outing': { label: 'お出かけ', icon: '🏞️' },
    'Chores': { label: '雑務', icon: '🧹' },
    'Other': { label: 'その他', icon: '📦' },
};

const CATEGORY_KEYS = Object.keys(CATEGORIES);

const PRIORITIES = {
    'High': { label: '高', color: 'text-red-600 bg-red-50 border-red-200' },
    'Medium': { label: '中', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    'Low': { label: '低', color: 'text-slate-600 bg-slate-50 border-slate-200' },
};

export default function BacklogPage() {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [filterPriority, setFilterPriority] = useState('All'); // All, High, Medium
    const [filterCategory, setFilterCategory] = useState('All');
    const [filterExcludeScheduled, setFilterExcludeScheduled] = useState(false);

    // Form State
    const [form, setForm] = useState({
        title: '',
        category: 'Research',
        priority: 'Medium',
        deadline: '',
        scheduled_date: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Edit State
    const [editingTask, setEditingTask] = useState(null);

    // Drag & Drop State
    const [draggedItem, setDraggedItem] = useState(null);

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

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setForm(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!form.title.trim()) return;

        setIsSubmitting(true);
        try {
            await api.addBacklogItem({
                ...form,
                deadline: form.deadline || null,
                scheduled_date: form.scheduled_date || null
            });
            setForm({
                title: '',
                category: 'Research',
                priority: 'Medium',
                deadline: '',
                scheduled_date: ''
            });
            await fetchTasks();
        } catch (e) {
            alert('Failed to create task');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('本当に削除しますか？')) return;
        try {
            await api.deleteBacklogItem(id);
            setTasks(prev => prev.filter(t => t.id !== id));
        } catch (e) {
            alert('Failed to delete task');
            fetchTasks();
        }
    };

    const handleMoveToToday = async (id) => {
        if (!confirm('今日やりますか？')) return;
        try {
            await api.pickFromBacklog(id);
            alert('Added to Today!');
        } catch (e) {
            alert(e.message === 'Already picked' ? '既に今日のタスクにあります' : 'Failed to pick task');
        }
    };

    // Edit Logic
    const startEdit = (task) => {
        setEditingTask({
            ...task,
            deadline: task.deadline || '',
            scheduled_date: task.scheduled_date || ''
        });
    };

    const saveEdit = async (e) => {
        e.preventDefault();
        try {
            const updated = await api.updateBacklogItem(editingTask.id, {
                ...editingTask,
                deadline: editingTask.deadline || null,
                scheduled_date: editingTask.scheduled_date || null
            });
            setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
            setEditingTask(null);
        } catch (e) {
            alert('Failed to update task');
        }
    };

    // Drag & Drop
    const onDragStart = (e, index) => {
        setDraggedItem(tasks[index]);
        e.dataTransfer.effectAllowed = "move";
        // e.dataTransfer.setDragImage(e.target, 0, 0); // Optional: Custom drag image
    };

    const onDragOver = (e, index) => {
        e.preventDefault();
        const draggedOverItem = tasks[index];

        // if the item is dragged over itself, ignore
        if (draggedItem === draggedOverItem) return;

        // filter out the currently dragged item
        let items = tasks.filter(item => item !== draggedItem);

        // add the dragged item after the dragged over item
        items.splice(index, 0, draggedItem);

        setTasks(items);
    };

    const onDragEnd = async () => {
        setDraggedItem(null);
        // Persist order
        try {
            await api.reorderBacklogItems(tasks.map(t => t.id));
        } catch (e) {
            console.error('Failed to save order', e);
        }
    };

    // Filter Logic
    const filteredTasks = tasks.filter(task => {
        if (filterExcludeScheduled && task.scheduled_date) return false;
        if (filterPriority === 'High' && task.priority !== 'High') return false;
        if (filterPriority === 'Medium' && task.priority === 'Low') return false; // Show Medium & High
        if (filterCategory !== 'All' && task.category !== filterCategory) return false;
        return true;
    });

    return (
        <div className="min-h-screen bg-slate-50 p-2 pb-20 sm:p-4 font-sans text-slate-900">
            {/* Background Decor */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
                <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-yellow-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
                <div className="absolute bottom-[-20%] left-[20%] w-[500px] h-[500px] bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
            </div>

            <div className="relative w-full mx-auto space-y-4">

                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-2">
                    <div>
                        <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Stock</h1>
                        <p className="text-slate-500 text-xs">いつかやりたいことをストック</p>
                    </div>

                    {/* Filters */}
                    <div className="bg-white/80 backdrop-blur rounded-lg p-1.5 flex flex-wrap gap-2 border border-slate-200 shadow-sm items-center">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Filters:</span>
                        <select
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            className="bg-slate-100 border-none rounded text-xs py-1 pl-2 pr-6 focus:ring-1 focus:ring-indigo-500"
                        >
                            <option value="All">All Categories</option>
                            {CATEGORY_KEYS.map(key => (
                                <option key={key} value={key}>{CATEGORIES[key].label}</option>
                            ))}
                        </select>
                        <select
                            value={filterPriority}
                            onChange={(e) => setFilterPriority(e.target.value)}
                            className="bg-slate-100 border-none rounded text-xs py-1 pl-2 pr-6 focus:ring-1 focus:ring-indigo-500"
                        >
                            <option value="All">All Priorities</option>
                            <option value="Medium">Medium+</option>
                            <option value="High">High Only</option>
                        </select>
                        <label className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded cursor-pointer hover:bg-slate-200 transition-colors">
                            <input
                                type="checkbox"
                                checked={filterExcludeScheduled}
                                onChange={(e) => setFilterExcludeScheduled(e.target.checked)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                            />
                            <span className="text-xs font-medium text-slate-600">予定済を除く</span>
                        </label>
                    </div>
                </div>

                {/* Create Form */}
                <form onSubmit={handleCreate} className="bg-white shadow-md rounded-xl p-3 border border-slate-100 flex flex-col gap-3">
                    <div className="flex flex-col md:flex-row gap-3">
                        <input
                            type="text"
                            name="title"
                            placeholder="What needs to be done someday?"
                            value={form.title}
                            onChange={handleChange}
                            className="flex-1 bg-slate-50 border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder-slate-400 text-sm"
                        />
                        <button
                            type="submit"
                            disabled={isSubmitting || !form.title.trim()}
                            className="hidden md:block bg-slate-900 text-white rounded-lg px-6 py-2 text-sm font-bold shadow-lg hover:bg-slate-800 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:translate-y-0"
                        >
                            Stock It
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-3 items-center">
                        {/* Category */}
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Category</span>
                            <select
                                name="category"
                                value={form.category}
                                onChange={handleChange}
                                className="bg-slate-50 border-slate-200 rounded-lg text-xs py-1.5 pl-2 pr-8 focus:ring-indigo-500"
                            >
                                {CATEGORY_KEYS.map(key => (
                                    <option key={key} value={key}>{CATEGORIES[key].label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Priority */}
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Priority</span>
                            <div className="flex bg-slate-100 rounded-lg p-1">
                                {Object.keys(PRIORITIES).map(pKey => (
                                    <button
                                        key={pKey}
                                        type="button"
                                        onClick={() => setForm(prev => ({ ...prev, priority: pKey }))}
                                        className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${form.priority === pKey ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                                    >
                                        {PRIORITIES[pKey].label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Deadline */}
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Limit</span>
                            <input
                                type="date"
                                name="deadline"
                                value={form.deadline}
                                onChange={handleChange}
                                className="bg-slate-50 border-slate-200 rounded-lg text-xs py-1 px-2 focus:ring-indigo-500"
                            />
                        </div>

                        {/* Scheduled */}
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase">Plan</span>
                            <input
                                type="date"
                                name="scheduled_date"
                                value={form.scheduled_date}
                                onChange={handleChange}
                                className="bg-slate-50 border-slate-200 rounded-lg text-xs py-1 px-2 focus:ring-indigo-500"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting || !form.title.trim()}
                            className="md:hidden w-full mt-2 bg-slate-900 text-white rounded-lg px-6 py-2 text-sm font-bold shadow-lg"
                        >
                            Stock It
                        </button>
                    </div>
                </form>

                {/* Task List */}
                {loading ? (
                    <div className="text-center py-20 text-slate-400 animate-pulse text-sm">Loading stocks...</div>
                ) : filteredTasks.length === 0 ? (
                    <div className="text-center py-20 bg-slate-100/50 rounded-2xl border-2 border-dashed border-slate-200">
                        <p className="text-slate-400 font-medium text-sm">No tasks match your filters.</p>
                    </div>
                ) : (
                    <div className="bg-white/60 backdrop-blur rounded-xl shadow-sm border border-white/50 overflow-hidden">
                        <div className="w-full">
                            {/* Table Header */}
                            <div className="grid grid-cols-[30px_1fr_auto] md:grid-cols-[20px_1fr_100px_60px_90px_90px_150px] gap-2 p-2 bg-slate-50/80 border-b border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-wider items-center">
                                <div></div>
                                <div>Task</div>
                                <div className="hidden md:block">Category</div>
                                <div className="hidden md:block text-center">Priority</div>
                                <div className="hidden md:block">Deadline</div>
                                <div className="hidden md:block">Scheduled</div>
                                <div className="hidden md:block text-right">Actions</div>
                            </div>

                            {/* Rows */}
                            <ul className="divide-y divide-slate-100">
                                {filteredTasks.map((task, index) => (
                                    <li
                                        key={task.id}
                                        draggable
                                        onDragStart={(e) => onDragStart(e, index)}
                                        onDragOver={(e) => onDragOver(e, index)}
                                        onDragEnd={onDragEnd}
                                        className="group grid grid-cols-[30px_1fr_auto] md:grid-cols-[20px_1fr_100px_60px_90px_90px_150px] gap-2 p-1.5 hover:bg-white transition-colors items-center cursor-move"
                                    >
                                        <div className="text-slate-300 cursor-grab active:cursor-grabbing text-xs">⋮⋮</div>

                                        <div className="min-w-0">
                                            <div className="font-semibold text-slate-800 text-sm truncate leading-tight">{task.title}</div>
                                            <div className="md:hidden flex flex-wrap gap-2 mt-0.5 text-[10px] text-slate-500">
                                                <span className={`px-1 py-0 rounded border ${PRIORITIES[task.priority]?.color}`}>{PRIORITIES[task.priority]?.label}</span>
                                                <span className="bg-slate-100 px-1 py-0 rounded">{CATEGORIES[task.category]?.label}</span>
                                                {task.scheduled_date && <span className="text-indigo-600">Plan: {task.scheduled_date}</span>}
                                            </div>
                                        </div>

                                        <div className="hidden md:flex items-center gap-1">
                                            <span className="text-sm">{CATEGORIES[task.category]?.icon}</span>
                                            <span className="text-xs text-slate-600 truncate">{CATEGORIES[task.category]?.label}</span>
                                        </div>

                                        <div className="hidden md:flex justify-center">
                                            <span className={`text-[10px] font-bold px-1.5 py-0 rounded-full border ${PRIORITIES[task.priority]?.color}`}>
                                                {PRIORITIES[task.priority]?.label}
                                            </span>
                                        </div>

                                        <div className="hidden md:block text-[11px] text-slate-500">
                                            {task.deadline ? <span className="text-red-400 font-medium">{task.deadline}</span> : '-'}
                                        </div>

                                        <div className="hidden md:block text-[11px] text-slate-500">
                                            {task.scheduled_date ? <span className="text-indigo-600 font-medium">{task.scheduled_date}</span> : '-'}
                                        </div>

                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => handleMoveToToday(task.id)}
                                                className="px-2 py-0.5 bg-green-50 text-green-600 hover:bg-green-100 rounded text-xs font-bold border border-green-200 transition-colors whitespace-nowrap"
                                            >
                                                今日やる
                                            </button>
                                            <button
                                                onClick={() => startEdit(task)}
                                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                                title="Edit"
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                onClick={() => handleDelete(task.id)}
                                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                title="Delete"
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
            </div>

            {/* Edit Modal */}
            {editingTask && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="font-bold text-slate-800 text-lg">Edit Task</h3>
                            <button onClick={() => setEditingTask(null)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <form onSubmit={saveEdit} className="p-6 space-y-5">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Title</label>
                                <input
                                    type="text"
                                    value={editingTask.title}
                                    onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                                    className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Category</label>
                                    <div className="relative">
                                        <select
                                            value={editingTask.category}
                                            onChange={(e) => setEditingTask({ ...editingTask, category: e.target.value })}
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
                                            value={editingTask.priority}
                                            onChange={(e) => setEditingTask({ ...editingTask, priority: e.target.value })}
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

                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Deadline</label>
                                    <input
                                        type="date"
                                        value={editingTask.deadline}
                                        onChange={(e) => setEditingTask({ ...editingTask, deadline: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Scheduled Date</label>
                                    <input
                                        type="date"
                                        value={editingTask.scheduled_date}
                                        onChange={(e) => setEditingTask({ ...editingTask, scheduled_date: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700 text-sm"
                                    />
                                </div>
                            </div>

                            <div className="pt-4 flex justify-end gap-3 border-t border-slate-100 mt-2">
                                <button
                                    type="button"
                                    onClick={() => setEditingTask(null)}
                                    className="px-4 py-2 text-slate-500 hover:text-slate-700 font-bold text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-md hover:bg-indigo-700 hover:shadow-lg transform active:scale-95 transition-all"
                                >
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
