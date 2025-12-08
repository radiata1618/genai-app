"use client";

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

export default function MindsetsPage() {
    const [mindsets, setMindsets] = useState([]);
    const [loading, setLoading] = useState(true);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);

    // Form State
    const [title, setTitle] = useState('');
    const [icon, setIcon] = useState('🧠');

    // Drag State
    const [draggedItem, setDraggedItem] = useState(null);

    const fetchMindsets = async () => {
        try {
            const data = await api.getRoutines('MINDSET');
            const sorted = data.sort((a, b) => (a.order || 0) - (b.order || 0));
            setMindsets(sorted);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMindsets();
    }, []);

    const openCreateModal = () => {
        setEditingId(null);
        setTitle('');
        setIcon('🧠');
        setIsModalOpen(true);
    };

    const openEditModal = (m) => {
        setEditingId(m.id);
        setTitle(m.title);
        setIcon(m.icon || '🧠');
        setIsModalOpen(true);
    };

    const handleSave = async (e) => {
        if (e) e.preventDefault();
        if (!title) return;
        try {
            if (editingId) {
                await api.updateRoutine(editingId, title, 'MINDSET', null, icon);
            } else {
                await api.addRoutine(title, 'MINDSET', null, icon);
            }
            setIsModalOpen(false);
            fetchMindsets();
        } catch (e) {
            alert('Failed to save mindset');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this rule?')) return;
        try {
            await api.deleteRoutine(id);
            fetchMindsets();
        } catch (e) {
            alert('Failed to delete mindset');
        }
    };

    // Drag & Drop Handlers
    const onDragStart = (e, index) => {
        setDraggedItem(mindsets[index]);
        e.dataTransfer.effectAllowed = 'move';
    };

    const onDragOver = (e, index) => {
        e.preventDefault();
        const draggedOverItem = mindsets[index];

        if (draggedItem === draggedOverItem) {
            return;
        }

        let items = mindsets.filter(item => item !== draggedItem);
        items.splice(index, 0, draggedItem);
        setMindsets(items);
    };

    const onDragEnd = async () => {
        setDraggedItem(null);
        const ids = mindsets.map(m => m.id);
        try {
            await api.reorderRoutines(ids);
        } catch (e) {
            console.error("Failed to reorder", e);
            fetchMindsets();
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-4 font-sans text-slate-900">
            <div className="max-w-4xl mx-auto space-y-4">

                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-xl font-black text-slate-800">Mindsets & Rules</h1>
                        <p className="text-xs text-slate-500">Principles to keep in mind every day.</p>
                    </div>
                    <button onClick={openCreateModal} className="bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-slate-800 transition-colors flex items-center gap-1.5 shadow-sm text-sm">
                        <span className="text-base leading-none">+</span> New Rule
                    </button>
                </div>

                {/* List */}
                <div className="space-y-1.5">
                    {loading ? (
                        <div className="text-center text-slate-400 py-8 text-sm">Loading mindsets...</div>
                    ) : mindsets.length === 0 ? (
                        <div className="text-slate-400 italic text-center py-12 bg-white rounded-xl border border-slate-200 text-sm">
                            No mindsets defined yet.
                        </div>
                    ) : (
                        mindsets.map((m, index) => (
                            <div
                                key={m.id}
                                draggable
                                onDragStart={(e) => onDragStart(e, index)}
                                onDragOver={(e) => onDragOver(e, index)}
                                onDragEnd={onDragEnd}
                                className="group bg-white border border-slate-200 p-2.5 rounded-lg shadow-sm flex items-center justify-between hover:shadow-md transition-all cursor-move"
                                style={{ opacity: draggedItem === m ? 0.5 : 1 }}
                            >
                                <div className="flex items-center gap-3">
                                    {/* Drag Handle */}
                                    <div className="text-slate-300 cursor-grab active:cursor-grabbing p-1 hover:text-slate-500 transition-colors" title="Drag to reorder">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16" /></svg>
                                    </div>

                                    <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-md flex items-center justify-center text-lg font-bold">
                                        {m.icon || '🧠'}
                                    </div>
                                    <span className="font-bold text-slate-700 text-sm">{m.title}</span>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => openEditModal(m)}
                                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                        title="Edit"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                    </button>
                                    <button
                                        onClick={() => handleDelete(m.id)}
                                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                        title="Delete"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Edit/Create Modal */}
                {isModalOpen && (
                    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                <h2 className="font-bold text-slate-800 text-lg">{editingId ? 'Edit Mindset' : 'New Mindset'}</h2>
                                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Title</label>
                                    <input
                                        value={title} onChange={e => setTitle(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleSave(e)}
                                        className="w-full mt-1 p-3 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-700"
                                        placeholder="e.g. Always be kind"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Icon</label>
                                    <input
                                        value={icon} onChange={e => setIcon(e.target.value)}
                                        className="w-full mt-1 p-3 border border-slate-200 rounded-xl bg-slate-50 text-center text-xl focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                                    />
                                </div>
                            </div>
                            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
                                <button onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700">Cancel</button>
                                <button onClick={handleSave} disabled={!title} className="px-6 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all">
                                    {editingId ? 'Save Changes' : 'Create Rule'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
