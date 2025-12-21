"use client";

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { getRoutines, addRoutine } from '../actions/routines';

export default function RoutinesPage() {
    const [routines, setRoutines] = useState([]);
    const [loading, setLoading] = useState(true);

    // Form State
    const [title, setTitle] = useState('');
    const [type, setType] = useState('ACTION');
    const [cron, setCron] = useState('0 9 * * *');
    const [icon, setIcon] = useState('💪');

    const fetchRoutines = async () => {
        try {
            const data = await getRoutines();
            setRoutines(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRoutines();
    }, []);

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        try {
            await addRoutine({
                title,
                routine_type: type,
                icon,
                frequency: { type: 'DAILY', weekdays: [], month_days: [] }
            });
            setTitle('');
            await fetchRoutines();
        } catch (e) {
            alert('Failed to create routine');
        }
    };

    const handleGenerateTest = async () => {
        try {
            const res = await api.generateDailyTasks();
            alert(res.message);
        } catch (e) {
            alert('Generation failed');
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 p-8 font-sans">
            <div className="max-w-4xl mx-auto space-y-8">

                <div className="flex justify-between items-center">
                    <h1 className="text-3xl font-bold text-slate-800">Habit Factory</h1>
                    <button
                        onClick={handleGenerateTest}
                        className="text-sm bg-indigo-100 text-indigo-700 px-3 py-1 rounded hover:bg-indigo-200 transition"
                    >
                        Run Factory (Test)
                    </button>
                </div>

                {/* Creator */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="text-lg font-semibold mb-4 text-slate-700">New Routine / Rule</h3>
                    <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="col-span-2 md:col-span-1">
                            <label className="block text-xs text-slate-500 mb-1">Title</label>
                            <input
                                className="w-full border-slate-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                                value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Read 10 pages"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">Type</label>
                            <select
                                className="w-full border-slate-300 rounded-md shadow-sm"
                                value={type} onChange={e => setType(e.target.value)}
                            >
                                <option value="ACTION">Action (Create Task)</option>
                                <option value="MINDSET">Mindset (Permanent Display)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-500 mb-1">Icon</label>
                            <input
                                className="w-full border-slate-300 rounded-md shadow-sm"
                                value={icon} onChange={e => setIcon(e.target.value)} placeholder="Emoji"
                            />
                        </div>
                        <div className="col-span-2 flex justify-end">
                            <button className="bg-slate-800 text-white px-6 py-2 rounded-lg font-medium hover:bg-slate-700">
                                Create Pattern
                            </button>
                        </div>
                    </form>
                </div>

                {/* List */}
                <div className="space-y-4">
                    {routines.map(r => (
                        <div key={r.id} className="flex items-center gap-4 bg-white p-4 rounded-lg shadow-sm border border-slate-100">
                            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-xl">
                                {r.icon || '📌'}
                            </div>
                            <div className="flex-1">
                                <h4 className="font-semibold text-slate-800">{r.title}</h4>
                                <p className="text-xs text-slate-400">{r.routine_type} • {r.frequency_cron}</p>
                            </div>
                        </div>
                    ))}
                </div>

            </div>
        </div>
    );
}
