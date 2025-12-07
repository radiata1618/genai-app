"use client";

import React from 'react';

const PRIORITY_COLORS = {
    1: 'bg-green-100 text-green-800 border-green-200',
    3: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    5: 'bg-red-100 text-red-800 border-red-200',
};

const TaskCard = ({ task, onArchive, onPick }) => {
    const effortColor = PRIORITY_COLORS[task.estimated_effort] || 'bg-gray-100 text-gray-800 border-gray-200';

    return (
        <div
            className="group relative bg-white/80 backdrop-blur-sm border border-white/20 shadow-sm hover:shadow-md transition-all rounded-xl p-4 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-200"
        >
            <div className="flex justify-between items-start">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                    {task.category}
                </span>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onArchive(task.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded-full"
                    title="Archive"
                >
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>

            <h3 className="font-semibold text-gray-800 leading-tight">
                {task.title}
            </h3>

            <div className="flex items-center gap-2 mt-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${effortColor}`}>
                    Effort: {task.estimated_effort}
                </span>
                <span className="text-[10px] text-gray-400 ml-auto">
                    {new Date(task.created_at).toLocaleDateString()}
                </span>
            </div>
        </div>
    );
};

export default TaskCard;
