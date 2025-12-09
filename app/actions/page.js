"use client";

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ActionsPage() {
    const [routines, setRoutines] = useState([]);
    const [loading, setLoading] = useState(true);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);

    // Form State
    const [title, setTitle] = useState('');
    const [icon, setIcon] = useState('🔥');
    const [freqType, setFreqType] = useState('DAILY'); // DAILY, WEEKLY, MONTHLY
    const [selectedWeekdays, setSelectedWeekdays] = useState([]); // 0-6

    const [selectedMonthDays, setSelectedMonthDays] = useState([]); // 1-31
    const [scheduledTime, setScheduledTime] = useState('05:00');

    // Drag State
    const [draggedItem, setDraggedItem] = useState(null);

    const fetchRoutines = async () => {
        try {
            const data = await api.getRoutines('ACTION');
            // Ensure they are sorted by 'order'
            const sorted = data.sort((a, b) => (a.order || 0) - (b.order || 0));
            setRoutines(sorted);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRoutines();
    }, []);

    const openCreateModal = () => {
        setEditingId(null);
        setTitle('');
        setIcon('🔥');
        setFreqType('DAILY');
        setSelectedWeekdays([]);
        setSelectedMonthDays([]);
        setScheduledTime('05:00');
        setIsModalOpen(true);
    };

    const openEditModal = (r) => {
        setEditingId(r.id);
        setTitle(r.title);
        setIcon(r.icon || '🔥');
        setFreqType(r.frequency?.type || 'DAILY');
        setSelectedWeekdays(r.frequency?.weekdays || []);
        setSelectedMonthDays(r.frequency?.month_days || []);
        setScheduledTime(r.scheduled_time || '05:00');
        setIsModalOpen(true);
    };

    const toggleWeekday = (idx) => {
        if (selectedWeekdays.includes(idx)) {
            setSelectedWeekdays(selectedWeekdays.filter(i => i !== idx));
        } else {
            setSelectedWeekdays([...selectedWeekdays, idx]);
        }
    };

    const toggleMonthDay = (day) => {
        if (selectedMonthDays.includes(day)) {
            setSelectedMonthDays(selectedMonthDays.filter(d => d !== day));
        } else {
            setSelectedMonthDays([...selectedMonthDays, day]);
        }
    };

    const handleSave = async (e) => {
        if (e) e.preventDefault();
        try {
            const frequency = {
                type: freqType,
                weekdays: freqType === 'WEEKLY' ? selectedWeekdays : [],
                month_days: freqType === 'MONTHLY' ? selectedMonthDays : []
            };

            if (editingId) {
                await api.updateRoutine(editingId, title, 'ACTION', frequency, icon, scheduledTime);
            } else {
                await api.addRoutine(title, 'ACTION', frequency, icon, scheduledTime);
            }

            setIsModalOpen(false);
            fetchRoutines();
        } catch (e) {
            alert('Failed to save action');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this action?')) return;
        try {
            await api.deleteRoutine(id);
            fetchRoutines();
        } catch (e) {
            alert('Failed to delete action');
        }
    };

    const handleRunFactory = async () => {
        if (confirm('Generate tasks for today based on these actions?')) {
            const res = await api.generateDailyTasks();
            alert(res.message);
        }
    };

    // Drag & Drop Handlers
    const onDragStart = (e, index) => {
        setDraggedItem(routines[index]);
        e.dataTransfer.effectAllowed = 'move';
        // HTML5 defaults are usually enough
    };

    const onDragOver = (e, index) => {
        e.preventDefault();
        const draggedOverItem = routines[index];

        if (draggedItem === draggedOverItem) {
            return;
        }

        let items = routines.filter(item => item !== draggedItem);
        items.splice(index, 0, draggedItem);
        setRoutines(items);
    }

    const onDragEnd = async () => {
        setDraggedItem(null);
        const ids = routines.map(r => r.id);
        try {
            await api.reorderRoutines(ids);
        } catch (e) {
            console.error("Failed to reorder", e);
            fetchRoutines();
        }
    };

    return (
        <div className="fixed inset-0 left-64 bg-slate-50 font-sans text-slate-900 flex flex-col z-0 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden max-w-5xl mx-auto w-full p-4">

                {/* Header */}
                <div className="flex-none flex justify-between items-center mb-3">
                    <div>
                        <h1 className="text-xl font-black text-slate-800 tracking-tight">Actions & Habits</h1>
                        <p className="text-xs text-slate-500">Manage your daily system</p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleRunFactory} className="bg-white border border-slate-200 text-slate-600 px-2 py-1 rounded-md text-[10px] font-bold hover:bg-slate-50 transition-colors">
                            Run Logic
                        </button>
                        <button onClick={openCreateModal} className="bg-slate-900 text-white px-3 py-1 rounded-md text-xs font-bold hover:bg-slate-800 transition-colors flex items-center gap-1 shadow-sm">
                            <span className="text-sm leading-none">+</span> New
                        </button>
                    </div>
                </div>

                {/* Compact List */}
                <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                    {loading ? (
                        <div className="p-8 text-center text-slate-400 text-sm">Loading actions...</div>
                    ) : routines.length === 0 ? (
                        <div className="p-12 text-center text-slate-400 flex-1 flex flex-col items-center justify-center">
                            <div className="text-4xl mb-2">🌱</div>
                            <p className="font-medium">No actions yet.</p>
                            <button onClick={openCreateModal} className="text-indigo-600 font-bold text-sm mt-2 hover:underline">Create your first one</button>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto">
                            <div className="divide-y divide-slate-100">
                                {routines.map((r, index) => (
                                    <div
                                        key={r.id}
                                        draggable
                                        onDragStart={(e) => onDragStart(e, index)}
                                        onDragOver={(e) => onDragOver(e, index)}
                                        onDragEnd={onDragEnd}
                                        className="group flex items-center justify-between p-1.5 hover:bg-slate-50 transition-colors cursor-move"
                                        style={{ opacity: draggedItem === r ? 0.5 : 1 }}
                                    >
                                        <div className="flex items-center gap-2">
                                            {/* Drag Handle - Improved Visibility */}
                                            <div className="text-slate-300 cursor-grab active:cursor-grabbing p-1 hover:bg-slate-100 rounded transition-colors flex flex-col justify-center items-center h-6 w-4" title="Drag to reorder">
                                                {/* 6 dots icon for robust drag handle look */}
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

                                            <div className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-lg shadow-inner select-none">
                                                {r.icon}
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-700 text-sm select-none leading-none">{r.title}</h3>
                                                <div className="flex items-center gap-2 text-[9px] text-slate-400 font-mono mt-0.5 select-none">
                                                    <span className={`px-1 py-px rounded ${r.frequency?.type === 'DAILY' ? 'bg-green-100 text-green-700' : 'bg-indigo-50 text-indigo-600'}`}>
                                                        {r.frequency?.type || 'DAILY'}
                                                    </span>
                                                    {r.frequency?.type === 'WEEKLY' && <span>{r.frequency.weekdays.map(d => WEEKDAYS[d]).join(', ')}</span>}

                                                    {r.frequency?.type === 'MONTHLY' && <span>Days: {r.frequency.month_days.join(', ')}</span>}
                                                    <span className="text-slate-300">|</span>
                                                    <span>{r.scheduled_time || '05:00'}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => openEditModal(r)}
                                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                                title="Edit"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                            </button>
                                            <button
                                                onClick={() => handleDelete(r.id)}
                                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                title="Delete"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Modal Overlay */}
                {isModalOpen && (
                    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                <h2 className="font-bold text-slate-800 text-lg">{editingId ? 'Edit Action' : 'New Action'}</h2>
                                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>

                            <div className="p-6 space-y-6">
                                <div className="flex gap-4">
                                    <div className="flex-1 space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Title</label>
                                        <input
                                            value={title} onChange={e => setTitle(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleSave(e)}
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700"
                                            placeholder="e.g. Read a book"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="w-20 space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Icon</label>
                                        <input
                                            value={icon} onChange={e => setIcon(e.target.value)}
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 text-center text-lg outline-none focus:border-indigo-500 transition-all font-medium"
                                        />
                                    </div>
                                    <div className="w-28 space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Time</label>
                                        <input
                                            type="time"
                                            value={scheduledTime}
                                            onChange={e => setScheduledTime(e.target.value)}
                                            className="w-full p-3 border border-slate-200 rounded-xl bg-slate-50 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all text-center"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Frequency</label>
                                    <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                                        {['DAILY', 'WEEKLY', 'MONTHLY'].map(t => (
                                            <button
                                                key={t}
                                                onClick={() => setFreqType(t)}
                                                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${freqType === t ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
                                            >
                                                {t}
                                            </button>
                                        ))}
                                    </div>

                                    {freqType === 'WEEKLY' && (
                                        <div className="flex gap-2 flex-wrap">
                                            {WEEKDAYS.map((day, idx) => (
                                                <button
                                                    key={day}
                                                    onClick={() => toggleWeekday(idx)}
                                                    className={`w-10 h-10 rounded-xl text-xs font-bold border transition-all flex items-center justify-center
                                                        ${selectedWeekdays.includes(idx)
                                                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm'
                                                            : 'border-slate-200 text-slate-400 hover:border-slate-300 bg-white'}
                                                    `}
                                                >
                                                    {day}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {freqType === 'MONTHLY' && (
                                        <div className="grid grid-cols-7 gap-1.5 pt-2">
                                            {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                                <button
                                                    key={day}
                                                    onClick={() => toggleMonthDay(day)}
                                                    className={`w-9 h-9 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center
                                                        ${selectedMonthDays.includes(day)
                                                            ? 'bg-indigo-500 text-white shadow-sm'
                                                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}
                                                    `}
                                                >
                                                    {day}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">Cancel</button>
                                <button onClick={handleSave} disabled={!title} className="px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-xl hover:bg-indigo-700 shadow-md transform active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                                    {editingId ? 'Save Changes' : 'Create Action'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
