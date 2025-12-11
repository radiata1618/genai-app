"use client";

import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';

import { formatDate } from '../utils/date';
import CustomDatePicker from '../../components/CustomDatePicker';
import MobileMenuButton from '../../components/MobileMenuButton';

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

export default function BacklogPage() {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [filterPriority, setFilterPriority] = useState('All'); // All, High, Medium
    const [filterCategory, setFilterCategory] = useState('All');

    const [filterExcludeScheduled, setFilterExcludeScheduled] = useState(true);
    const [filterExcludePending, setFilterExcludePending] = useState(true);
    const [filterExcludeCompleted, setFilterExcludeCompleted] = useState(true);
    const [filterPetAllowedOnly, setFilterPetAllowedOnly] = useState(false);
    const [filterKeyword, setFilterKeyword] = useState('');

    // Form State
    const [form, setForm] = useState({
        title: '',
        category: 'Research',
        priority: 'Medium',
        deadline: '',
        scheduled_date: '',
        place: '',
        is_pending: false,
        is_pet_allowed: false
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Edit State
    const [editingTask, setEditingTask] = useState(null);

    // Drag & Drop State
    const [draggedItem, setDraggedItem] = useState(null);

    // Form Visibility
    const [showForm, setShowForm] = useState(true);
    const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
                scheduled_date: form.scheduled_date || null,
                status: form.is_pending ? 'PENDING' : 'STOCK'
            });
            setForm(prev => ({
                ...prev,
                title: ''
            }));
            await fetchTasks();
        } catch (e) {
            alert('Failed to create task: ' + e.message);
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

    // Inline Update
    const updateTaskField = async (id, field, value) => {
        // Optimistic update
        setTasks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));

        try {
            const task = tasks.find(t => t.id === id);
            await api.updateBacklogItem(id, { ...task, [field]: value });
        } catch (e) {
            console.error('Failed to update task field', e);
            // Revert on failure (simple fetch for now)
            fetchTasks();
        }
    };

    const handleHighlight = async (task, e) => {
        e.stopPropagation();
        const newStatus = !task.is_highlighted;
        // Optimistic update
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, is_highlighted: newStatus } : t));

        try {
            await api.updateBacklogItem(task.id, { ...task, is_highlighted: newStatus });
        } catch (e) {
            console.error('Failed to highlight task', e);
            fetchTasks();
        }
    };

    const handleToggleDone = async (task, e) => {
        e.stopPropagation();
        const newStatus = task.status === 'DONE' ? 'STOCK' : 'DONE';

        // Optimistic update
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));

        try {
            await api.updateBacklogItem(task.id, { ...task, status: newStatus });
        } catch (e) {
            console.error('Failed to toggle done', e);
            fetchTasks();
        }
    };

    // Drag & Drop
    const onDragStart = (e, index) => {
        setDraggedItem(tasks[index]);
        e.dataTransfer.effectAllowed = "move";
        // Set the drag image to the parent list item (row) instead of just the handle
        const row = e.currentTarget.closest('li');
        if (row) {
            e.dataTransfer.setDragImage(row, 0, 0);
        }
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
        if (filterExcludeCompleted && task.status === 'DONE') return false;
        if (filterExcludeScheduled && task.scheduled_date) return false;
        if (filterExcludePending && task.status === 'PENDING') return false;
        if (filterPriority === 'High' && task.priority !== 'High') return false;
        if (filterPriority === 'Medium' && task.priority === 'Low') return false; // Show Medium & High
        if (filterCategory !== 'All' && task.category !== filterCategory) return false;
        if (filterPetAllowedOnly && !task.is_pet_allowed) return false;

        if (filterKeyword.trim()) {
            const lowerKeyword = filterKeyword.toLowerCase();
            const matchesTitle = task.title.toLowerCase().includes(lowerKeyword);
            const matchesPlace = task.place ? task.place.toLowerCase().includes(lowerKeyword) : false;
            if (!matchesTitle && !matchesPlace) return false;
        }

        return true;
    });

    return (
        <div className="relative w-full h-full flex flex-col md:flex-row overflow-hidden">
            {/* Background Decor - Adjusted z-index to be behind content */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
                <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
                <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-yellow-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>
                <div className="absolute bottom-[-20%] left-[20%] w-[500px] h-[500px] bg-pink-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000"></div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0">
                {/* Top Section */}
                <div className="flex-none p-4 pb-2 z-10 space-y-2">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-2">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <MobileMenuButton />
                                <div>
                                    <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Stock</h1>
                                    <p className="text-slate-500 text-xs">いつかやりたいことをストック</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowForm(!showForm)}
                                className="bg-white/80 hover:bg-white text-slate-500 hover:text-indigo-600 p-1.5 rounded-lg border border-slate-200 shadow-sm transition-colors"
                                title={showForm ? "Hide Input" : "Add Task"}
                            >
                                {showForm ? (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" /></svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                                )}
                            </button>
                            <button
                                onClick={() => setMobileFiltersOpen(true)}
                                className="md:hidden bg-white/80 hover:bg-white text-slate-500 hover:text-indigo-600 p-1.5 rounded-lg border border-slate-200 shadow-sm transition-colors"
                                title="Filters"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                            </button>
                        </div>
                    </div>

                    {/* Create Form */}
                    {showForm && (
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
                                {/* Place Input - Only for Food */}

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
                                    <CustomDatePicker
                                        selected={form.deadline}
                                        onChange={(date) => setForm(prev => ({ ...prev, deadline: date }))}
                                        className="bg-slate-50 border-slate-200 rounded-lg text-xs py-1 px-2 focus:ring-indigo-500 w-28"
                                        placeholderText="No deadline"
                                    />
                                </div>

                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Plan</span>
                                    <CustomDatePicker
                                        selected={form.scheduled_date}
                                        onChange={(date) => setForm(prev => ({ ...prev, scheduled_date: date }))}
                                        className="bg-slate-50 border-slate-200 rounded-lg text-xs py-1 px-2 focus:ring-indigo-500 w-28"
                                        placeholderText="Not scheduled"
                                    />
                                </div>

                                <label className="flex items-center gap-1.5 cursor-pointer ml-2">
                                    <input
                                        type="checkbox"
                                        name="is_pending"
                                        checked={form.is_pending}
                                        onChange={handleChange}
                                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                                    />
                                    <span className="text-xs font-bold text-slate-500 uppercase">Pending</span>
                                </label>

                                {/* Place Input - Only for Food */}
                                {form.category === 'Food' && (
                                    <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-200">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Place</span>
                                        <input
                                            type="text"
                                            name="place"
                                            placeholder="Where?"
                                            value={form.place}
                                            onChange={handleChange}
                                            className="bg-slate-50 border-slate-200 rounded-lg text-xs py-1.5 px-3 focus:ring-indigo-500 w-32 md:w-36"
                                        />
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                name="is_pet_allowed"
                                                checked={form.is_pet_allowed}
                                                onChange={handleChange}
                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                            />
                                            <span className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">ペット可</span>
                                        </label>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={isSubmitting || !form.title.trim()}
                                    className="md:hidden w-full mt-2 bg-slate-900 text-white rounded-lg px-6 py-2 text-sm font-bold shadow-lg"
                                >
                                    Stock It
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                {/* Task List */}
                <div className="flex-1 px-4 pb-2 z-0 overflow-hidden flex flex-col min-h-0">
                    {loading ? (
                        <div className="text-center py-20 text-slate-400 animate-pulse text-sm">Loading stocks...</div>
                    ) : filteredTasks.length === 0 ? (
                        <div className="text-center py-20 bg-slate-100/50 rounded-2xl border-2 border-dashed border-slate-200">
                            <p className="text-slate-400 font-medium text-sm">No tasks match your filters.</p>
                        </div>
                    ) : (
                        <div className="flex-1 bg-white/60 backdrop-blur rounded-xl shadow-sm border border-white/50 flex flex-col overflow-hidden">
                            {/* List Container - Header moved inside for alignment */}
                            <div className="flex-1 overflow-y-auto">
                                {/* Sticky Header */}
                                <div className="hidden md:grid sticky top-0 grid-cols-[20px_20px_1fr_100px_60px_110px_110px_180px] gap-2 py-2 pl-1 pr-2 bg-slate-50/95 backdrop-blur border-b border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-wider items-center z-20">
                                    <div></div>
                                    <div></div> {/* Checkbox col */}
                                    <div>Task</div>
                                    <div>Category</div>
                                    <div className="text-center">Priority</div>
                                    <div>Deadline</div>
                                    <div>Scheduled</div>
                                    <div className="text-right">Actions</div>
                                </div>

                                {/* Mobile List View */}
                                <div className="md:hidden space-y-2 p-2">
                                    {filteredTasks.map((task) => (
                                        <div
                                            key={task.id}
                                            onClick={() => startEdit(task)}
                                            className={`bg-white rounded-lg p-3 shadow-sm border border-slate-100 flex gap-3 ${task.status === 'DONE' ? 'opacity-60' : ''}`}
                                        >
                                            <div
                                                onClick={(e) => handleToggleDone(task, e)}
                                                className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 mt-0.5 ${task.status === 'DONE' ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300'}`}
                                            >
                                                {task.status === 'DONE' && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className={`font-bold text-slate-800 text-sm mb-1 ${task.status === 'DONE' ? 'line-through text-slate-400' : ''}`}>
                                                    {task.title}
                                                </div>
                                                <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                                                    <span className={`px-1.5 py-0.5 rounded border ${PRIORITIES[task.priority]?.color}`}>
                                                        {PRIORITIES[task.priority]?.label}
                                                    </span>
                                                    <span className="flex items-center gap-1 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                                                        <span>{CATEGORIES[task.category]?.icon}</span>
                                                        <span>{CATEGORIES[task.category]?.label}</span>
                                                    </span>
                                                    {task.scheduled_date && (
                                                        <span className="text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                                                            {formatDate(task.scheduled_date)}
                                                        </span>
                                                    )}
                                                    {task.category === 'Food' && task.is_pet_allowed && (
                                                        <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded border border-green-100 flex items-center gap-1">
                                                            🐾 Pet OK
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <ul className="divide-y divide-slate-100 p-2">
                                    {filteredTasks.map((task, index) => (
                                        <li
                                            key={task.id}
                                            onDragOver={(e) => onDragOver(e, index)}
                                            className={`hidden md:grid group grid-cols-[20px_20px_1fr_100px_60px_110px_110px_180px] gap-2 p-2 transition-colors items-center
                                                ${task.is_highlighted ? 'bg-pink-50 border-pink-100 hover:bg-pink-100' : 'hover:bg-white'}
                                                ${task.status === 'DONE' ? 'opacity-60 bg-slate-50' : ''}
                                            `}
                                        >
                                            <div
                                                draggable
                                                onDragStart={(e) => onDragStart(e, index)}
                                                onDragEnd={onDragEnd}
                                                className="text-slate-300 cursor-grab active:cursor-grabbing text-xs p-1 hover:text-slate-500"
                                            >⋮⋮</div>

                                            {/* DONE Checkbox */}
                                            <div
                                                onClick={(e) => handleToggleDone(task, e)}
                                                className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer hover:ring-2 hover:ring-indigo-100
                                                    ${task.status === 'DONE' ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white group-hover:border-indigo-400'}
                                                `}
                                            >
                                                {task.status === 'DONE' && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                            </div>

                                            <div className="min-w-0 flex flex-col justify-center">
                                                {/* Inline Title Edit */}
                                                <input
                                                    type="text"
                                                    value={task.title}
                                                    onChange={(e) => setTasks(prev => prev.map(t => t.id === task.id ? { ...t, title: e.target.value } : t))}
                                                    onBlur={(e) => updateTaskField(task.id, 'title', e.target.value)}
                                                    className={`font-semibold text-slate-800 text-sm truncate leading-tight bg-transparent border-none p-0 focus:ring-0 w-full 
                                                        ${task.status === 'PENDING' ? 'text-slate-400 italic line-through decoration-slate-300' : ''}
                                                        ${task.status === 'DONE' ? 'line-through text-slate-400' : ''}
                                                    `}
                                                />
                                                <div className="flex flex-wrap gap-2 items-center text-[11px] text-slate-500 mt-0.5">
                                                    {task.category === 'Food' && task.place && (
                                                        <div className="flex items-center gap-1">
                                                            <span>📍</span>
                                                            <span>{task.place}</span>
                                                        </div>
                                                    )}
                                                    {task.category === 'Food' && task.is_pet_allowed && (
                                                        <span className="text-green-600 bg-green-50 px-1 rounded flex items-center gap-0.5 text-[10px]">
                                                            🐾 Pet OK
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="md:hidden flex flex-wrap gap-2 mt-0.5 text-[10px] text-slate-500">
                                                    <span className={`px-1 py-0 rounded border ${PRIORITIES[task.priority]?.color}`}>{PRIORITIES[task.priority]?.label}</span>
                                                    <span className="bg-slate-100 px-1 py-0 rounded">{CATEGORIES[task.category]?.label}</span>
                                                    {task.scheduled_date && <span className="text-indigo-600">Plan: {formatDate(task.scheduled_date)}</span>}
                                                    {task.status === 'PENDING' && <span className="text-slate-400 border border-slate-200 px-1 rounded">Pending</span>}
                                                    {task.status === 'DONE' && <span className="text-green-600 border border-green-200 bg-green-50 px-1 rounded">Done</span>}
                                                </div>
                                            </div>


                                            <div className="hidden md:flex items-center gap-1">
                                                {/* Inline Category Edit - simplified as click cycle or select? Let's use select customized */}
                                                <div className="relative group/cat">
                                                    <div className="flex items-center gap-1 cursor-pointer">
                                                        <span className="text-sm">{CATEGORIES[task.category]?.icon}</span>
                                                        <span className="text-xs text-slate-600 truncate max-w-[60px]">{CATEGORIES[task.category]?.label}</span>
                                                    </div>
                                                    {/* Hidden Select Overlay */}
                                                    <select
                                                        value={task.category}
                                                        onChange={(e) => updateTaskField(task.id, 'category', e.target.value)}
                                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                                    >
                                                        {CATEGORY_KEYS.map(key => (
                                                            <option key={key} value={key}>{CATEGORIES[key].label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="hidden md:flex justify-center">
                                                {/* Inline Priority Edit */}
                                                <div className="relative">
                                                    <span className={`text-[10px] font-bold px-1.5 py-0 rounded-full border ${PRIORITIES[task.priority]?.color} cursor-pointer`}>
                                                        {PRIORITIES[task.priority]?.label}
                                                    </span>
                                                    <select
                                                        value={task.priority}
                                                        onChange={(e) => updateTaskField(task.id, 'priority', e.target.value)}
                                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                                    >
                                                        {Object.keys(PRIORITIES).map(key => (
                                                            <option key={key} value={key}>{PRIORITIES[key].label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>

                                            <div className="hidden md:block text-[11px] text-slate-500">
                                                {task.deadline ? <span className="text-red-400 font-medium">{formatDate(task.deadline)}</span> : '-'}
                                            </div>

                                            <div className="hidden md:block text-[11px] text-slate-500">
                                                {task.scheduled_date ? <span className="text-indigo-600 font-medium truncate block">{formatDate(task.scheduled_date)}</span> : '-'}
                                            </div>

                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={(e) => handleHighlight(task, e)}
                                                    className={`p-1 rounded-md transition-colors ${task.is_highlighted ? 'text-pink-500 bg-pink-100' : 'text-slate-300 hover:text-pink-400 hover:bg-pink-50'}`}
                                                    title={task.is_highlighted ? "Remove Highlight" : "Highlight"}
                                                >
                                                    {task.is_highlighted ? '⭐' : '☆'}
                                                </button>
                                                <button
                                                    onClick={() => handleMoveToToday(task.id)}
                                                    className="px-2 py-0.5 bg-green-50 text-green-600 hover:bg-green-100 rounded text-xs font-bold border border-green-200 transition-colors whitespace-nowrap"
                                                >
                                                    今日やる
                                                </button>
                                                <button
                                                    onClick={() => updateTaskField(task.id, 'status', task.status === 'PENDING' ? 'STOCK' : 'PENDING')}
                                                    className={`p-1 rounded-md transition-colors ${task.status === 'PENDING' ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300 hover:text-slate-500'}`}
                                                    title={task.status === 'PENDING' ? "Restore to Stock" : "Move to Pending"}
                                                >
                                                    ⏸
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
            </div>

            {/* Right Sidebar Filters */}
            {mobileFiltersOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setMobileFiltersOpen(false)}
                />
            )}
            <div className={`
                fixed inset-y-0 right-0 z-50 w-64 bg-white/95 backdrop-blur border-l border-slate-200 p-4 overflow-y-auto flex flex-col gap-6 shadow-xl transform transition-transform duration-300
                md:relative md:translate-x-0 md:h-full
                ${mobileFiltersOpen ? 'translate-x-0' : 'translate-x-full'}
            `}>
                <div className="md:hidden flex justify-end mb-2">
                    <button onClick={() => setMobileFiltersOpen(false)} className="text-slate-400">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Search</h3>
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search..."
                            value={filterKeyword}
                            onChange={(e) => setFilterKeyword(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2 pl-9 pr-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder-slate-400"
                        />
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {filterKeyword && (
                            <button
                                onClick={() => setFilterKeyword('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">States</h3>
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer group whitespace-nowrap">
                            <input
                                type="checkbox"
                                checked={filterExcludeCompleted}
                                onChange={(e) => setFilterExcludeCompleted(e.target.checked)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                            />
                            <span className="text-sm text-slate-600 group-hover:text-slate-800 transition-colors">Doneを除く</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer group whitespace-nowrap">
                            <input
                                type="checkbox"
                                checked={filterExcludeScheduled}
                                onChange={(e) => setFilterExcludeScheduled(e.target.checked)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                            />
                            <span className="text-sm text-slate-600 group-hover:text-slate-800 transition-colors">予定済を除く</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer group whitespace-nowrap">
                            <input
                                type="checkbox"
                                checked={filterExcludePending}
                                onChange={(e) => setFilterExcludePending(e.target.checked)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                            />
                            <span className="text-sm text-slate-600 group-hover:text-slate-800 transition-colors">Pendingを除く</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer group whitespace-nowrap">
                            <input
                                type="checkbox"
                                checked={filterPetAllowedOnly}
                                onChange={(e) => setFilterPetAllowedOnly(e.target.checked)}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                            />
                            <span className="text-sm text-slate-600 group-hover:text-slate-800 transition-colors">ペット可のみ</span>
                        </label>
                    </div>
                </div>

                <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Priority</h3>
                    <div className="space-y-1">
                        <button
                            onClick={() => setFilterPriority('All')}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all ${filterPriority === 'All' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            All Priorities
                        </button>
                        <button
                            onClick={() => setFilterPriority('Medium')}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all ${filterPriority === 'Medium' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            Medium +
                        </button>
                        <button
                            onClick={() => setFilterPriority('High')}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all ${filterPriority === 'High' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            High Only
                        </button>
                    </div>
                </div>

                <div>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Category</h3>
                    <div className="space-y-1">
                        <button
                            onClick={() => setFilterCategory('All')}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all ${filterCategory === 'All' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                        >
                            All Categories
                        </button>
                        {CATEGORY_KEYS.map(key => (
                            <button
                                key={key}
                                onClick={() => setFilterCategory(key)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${filterCategory === key ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                            >
                                <span>{CATEGORIES[key].icon}</span>
                                <span>{CATEGORIES[key].label}</span>
                            </button>
                        ))}
                    </div>
                </div>
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
                            <div className="grid grid-cols-[1fr_auto] gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Title</label>
                                    <input
                                        type="text"
                                        value={editingTask.title}
                                        onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                                        className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700"
                                    />
                                </div>
                                {editingTask.category === 'Food' && (
                                    <div className="w-40 animate-in fade-in zoom-in duration-200">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Place</label>
                                        <input
                                            type="text"
                                            value={editingTask.place || ''}
                                            onChange={(e) => setEditingTask({ ...editingTask, place: e.target.value })}
                                            placeholder="Where?"
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700 mb-2"
                                        />
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={editingTask.is_pet_allowed || false}
                                                onChange={(e) => setEditingTask({ ...editingTask, is_pet_allowed: e.target.checked })}
                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                            />
                                            <span className="text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">ペット可</span>
                                        </label>
                                    </div>
                                )}
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
                                    <CustomDatePicker
                                        selected={editingTask.deadline}
                                        onChange={(date) => setEditingTask({ ...editingTask, deadline: date })}
                                        className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700 text-sm"
                                        placeholderText="No deadline"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Scheduled Date</label>
                                    <CustomDatePicker
                                        selected={editingTask.scheduled_date}
                                        onChange={(date) => setEditingTask({ ...editingTask, scheduled_date: date })}
                                        className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700 text-sm"
                                        placeholderText="Not scheduled"
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
