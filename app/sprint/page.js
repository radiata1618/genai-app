'use client';

import React, { useState, useEffect } from 'react';
import { getCurrentSprint, createSprint, updateSprintGoal, completeSprint, addTasksToSprint, getSprintTasks, removeTaskFromSprint, deleteSprint } from '../actions/sprint';
import { updateBacklogItem, reorderBacklogItems, addBacklogItem } from '../actions/backlog'; // Import for status update, reorder, and add
import { getBacklogItems } from '../actions/backlog';
import { formatDate } from '../utils/date';
import CustomDatePicker from '../../components/CustomDatePicker';
import MobileMenuButton from '../../components/MobileMenuButton';

export default function SprintPage() {
    const [currentSprint, setCurrentSprint] = useState(null);
    const [sprintTasks, setSprintTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    // Drag & Drop
    const [draggedItem, setDraggedItem] = useState(null);

    // Reschedule Modal
    const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
    const [taskToReschedule, setTaskToReschedule] = useState(null);
    const [rescheduleDate, setRescheduleDate] = useState(null);

    // Initial Fetch
    const init = async () => {
        setLoading(true);
        try {
            const sprint = await getCurrentSprint();
            setCurrentSprint(sprint);
            if (sprint) {
                const tasks = await getSprintTasks(sprint.id);
                setSprintTasks(tasks);
                setGoal(sprint.goal || '');
            }
        } catch (e) {
            console.error("Failed to load sprint", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        init();
    }, []);

    // --- Create Sprint Logic ---
    const [createForm, setCreateForm] = useState({
        name: '',
        startDate: new Date(),
        endDate: new Date(new Date().setDate(new Date().getDate() + 7)) // Default 1 week
    });

    const [suggestedTasks, setSuggestedTasks] = useState([]);
    const [showSuggestionModal, setShowSuggestionModal] = useState(false);
    const [preSelectionIds, setPreSelectionIds] = useState(new Set());

    const handleCreateSprintClick = async (e) => {
        e.preventDefault();
        // Check for scheduled tasks in range
        try {
            const tasksInRange = await getBacklogItems({
                startDate: createForm.startDate,
                endDate: createForm.endDate,
                excludeInSprint: true,
                excludeCompleted: true
            });

            // Filter tasks that actually have a scheduled_date (just in case backend filter is loose or for safety)
            const matches = tasksInRange.filter(t => t.scheduled_date);

            if (matches.length > 0) {
                setSuggestedTasks(matches);
                // Default select all
                setPreSelectionIds(new Set(matches.map(t => t.id)));
                setShowSuggestionModal(true);
            } else {
                // No suggestions, just create
                await performCreateSprint([]);
            }
        } catch (e) {
            console.error(e);
            // Fallback create
            await performCreateSprint([]);
        }
    };

    const performCreateSprint = async (initialTaskIds) => {
        try {
            const newSprint = await createSprint(createForm);
            if (initialTaskIds && initialTaskIds.length > 0) {
                await addTasksToSprint(newSprint.id, initialTaskIds);
            }
            await init(); // Reload
        } catch (e) {
            alert(e.message);
        }
    };

    const confirmSuggestions = async () => {
        setShowSuggestionModal(false);
        await performCreateSprint(Array.from(preSelectionIds));
    };

    const cancelSuggestions = async () => {
        // User cancelled the suggestion modal? Assume they want to cancel SPRINT CREATION or just ignore suggestions?
        // Usually cancel means "go back", but maybe they want to create without suggestions?
        // Let's assume Cancel -> Don't create sprint yet.
        setShowSuggestionModal(false);
    };

    const createWithoutSuggestions = async () => {
        setShowSuggestionModal(false);
        await performCreateSprint([]);
    };

    // --- Sprint Board Logic ---
    const [goal, setGoal] = useState('');
    const [isSavingGoal, setIsSavingGoal] = useState(false);

    // Task Creation Form State
    const [showCreateForm, setShowCreateForm] = useState(false);
    const [createFormTask, setCreateFormTask] = useState({
        title: '',
        category: 'Research',
        priority: 'Medium',
        deadline: '',
        scheduled_date: '',
        place: '',
        is_pet_allowed: false
    });
    const [isCreatingTask, setIsCreatingTask] = useState(false);

    const handleCreateTaskChange = (e) => {
        const { name, value, type, checked } = e.target;
        setCreateFormTask(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleCreateTask = async (e) => {
        e.preventDefault();
        if (!createFormTask.title.trim()) return;

        setIsCreatingTask(true);
        try {
            const newTask = await addBacklogItem({
                ...createFormTask,
                sprintId: currentSprint.id // Assign to current sprint
            });

            setSprintTasks(prev => [newTask, ...prev]); // Optimistic add to top or refetch
            setCreateFormTask({
                title: '',
                category: 'Research',
                priority: 'Medium',
                deadline: '',
                scheduled_date: '',
                place: '',
                is_pet_allowed: false
            });
            setShowCreateForm(false);
        } catch (e) {
            console.error("Failed to create task", e);
        } finally {
            setIsCreatingTask(false);
        }
    };

    // Sprint Filters

    // Sprint Filters
    const [showCompletedSprintTasks, setShowCompletedSprintTasks] = useState(false); // Default hidden

    const handleSaveGoal = async () => {
        setIsSavingGoal(true);
        try {
            await updateSprintGoal(currentSprint.id, goal);
        } finally {
            setIsSavingGoal(false);
        }
    };

    const handleRemoveTask = async (taskId) => {
        const task = sprintTasks.find(t => t.id === taskId);
        if (!task) return;

        // If task has scheduled_date, prompt reschedule
        if (task.scheduled_date) {
            setTaskToReschedule(task);
            setRescheduleDate(new Date(task.scheduled_date));
            setRescheduleModalOpen(true);
            return;
        }

        // Standard remove for non-scheduled
        if (!confirm('Remove from proper Sprint?')) return;
        executeRemoveTask(taskId);
    };

    const executeRemoveTask = async (taskId, scheduleUpdate = undefined) => {
        try {
            await removeTaskFromSprint(taskId, scheduleUpdate);
            setSprintTasks(prev => prev.filter(t => t.id !== taskId));
            setRescheduleModalOpen(false);
            setTaskToReschedule(null);
        } catch (e) {
            alert('Failed to remove');
            console.error(e);
        }
    };

    // --- Add Task Modal ---
    const [showAddModal, setShowAddModal] = useState(false);
    const [backlogTasks, setBacklogTasks] = useState([]);
    const [selectedTaskIds, setSelectedTaskIds] = useState(new Set());

    const openAddModal = async () => {
        setShowAddModal(true);
        const tasks = await getBacklogItems({ excludeInSprint: true, excludeCompleted: true });
        setBacklogTasks(tasks);
        setSelectedTaskIds(new Set());
    };

    const toggleSelection = (id) => {
        const newSet = new Set(selectedTaskIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedTaskIds(newSet);
    };

    const handleAddTasks = async () => {
        try {
            await addTasksToSprint(currentSprint.id, Array.from(selectedTaskIds));
            setShowAddModal(false);
            const updatedTasks = await getSprintTasks(currentSprint.id);
            setSprintTasks(updatedTasks);
        } catch (e) {
            alert('Failed to add tasks: ' + e.message);
        }
    };

    // --- Complete Sprint Modal ---
    const [showRetroModal, setShowRetroModal] = useState(false);
    const [retroText, setRetroText] = useState('');

    const handleCompleteSprint = async () => {
        if (!confirm('Complete this sprint?')) return;
        try {
            await completeSprint(currentSprint.id, retroText);
            setShowRetroModal(false);
            setCurrentSprint(null);
            setSprintTasks([]);
        } catch (e) {
            alert('Failed to complete: ' + e.message);
        }
    };

    const handleDeleteSprint = async () => {
        if (!confirm('本当にスプリントを削除しますか？\nタスクは削除されませんが、スプリントの割り当ては解除されます。')) return;
        try {
            await deleteSprint(currentSprint.id);
            setCurrentSprint(null);
            setSprintTasks([]);
        } catch (e) {
            alert('Failed to delete: ' + e.message);
        }
    };

    const handleToggleTaskStatus = async (task) => {
        const newStatus = task.status === 'DONE' ? 'STOCK' : 'DONE';
        // Optimistic
        setSprintTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));

        try {
            await updateBacklogItem(task.id, { status: newStatus });
        } catch (e) {
            console.error('Failed to toggle status', e);
            // Revert? For now just log
        }
    };

    // --- Drag & Drop Handlers ---
    const onDragStart = (e, task) => {
        setDraggedItem(task);
        e.dataTransfer.effectAllowed = "move";
        // Set drag image to row
        const row = e.currentTarget.closest('li');
        if (row) e.dataTransfer.setDragImage(row, 0, 0);
    };

    const onDragOver = (e, overTask) => {
        e.preventDefault();
        if (!draggedItem || draggedItem.id === overTask.id) return;

        // Find indices in full list
        const oldIndex = sprintTasks.findIndex(t => t.id === draggedItem.id);
        const newIndex = sprintTasks.findIndex(t => t.id === overTask.id);

        if (oldIndex === -1 || newIndex === -1) return;

        const newTasks = [...sprintTasks];
        newTasks.splice(oldIndex, 1);
        newTasks.splice(newIndex, 0, draggedItem);
        setSprintTasks(newTasks);
    };

    const onDragEnd = async () => {
        setDraggedItem(null);
        try {
            // Persist order
            await reorderBacklogItems(sprintTasks.map(t => t.id));
        } catch (e) {
            console.error('Failed to save order', e);
        }
    };

    if (loading) return <div className="p-10 text-center text-slate-400">Loading Sprint...</div>;

    // --- No Active Sprint View ---
    if (!currentSprint) {
        return (
            <div className="w-full h-full p-6 flex flex-col items-center justify-center bg-slate-50 relative overflow-hidden">
                {/* Decor */}
                <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000"></div>

                <div className="bg-white/80 backdrop-blur-xl p-8 rounded-2xl shadow-xl border border-white/50 w-full max-w-md z-10">
                    <div className="flex items-center gap-3 mb-6">
                        <MobileMenuButton />
                        <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Start New Sprint</h1>
                    </div>

                    <form onSubmit={handleCreateSprintClick} className="space-y-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Sprint Name</label>
                            <input
                                type="text"
                                required
                                value={createForm.name}
                                onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                                placeholder="e.g. Catch-up Week, Feature X"
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Start Date</label>
                                <CustomDatePicker
                                    selected={createForm.startDate}
                                    onChange={date => setCreateForm({ ...createForm, startDate: date })}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">End Date</label>
                                <CustomDatePicker
                                    selected={createForm.endDate}
                                    onChange={date => setCreateForm({ ...createForm, endDate: date })}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                />
                            </div>
                        </div>
                        <button
                            type="submit"
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg hover:shadow-indigo-500/30 transition-all transform hover:-translate-y-0.5"
                        >
                            Create Sprint
                        </button>
                    </form>
                </div>

                {/* Auto-Assign Suggestions Modal */}
                {showSuggestionModal && (
                    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in">
                        <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Assign scheduled tasks?</h3>
                                <p className="text-sm text-slate-500">Found {suggestedTasks.length} tasks scheduled in this period.</p>
                            </div>
                            <div className="max-h-60 overflow-y-auto border rounded-lg p-2 space-y-1">
                                {suggestedTasks.map(t => (
                                    <label key={t.id} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={preSelectionIds.has(t.id)}
                                            onChange={e => {
                                                const ns = new Set(preSelectionIds);
                                                if (e.target.checked) ns.add(t.id);
                                                else ns.delete(t.id);
                                                setPreSelectionIds(ns);
                                            }}
                                            className="rounded text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <div className="flex-1">
                                            <div className="text-sm font-bold text-slate-700">{t.title}</div>
                                            <div className="text-xs text-slate-400">{formatDate(t.scheduled_date)}</div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                            <div className="flex gap-2 justify-end pt-2">
                                <button onClick={createWithoutSuggestions} className="text-slate-400 hover:text-slate-600 text-sm font-bold px-3 py-2">Skip</button>
                                <button onClick={confirmSuggestions} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-700">
                                    Create & Assign ({preSelectionIds.size})
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // --- Active Sprint View ---
    return (
        <div className="w-full h-full flex flex-col overflow-hidden relative bg-slate-50/50">
            {/* Header Section */}
            <div className="flex-none bg-white/80 backdrop-blur border-b border-indigo-100 p-3 md:p-4 z-20">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4">
                    <div className="flex items-center gap-3 md:gap-4">
                        <MobileMenuButton />
                        <div>
                            <div className="flex items-baseline gap-2 md:gap-3">
                                <h1 className="text-xl md:text-2xl font-extrabold text-indigo-900 tracking-tight">{currentSprint.name}</h1>
                                <span className="text-[10px] md:text-xs font-medium text-indigo-400 px-1.5 py-0.5 bg-indigo-50 rounded-full border border-indigo-100">
                                    ACTIVE
                                </span>
                            </div>
                            <div className="text-[10px] md:text-xs text-slate-500 font-mono mt-0.5 md:mt-1">
                                {formatDate(currentSprint.startDate)} - {formatDate(currentSprint.endDate)}
                            </div>
                        </div>
                    </div>

                    {/* Goal Input - Always Visible */}
                    <div className="w-full md:flex-1 md:max-w-2xl md:mx-4">
                        <div className="relative group">
                            <textarea
                                value={goal}
                                onChange={(e) => setGoal(e.target.value)}
                                onBlur={handleSaveGoal}
                                placeholder="What is the goal of this sprint?"
                                className="w-full bg-indigo-50/50 hover:bg-white focus:bg-white border-2 border-transparent focus:border-indigo-200 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder-indigo-300 resize-none transition-all outline-none h-[50px] md:h-[60px]"
                            />
                            <div className="absolute top-2 right-2 text-[10px] text-indigo-300 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                                GOAL
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 cursor-pointer bg-white px-2 py-1.5 md:px-3 md:py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors">
                            <input
                                type="checkbox"
                                checked={showCompletedSprintTasks}
                                onChange={e => setShowCompletedSprintTasks(e.target.checked)}
                                className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5"
                            />
                            <span className="whitespace-nowrap">Show Done</span>
                        </label>
                        <div className="w-px h-6 bg-slate-300 mx-1 hidden md:block"></div>
                        <button
                            onClick={handleDeleteSprint}
                            className="text-slate-400 hover:text-red-600 px-2 py-2 rounded-lg transition-colors"
                            title="Delete Sprint"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                        <button
                            onClick={openAddModal}
                            className="bg-white text-indigo-600 hover:bg-indigo-50 border border-indigo-200 px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-bold shadow-sm transition-colors flex items-center gap-1 md:gap-2 whitespace-nowrap"
                        >
                            <span>📎</span> <span className="hidden sm:inline">Assign</span><span className="sm:hidden">Add</span>
                        </button>
                        <button
                            onClick={() => setShowCreateForm(!showCreateForm)}
                            className="bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg border border-transparent px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-bold shadow-md transition-colors flex items-center gap-1 md:gap-2 whitespace-nowrap"
                        >
                            <span>+</span> <span className="hidden sm:inline">Create Task</span><span className="sm:hidden">New</span>
                        </button>
                        <button
                            onClick={() => setShowRetroModal(true)}
                            className="bg-indigo-600 text-white hover:bg-indigo-700 px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-bold shadow-md hover:shadow-lg transition-all whitespace-nowrap"
                        >
                            Complete
                        </button>
                    </div>
                </div>
            </div>

            {/* Task List Section */}
            <div className="flex-1 overflow-y-auto p-2 md:p-8">
                <div className="max-w-5xl mx-auto">

                    {/* Creation Form */}
                    {showCreateForm && (
                        <form onSubmit={handleCreateTask} className="mb-6 bg-white p-4 rounded-xl shadow border border-indigo-100 flex flex-col gap-3 animate-in slide-in-from-top-2">
                            <div className="flex gap-3">
                                <input
                                    type="text"
                                    name="title"
                                    placeholder="What needs to be done in this sprint?"
                                    value={createFormTask.title}
                                    onChange={handleCreateTaskChange}
                                    autoFocus
                                    className="flex-1 bg-slate-50 border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder-slate-400 text-sm px-3 py-2"
                                />
                                <button
                                    type="submit"
                                    disabled={isCreatingTask || !createFormTask.title.trim()}
                                    className="bg-indigo-600 text-white rounded-lg px-6 py-2 text-sm font-bold shadow hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    Add
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-4 items-center">
                                {/* Category */}
                                <select
                                    name="category"
                                    value={createFormTask.category}
                                    onChange={handleCreateTaskChange}
                                    className="bg-slate-50 border-slate-200 rounded-lg text-xs py-1.5 px-2 focus:ring-indigo-500"
                                >
                                    <option value="Research">Research</option>
                                    <option value="Digital">Digital</option>
                                    <option value="English">English</option>
                                    <option value="Food">Food</option>
                                    <option value="Dog">Dog</option>
                                    <option value="Outing">Outing</option>
                                    <option value="Chores">Chores</option>
                                    <option value="Shopping">Shopping</option>
                                    <option value="Book">Book</option>
                                    <option value="Other">Other</option>
                                </select>

                                {/* Priority */}
                                <div className="flex bg-slate-100 rounded-lg p-1">
                                    {['High', 'Medium', 'Low'].map(p => (
                                        <button
                                            key={p}
                                            type="button"
                                            onClick={() => setCreateFormTask(prev => ({ ...prev, priority: p }))}
                                            className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${createFormTask.priority === p ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>

                                {/* Scheduled Date */}
                                <div className="flex items-center gap-2">
                                    <CustomDatePicker
                                        selected={createFormTask.scheduled_date}
                                        onChange={(date) => setCreateFormTask(prev => ({ ...prev, scheduled_date: date }))}
                                        placeholderText="Schedule"
                                        className="w-24 bg-slate-50 border-slate-200 rounded-lg text-xs py-1.5 px-2 text-center"
                                    />
                                </div>
                            </div>
                        </form>
                    )}

                    {sprintTasks.length === 0 ? (
                        <div className="text-center py-20 bg-white/50 rounded-2xl border-2 border-dashed border-slate-200">
                            <p className="text-slate-400 font-medium">No tasks in this sprint yet.</p>
                            <button onClick={openAddModal} className="mt-4 text-indigo-600 font-bold hover:underline">Add items from backlog</button>
                        </div>
                    ) : (
                        <ul className="grid gap-3">
                            {sprintTasks
                                .filter(t => showCompletedSprintTasks || t.status !== 'DONE')
                                .map(task => (
                                    <li
                                        key={task.id}
                                        onDragOver={(e) => onDragOver(e, task)}
                                        className={`bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md transition-shadow group ${task.status === 'DONE' ? 'opacity-60 bg-slate-50' : ''}`}
                                    >
                                        {/* Drag Handle */}
                                        <div
                                            draggable
                                            onDragStart={(e) => onDragStart(e, task)}
                                            onDragEnd={onDragEnd}
                                            className="text-slate-300 cursor-grab active:cursor-grabbing hover:text-indigo-400 p-1 -ml-2 select-none"
                                            title="Drag to reorder"
                                        >
                                            ⋮⋮
                                        </div>

                                        <div className={`w-1.5 self-stretch rounded-full ${task.status === 'DONE' ? 'bg-green-400' : 'bg-indigo-400'}`}></div>

                                        {/* Checkbox for Done */}
                                        <div
                                            onClick={() => handleToggleTaskStatus(task)}
                                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all flex-shrink-0
                                            ${task.status === 'DONE' ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 hover:border-indigo-400'}
                                        `}
                                        >
                                            {task.status === 'DONE' && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className={`font-bold text-slate-800 ${task.status === 'DONE' ? 'line-through text-slate-400' : ''}`}>
                                                {task.title}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1">
                                                <span className="px-2 py-0.5 bg-slate-100 rounded">{task.category}</span>
                                                <span className={`px-2 py-0.5 rounded ${task.priority === 'High' ? 'bg-red-50 text-red-600' : 'bg-slate-50'}`}>{task.priority}</span>
                                                {task.scheduled_date && (
                                                    <span className="text-indigo-600 flex items-center gap-1 font-medium bg-indigo-50 px-2 py-0.5 rounded">
                                                        📅 {formatDate(task.scheduled_date)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveTask(task.id)}
                                            className="text-slate-400 hover:text-indigo-600 p-2 transition-colors"
                                            title="Reschedule / Remove from Sprint"
                                        >
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                            </svg>
                                        </button>
                                    </li>
                                ))}
                        </ul>
                    )}
                </div>
            </div>

            {/* Retro Modal */}
            {showRetroModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="p-6 bg-indigo-50 border-b border-indigo-100">
                            <h2 className="text-xl font-extrabold text-indigo-900">Sprint Retrospective</h2>
                            <p className="text-indigo-600/80 text-sm mt-1">Reflect on "{currentSprint.name}"</p>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Thoughts / Retro</label>
                                <textarea
                                    value={retroText}
                                    onChange={e => setRetroText(e.target.value)}
                                    className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                                    placeholder="What went well? What didn't?"
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowRetroModal(false)}
                                    className="flex-1 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCompleteSprint}
                                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow-lg hover:shadow-indigo-500/30 transition-all"
                                >
                                    Complete Sprint
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Reschedule Modal */}
            {rescheduleModalOpen && taskToReschedule && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-60 flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="p-6 bg-slate-50 border-b border-slate-100">
                            <h3 className="text-lg font-bold text-slate-800">Remove & Reschedule</h3>
                            <p className="text-sm text-slate-500 mt-1">Task: <strong>{taskToReschedule.title}</strong></p>
                        </div>
                        <div className="p-6 space-y-6">
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-xs font-bold text-slate-500 uppercase">New Scheduled Date</label>
                                    <button
                                        onClick={() => setRescheduleDate(null)}
                                        className={`text-xs font-bold px-2 py-1 rounded transition-colors ${!rescheduleDate ? 'bg-indigo-100 text-indigo-700' : 'text-slate-400 hover:bg-slate-100'}`}
                                    >
                                        Clear / Unschedule
                                    </button>
                                </div>
                                <div className={`transition-all duration-200 ${!rescheduleDate ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
                                    <CustomDatePicker
                                        selected={rescheduleDate}
                                        onChange={date => setRescheduleDate(date)}
                                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                                        placeholderText="Select date"
                                        inline
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={() => executeRemoveTask(taskToReschedule.id, { date: rescheduleDate })}
                                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                                >
                                    {rescheduleDate ? (
                                        <><span>📅</span> Change Date & Remove</>
                                    ) : (
                                        <><span>🗑️</span> Remove & Clear Date</>
                                    )}
                                </button>
                                <button
                                    onClick={() => setRescheduleModalOpen(false)}
                                    className="w-full py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Backlog Selection Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col animate-in fade-in zoom-in duration-200">
                        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-slate-800">Select Tasks from Backlog</h2>
                            <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2">
                            {backlogTasks.length === 0 ? (
                                <div className="text-center p-10 text-slate-400">No available tasks in backlog.</div>
                            ) : (
                                <ul className="space-y-1">
                                    {backlogTasks.map(task => {
                                        const isSelected = selectedTaskIds.has(task.id);
                                        return (
                                            <li
                                                key={task.id}
                                                onClick={() => toggleSelection(task.id)}
                                                className={`p-3 rounded-lg border cursor-pointer flex items-center gap-3 transition-colors ${isSelected ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-100 hover:border-indigo-200'}`}
                                            >
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white'}`}>
                                                    {isSelected && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                                </div>
                                                <div className="flex-1">
                                                    <div className="font-medium text-slate-800 text-sm">{task.title}</div>
                                                    <div className="text-xs text-slate-500 flex gap-2 mt-0.5">
                                                        <span>{task.category}</span>
                                                        <span>{task.priority}</span>
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="px-4 py-2 text-slate-500 font-bold hover:text-slate-700"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddTasks}
                                disabled={selectedTaskIds.size === 0}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg shadow disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Add {selectedTaskIds.size} Tasks
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
