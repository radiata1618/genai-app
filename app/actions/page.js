"use client";

import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ActionsPage() {
    const [routines, setRoutines] = useState([]);

    // Form State
    const [title, setTitle] = useState('');
    const [icon, setIcon] = useState('🔥');

    // Frequency State
    const [freqType, setFreqType] = useState('DAILY'); // DAILY, WEEKLY, MONTHLY
    const [selectedWeekdays, setSelectedWeekdays] = useState([]); // 0-6
    const [selectedMonthDays, setSelectedMonthDays] = useState([]); // 1-31

    const [loading, setLoading] = useState(true);

    const fetchRoutines = async () => {
        try {
            const data = await api.getRoutines('ACTION');
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

    const handleCreate = async (e) => {
        e.preventDefault();
        try {
            const frequency = {
                type: freqType,
                weekdays: freqType === 'WEEKLY' ? selectedWeekdays : [],
                month_days: freqType === 'MONTHLY' ? selectedMonthDays : []
            };

            await api.addRoutine(title, 'ACTION', frequency, icon);
            setTitle('');
            // Reset filters
            setFreqType('DAILY');
            setSelectedWeekdays([]);
            setSelectedMonthDays([]);
            fetchRoutines();
        } catch (e) {
            alert('Failed to create action');
        }
    };

    const handleRunFactory = async () => {
        if (confirm('Generate tasks for today based on these actions?')) {
            const res = await api.generateDailyTasks();
            alert(res.message);
        }
    }

    return (
        <div className="min-h-screen bg-slate-50 p-8 font-sans">
            <div className="max-w-4xl mx-auto space-y-8">

                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-black text-slate-800">Actions & Habits</h1>
                        <p className="text-slate-500">Define what you want to do repeatedly.</p>
                    </div>
                    <button onClick={handleRunFactory} className="bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-200">
                        Run Factory (Test)
                    </button>
                </div>

                {/* Creator Card */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
                    <h2 className="font-bold text-slate-700">New Action</h2>

                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className="text-xs font-bold text-slate-400">Title</label>
                            <input
                                value={title} onChange={e => setTitle(e.target.value)}
                                className="w-full mt-1 p-2 border rounded-lg bg-slate-50 focus:bg-white transition-colors"
                                placeholder="e.g. Go to Gym"
                            />
                        </div>
                        <div className="w-20">
                            <label className="text-xs font-bold text-slate-400">Icon</label>
                            <input
                                value={icon} onChange={e => setIcon(e.target.value)}
                                className="w-full mt-1 p-2 border rounded-lg bg-slate-50 text-center"
                            />
                        </div>
                    </div>

                    {/* Frequency Selector */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 block mb-2">Frequency</label>
                        <div className="flex gap-2 mb-4 bg-slate-100 p-1 rounded-lg w-fit">
                            {['DAILY', 'WEEKLY', 'MONTHLY'].map(t => (
                                <button
                                    key={t}
                                    onClick={() => setFreqType(t)}
                                    className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${freqType === t ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
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
                                        className={`w-10 h-10 rounded-full text-xs font-bold border-2 transition-all
                                            ${selectedWeekdays.includes(idx)
                                                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                                : 'border-slate-200 text-slate-400 hover:border-slate-300'}
                                        `}
                                    >
                                        {day}
                                    </button>
                                ))}
                            </div>
                        )}

                        {freqType === 'MONTHLY' && (
                            <div className="grid grid-cols-7 gap-2 max-w-sm">
                                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                    <button
                                        key={day}
                                        onClick={() => toggleMonthDay(day)}
                                        className={`w-8 h-8 rounded text-xs font-bold transition-all
                                            ${selectedMonthDays.includes(day)
                                                ? 'bg-indigo-500 text-white'
                                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}
                                        `}
                                    >
                                        {day}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={handleCreate}
                        disabled={!title}
                        className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold hover:opacity-90 disabled:opacity-50"
                    >
                        Create Action
                    </button>
                </div>

                {/* List */}
                <div className="space-y-3">
                    {routines.map(r => (
                        <div key={r.id} className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <span className="text-2xl bg-slate-50 w-12 h-12 flex items-center justify-center rounded-full">{r.icon}</span>
                                <div>
                                    <h3 className="font-bold text-slate-800">{r.title}</h3>
                                    <div className="text-xs text-slate-400 flex gap-2">
                                        <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded uppercase font-bold tracking-wider text-[10px]">
                                            {r.frequency?.type || 'DAILY'}
                                        </span>
                                        {r.frequency?.type === 'WEEKLY' && <span>{r.frequency.weekdays.map(d => WEEKDAYS[d]).join(', ')}</span>}
                                        {r.frequency?.type === 'MONTHLY' && <span>Days: {r.frequency.month_days.join(', ')}</span>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

            </div>
        </div>
    );
}
