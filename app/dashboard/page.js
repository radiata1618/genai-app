"use client";

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { api } from '../utils/api';
import { getDailyTasks, addQuickTask } from '../actions/dashboard';
import { toggleTaskComplete, skipTask, highlightTask, updateTaskTitle, reorderDailyTasks, postponeTask } from '../actions/daily';
import { formatDate } from '../utils/date';
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import MobileMenuButton from '../../components/MobileMenuButton';
import { useSearchParams } from 'next/navigation';

const CATEGORIES = {
    'Research': { label: '情報収集', icon: '🔍' },
    'Digital': { label: 'Digital', icon: '💻' },
    'English': { label: '英語', icon: '🅰️' },
    'Food': { label: '食', icon: '🍔' },
    'Dog': { label: '犬', icon: '🐕' },
    'Outing': { label: 'お出かけ', icon: '🏞️' },
    'Chores': { label: '雑務', icon: '🧹' },
    'Shopping': { label: '買い物', 'icon': '🛒' },
    'Book': { label: '本', icon: '📚' },
    'Other': { label: 'その他', icon: '📦' },
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);

const PRIORITIES = {
    'High': { label: '高', color: 'text-red-600 bg-red-50 border-red-200' },
    'Medium': { label: '中', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    'Low': { label: '低', color: 'text-slate-600 bg-slate-50 border-slate-200' },
};

function DashboardContent() {
    const [routines, setRoutines] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCompleted, setShowCompleted] = useState(false);
    const [undoHistory, setUndoHistory] = useState([]);

    // Quick Input State
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const inputRef = useRef(null);
    const searchParams = useSearchParams();

    // Drag State
    const [draggedItem, setDraggedItem] = useState(null);
    const [todayStr, setTodayStr] = useState('');

    // Postpone Modal State
    const [postponeModalOpen, setPostponeModalOpen] = useState(false);
    const [taskToPostpone, setTaskToPostpone] = useState(null);
    const [postponeDate, setPostponeDate] = useState(new Date());

    // --- Caching Logic ---
    const loadCache = () => {
        try {
            const cachedTasks = localStorage.getItem('dashboard_tasks');
            if (cachedTasks) {
                setTasks(JSON.parse(cachedTasks));
                setLoading(false); // Show content immediately
            }
        } catch (e) {
            console.error("Cache read error", e);
        }
    };

    const saveCache = (newTasks) => {
        try {
            localStorage.setItem('dashboard_tasks', JSON.stringify(newTasks));
        } catch (e) {
            console.error("Cache write error", e);
        }
    };

    const init = async (currentTodayStr) => {
        // Don't set loading=true here if we already have cache, to avoid flickering
        // Instead, we just fetch and update.

        try {
            // Fetch data in parallel for Main View
            const [r, t] = await Promise.all([
                api.getRoutines(),
                getDailyTasks(currentTodayStr)
            ]);

            setRoutines(r.filter(x => x.routine_type === 'MINDSET'));
            setTasks(t);
            saveCache(t); // Update cache with fresh data
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        const currentTodayStr = formatDate(new Date());
        setTodayStr(currentTodayStr);
        loadCache(); // Load cache first
        init(currentTodayStr); // Then fetch fresh

        // Check for focus param (from shortcut)
        if (searchParams.get('focus') === 'input') {
            setTimeout(() => inputRef.current?.focus(), 500);
        }
    }, []);

    const handleToggle = async (id, currentStatus) => {
        const isDone = currentStatus !== 'DONE';

        // Add to history
        setUndoHistory(prev => {
            const newHistory = [...prev, { id, status: currentStatus }];
            if (newHistory.length > 3) newHistory.shift();
            return newHistory;
        });

        // Optimistic update
        const updatedTasks = tasks.map(t => t.id === id ? { ...t, status: isDone ? 'DONE' : 'TODO' } : t);
        setTasks(updatedTasks);
        saveCache(updatedTasks);

        try {
            await toggleTaskComplete(id, isDone);
        } catch (e) {
            console.error("Failed to toggle", e);
            // Revert included in optimistic update logic implicitly if needed, but for now we trust optimistic
        }
    };

    const handleUndo = async () => {
        if (undoHistory.length === 0) return;

        const lastAction = undoHistory[undoHistory.length - 1];
        setUndoHistory(prev => prev.slice(0, -1));

        // Optimistic update to previous status
        const updatedTasks = tasks.map(t => t.id === lastAction.id ? { ...t, status: lastAction.status } : t);
        setTasks(updatedTasks);
        saveCache(updatedTasks);

        try {
            const isDone = lastAction.status === 'DONE';
            await toggleTaskComplete(lastAction.id, isDone);
        } catch (e) {
            console.error("Failed to undo", e);
        }
    };

    const handleQuickAdd = async (e) => {
        e.preventDefault();
        const titleVal = newTaskTitle.trim();
        if (!titleVal) return;

        // 1. Optimistic UI Update
        const tempId = `temp_${Date.now()}`;
        const optimisticTask = {
            id: tempId,
            title: titleVal,
            status: 'TODO',
            source_type: 'BACKLOG',
            source_id: 'temp',
            target_date: todayStr,
            created_at: new Date().toISOString(),
            order: 99999, // Put at end
            is_highlighted: false,
            current_goal_progress: null
        };

        setTasks(prev => {
            const newTasks = [...prev, optimisticTask];
            return newTasks;
        });
        setNewTaskTitle('');
        // Keep focus
        inputRef.current?.focus();

        // 2. Background API Call (Server Action)
        try {
            await addQuickTask(titleVal, todayStr);

            // Refresh in background to get real ID
            const t = await getDailyTasks(todayStr);
            setTasks(t);
            saveCache(t);
        } catch (e) {
            console.error(e);
            // Rollback on error
            setTasks(prev => {
                const newTasks = prev.filter(t => t.id !== tempId);
                saveCache(newTasks);
                return newTasks;
            });
            alert('Failed to add task');
        }
    };

    const visibleTasks = showCompleted ? tasks : tasks.filter(t => t.status !== 'DONE' && t.status !== 'SKIPPED');



    const handleSkip = async (id, e) => {
        e.stopPropagation();

        // Optimistic update
        const updatedTasks = tasks.map(t => t.id === id ? { ...t, status: 'SKIPPED' } : t);
        setTasks(updatedTasks);
        saveCache(updatedTasks);

        try {
            await skipTask(id);
        } catch (e) {
            console.error("Failed to skip", e);
        }
    };

    const openPostponeModal = (task, e) => {
        e.stopPropagation();

        setTaskToPostpone(task);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        setPostponeDate(tomorrow);
        setPostponeModalOpen(true);
    };

    const handlePostpone = async () => {
        if (!taskToPostpone) return;

        const dateStr = postponeDate ? postponeDate.toISOString().split('T')[0] : null;

        // Optimistic update: Remove from today
        const updatedTasks = tasks.filter(t => t.id !== taskToPostpone.id);
        setTasks(updatedTasks);
        saveCache(updatedTasks);
        setPostponeModalOpen(false);

        try {
            await postponeTask(taskToPostpone.id, dateStr);
        } catch (e) {
            console.error("Failed to postpone", e);
            alert("Failed to postpone task");
            init(); // Re-fetch to sync state if postpone failed or ID changed unexpectedly
        }
    };

    const handleHighlight = async (id, currentStatus, e) => {
        e.stopPropagation();

        const newStatus = !currentStatus;
        // Optimistic update
        const updatedTasks = tasks.map(t => t.id === id ? { ...t, is_highlighted: newStatus } : t);
        setTasks(updatedTasks);
        saveCache(updatedTasks);

        try {
            await highlightTask(id, newStatus);
        } catch (e) {
            console.error("Failed to highlight", e);
        }
    };

    // Drag & Drop Handlers
    const onDragStart = (e, task) => {
        setDraggedItem(task);
        e.dataTransfer.effectAllowed = 'move';
    };

    const onDragOver = (e, targetTask) => {
        e.preventDefault();
        if (!draggedItem || draggedItem.id === targetTask.id) return;

        const oldIndex = tasks.findIndex(t => t.id === draggedItem.id);
        const newIndex = tasks.findIndex(t => t.id === targetTask.id);

        if (oldIndex === -1 || newIndex === -1) return;

        const newTasks = [...tasks];
        newTasks.splice(oldIndex, 1);
        newTasks.splice(newIndex, 0, draggedItem);

        setTasks(newTasks);
        saveCache(newTasks);
    };

    const onDragEnd = async () => {
        if (!draggedItem) return;
        setDraggedItem(null);

        const ids = tasks.map(t => t.id);
        try {
            await reorderDailyTasks(ids);
        } catch (e) {
            console.error("Failed to reorder", e);
        }
    };

    // Manual Reorder Handlers
    const [reorderMenuId, setReorderMenuId] = useState(null);

    const handleMove = async (task, direction, e) => {
        e.stopPropagation();
        setReorderMenuId(null);

        const index = tasks.findIndex(t => t.id === task.id);
        if (index === -1) return;

        const newTasks = [...tasks];

        if (direction === 'UP') {
            if (index === 0) return;
            [newTasks[index - 1], newTasks[index]] = [newTasks[index], newTasks[index - 1]];
        } else if (direction === 'DOWN') {
            if (index === newTasks.length - 1) return;
            [newTasks[index], newTasks[index + 1]] = [newTasks[index + 1], newTasks[index]];
        }

        setTasks(newTasks);
        saveCache(newTasks);

        const ids = newTasks.map(t => t.id);
        try {
            await reorderDailyTasks(ids);
        } catch (e) {
            console.error("Failed to reorder manually", e);
        }
    };

    return (
        <div className="relative w-full h-full bg-slate-50 font-sans text-slate-900 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 flex overflow-hidden">
                {/* Main Content */}
                <div className="flex-1 flex flex-col h-full p-2 md:p-4 gap-2 min-h-0 min-w-0 pb-16 md:pb-4">

                    {/* Header */}
                    <div className="flex-none flex flex-col md:flex-row md:items-end justify-between gap-2">
                        <div className="flex-1 flex items-center gap-2">
                            <MobileMenuButton />
                            <div>
                                <h1 className="text-xl font-black text-slate-800 tracking-tight">Today's Focus</h1>
                                <p className="text-xs text-slate-500 font-medium">{todayStr}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 self-end md:self-auto">
                            {/* Replaced Add Task button with Bottom Bar, but kept Undo/Show toggle */}
                            <button
                                onClick={handleUndo}
                                disabled={undoHistory.length === 0}
                                className={`text-[10px] font-bold px-3 py-1.5 rounded-full shadow-sm transition-all flex items-center gap-1
                                    ${undoHistory.length > 0
                                        ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                                        : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                    }`}
                            >
                                <span>↩️</span> <span className="hidden sm:inline">Undo</span>
                            </button>
                            <button
                                onClick={() => setShowCompleted(!showCompleted)}
                                className={`text-[10px] font-bold px-2 py-1.5 rounded-full border transition-all flex items-center gap-1.5
                                    ${showCompleted
                                        ? 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'
                                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                    }`}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full ${showCompleted ? 'bg-indigo-500' : 'bg-slate-300'}`} />
                                {showCompleted ? 'All' : 'Active'}
                            </button>
                        </div>
                    </div>

                    {/* Tasks List - Scrollable Area */}
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col" onClick={() => { setReorderMenuId(null); }}>
                        <div className="h-1 bg-indigo-500 w-full flex-shrink-0" />

                        <div className="overflow-y-auto flex-1 p-1 space-y-0.5 custom-scrollbar pb-20 md:pb-1">
                            {loading && tasks.length === 0 ? <div className="text-center py-10 opacity-50 text-xs">Loading Focus...</div> : visibleTasks.length === 0 ? (
                                <div className="text-center py-20">
                                    <div className="text-4xl mb-2">☕</div>
                                    <h3 className="font-bold text-slate-800">
                                        {tasks.length > 0 && !showCompleted ? 'All done for now!' : 'All caught up!'}
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-1">
                                        Type below to add a new task.
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
                                              ${t.id.toString().startsWith('temp_') ? 'bg-slate-50 border-slate-100' : ''}
                                              ${t.status === 'DONE' || t.status === 'SKIPPED'
                                                ? 'bg-slate-50 border-slate-50 opacity-50'
                                                : t.is_highlighted
                                                    ? 'bg-pink-50 border-pink-100 hover:border-pink-200 shadow-sm'
                                                    : 'bg-white border-transparent hover:border-indigo-100 hover:bg-slate-50 hover:shadow-sm'
                                            }`}
                                        style={{ opacity: draggedItem?.id === t.id ? 0.3 : (t.status === 'DONE' || t.status === 'SKIPPED' ? 0.5 : 1) }}
                                    >
                                        {/* Drag Handle */}
                                        <div
                                            className="text-slate-300 cursor-pointer p-2 hover:bg-slate-100 rounded transition-colors flex flex-col justify-center items-center h-8 w-6 group-hover:text-indigo-400"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setReorderMenuId(reorderMenuId === t.id ? null : t.id);

                                            }}
                                        >
                                            <div className="flex gap-0.5">
                                                <div className="w-0.5 h-0.5 bg-current rounded-full"></div>
                                                <div className="w-0.5 h-0.5 bg-current rounded-full"></div>
                                            </div>
                                            <div className="flex gap-0.5 mt-0.5">
                                                <div className="w-0.5 h-0.5 bg-current rounded-full"></div>
                                                <div className="w-0.5 h-0.5 bg-current rounded-full"></div>
                                            </div>
                                            <div className="flex gap-0.5 mt-0.5">
                                                <div className="w-0.5 h-0.5 bg-current rounded-full"></div>
                                                <div className="w-0.5 h-0.5 bg-current rounded-full"></div>
                                            </div>

                                            {/* Reorder Menu */}
                                            {reorderMenuId === t.id && (
                                                <div className="absolute left-0 top-8 w-32 bg-white border border-slate-200 shadow-xl rounded-lg z-[60] overflow-hidden animate-in fade-in zoom-in duration-100">
                                                    <button
                                                        onClick={(e) => handleMove(t, 'UP', e)}
                                                        className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-b border-slate-50"
                                                    >
                                                        <span>⬆️</span> Move Up
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleMove(t, 'DOWN', e)}
                                                        className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                                    >
                                                        <span>⬇️</span> Move Down
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <div
                                            onClick={(e) => {
                                                if (t.id.toString().startsWith('temp_')) return;
                                                e.stopPropagation();
                                                handleToggle(t.id, t.status);
                                            }}
                                            className={`w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center transition-colors cursor-pointer hover:ring-2 hover:ring-indigo-100
                                           ${t.id.toString().startsWith('temp_') ? 'opacity-50 cursor-wait' : ''}
                                           ${t.status === 'DONE' ? 'bg-indigo-500 border-indigo-500' :
                                                    t.status === 'SKIPPED' ? 'bg-slate-200 border-slate-200' :
                                                        'border-slate-300 bg-white group-hover:border-indigo-400'}
                                       `}>
                                            {t.status === 'DONE' && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                            {t.status === 'SKIPPED' && <span className="text-[8px]">⏭️</span>}
                                        </div>
                                        <div className="flex-1 min-w-0 flex items-center justify-between">
                                            {t.source_type === 'BACKLOG' ? (
                                                <input
                                                    type="text"
                                                    value={t.title}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setTasks(prev => prev.map(task => task.id === t.id ? { ...task, title: val } : task));
                                                    }}
                                                    onBlur={async (e) => {
                                                        const val = e.target.value;
                                                        try {
                                                            await updateTaskTitle(t.id, val);
                                                            saveCache(tasks.map(task => task.id === t.id ? { ...task, title: val } : task));
                                                        } catch (err) {
                                                            console.error("Failed to update title", err);
                                                            // Revert? For now just log. Optimisitc update is already done.
                                                        }
                                                    }}
                                                    className={`font-semibold text-sm truncate bg-transparent border-none p-0 focus:ring-0 w-full outline-none
                                                            ${t.status === 'DONE' || t.status === 'SKIPPED' ? 'line-through text-slate-400' : 'text-slate-700'}`}
                                                />
                                            ) : (
                                                <div className={`font-semibold text-sm truncate ${t.status === 'DONE' || t.status === 'SKIPPED' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                                                    {t.title || 'Unknown Task'}
                                                </div>
                                            )}
                                            <div className="flex gap-2 text-[9px] items-center">
                                                {t.current_goal_progress && (
                                                    <span className={`px-1.5 py-0.5 rounded font-mono font-bold ${t.status === 'DONE' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                                        {t.current_goal_progress}
                                                    </span>
                                                )}
                                                <span className="text-slate-300 font-mono uppercase tracking-wider group-hover:text-slate-400 transition-colors">
                                                    {t.source_type}
                                                </span>
                                                {/* Action Buttons - Fixed Width for Alignment */}
                                                <div className="flex items-center gap-1 transition-opacity w-[88px] flex-none justify-start">
                                                    <button
                                                        onClick={(e) => handleSkip(t.id, e)}
                                                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                                                        title="Skip"
                                                    >
                                                        ⏭️
                                                    </button>

                                                    <button
                                                        onClick={(e) => handleHighlight(t.id, t.is_highlighted, e)}
                                                        className={`p-1.5 rounded-md transition-colors ${t.is_highlighted ? 'text-pink-500 bg-pink-50 hover:bg-pink-100' : 'text-slate-400 hover:text-pink-400 hover:bg-pink-50'}`}
                                                        title={t.is_highlighted ? "Unhighlight" : "Highlight"}
                                                    >
                                                        {t.is_highlighted ? '⭐' : '☆'}
                                                    </button>

                                                    {t.source_type === 'BACKLOG' && (
                                                        <button
                                                            onClick={(e) => openPostponeModal(t, e)}
                                                            className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                                            title="Reschedule"
                                                        >
                                                            📅
                                                        </button>
                                                    )}
                                                </div>
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

            {/* Quick Input Bar (Fixed Bottom) */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-2 md:p-3 shadow-lg z-50 md:hidden pb-safe">
                {/* pb-safe for iOS home bar */}
                <form onSubmit={handleQuickAdd} className="flex gap-2 items-center">
                    <input
                        ref={inputRef}
                        type="text"
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        placeholder="Add a new task..."
                        className="flex-1 bg-slate-100 border-none rounded-full px-4 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner outline-none"
                    />
                    <button
                        type="submit"
                        disabled={isSubmitting || !newTaskTitle.trim()}
                        className="bg-indigo-600 text-white rounded-full w-10 h-10 flex items-center justify-center shadow-md disabled:opacity-50 disabled:shadow-none transition-all active:scale-90"
                    >
                        {isSubmitting ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <svg className="w-5 h-5 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 12h14M12 5l7 7-7 7" />
                            </svg>
                        )}
                    </button>
                </form>
            </div>
            {/* Desktop Input */}
            <div className="hidden md:flex fixed bottom-8 left-1/2 -translate-x-1/2 w-[500px] bg-white border border-slate-200 p-2 rounded-full shadow-2xl z-50">
                <form onSubmit={handleQuickAdd} className="flex-1 flex gap-2 items-center px-1">
                    <input
                        ref={inputRef}
                        type="text"
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        placeholder="Add a new task..."
                        className="flex-1 bg-transparent border-none px-4 py-2 text-sm font-medium focus:ring-0 outline-none"
                        autoFocus
                    />
                    <button
                        type="submit"
                        disabled={isSubmitting || !newTaskTitle.trim()}
                        className="bg-indigo-600 text-white rounded-full w-8 h-8 flex items-center justify-center shadow-md disabled:opacity-50 transition-all hover:bg-indigo-700"
                    >
                        <svg className="w-4 h-4 ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                    </button>
                </form>
            </div>


            {/* Postpone Modal */}
            {postponeModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-bold text-slate-800 mb-4">Postpone Task</h3>
                        <p className="text-sm text-slate-600 mb-4">
                            Select a new date for <strong>{taskToPostpone?.title}</strong>.
                            {postponeDate ? ' It will be moved to Stock with this scheduled date.' : ' It will be returned to Backlog (Stack) without a date.'}
                        </p>

                        <div className="mb-6">
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">New Date</label>
                                <button
                                    onClick={() => setPostponeDate(null)}
                                    className={`text-xs font-bold px-2 py-1 rounded transition-colors ${!postponeDate ? 'bg-slate-200 text-slate-700' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                                >
                                    Unscheduled
                                </button>
                            </div>
                            <div className={`transition-opacity duration-200 ${!postponeDate ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                                <DatePicker
                                    selected={postponeDate}
                                    onChange={(date) => setPostponeDate(date)}
                                    dateFormat="yyyy/MM/dd"
                                    calendarStartDay={1}
                                    className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none text-slate-700 font-medium"
                                    inline
                                    disabled={!postponeDate}
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setPostponeModalOpen(false)}
                                className="px-4 py-2 text-slate-500 hover:text-slate-700 font-bold text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handlePostpone}
                                className={`px-6 py-2 text-white rounded-xl font-bold text-sm shadow-md transition-all
                                    ${!postponeDate ? 'bg-slate-600 hover:bg-slate-700' : 'bg-indigo-600 hover:bg-indigo-700'}
                                `}
                            >
                                {postponeDate ? 'Confirm Date' : 'Return to Backlog'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={<div className="flex items-center justify-center h-full w-full bg-slate-50 text-slate-400 text-sm font-medium">Loading Dashboard...</div>}>
            <DashboardContent />
        </Suspense>
    );
}
