"use client";

import React, { useState } from 'react';
import Sidebar from './Sidebar';

export default function ClientLayout({ children }) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    return (
        <div className="flex h-screen bg-gray-50 overflow-hidden">
            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar Wrapper */}
            <div className={`
                fixed inset-y-0 left-0 z-50 w-52 bg-[#0e7490] shadow-xl transform transition-transform duration-300 ease-in-out
                md:relative md:translate-x-0
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <Sidebar onCloseMobile={() => setIsSidebarOpen(false)} />
            </div>

            {/* Main Content Wrapper */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Mobile Header */}
                <header className="md:hidden flex items-center p-4 bg-white border-b border-gray-200 flex-none z-30">
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        className="p-2 -ml-2 rounded-md text-gray-600 hover:bg-gray-100"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                    <span className="ml-3 font-bold text-gray-800">GenAI App</span>
                </header>

                {/* Main Content Area - Full dimensions for app-like pages */}
                <main className="flex-1 relative h-full w-full overflow-hidden bg-slate-50">
                    {children}
                </main>
            </div>
        </div>
    );
}
