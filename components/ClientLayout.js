"use client";

import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import { SidebarProvider, useSidebar } from './SidebarContext';

function ClientLayoutContent({ children }) {
    const { isSidebarOpen, closeSidebar } = useSidebar();


    return (
        <div className="flex h-screen bg-gray-50 overflow-hidden">
            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={closeSidebar}
                />
            )}

            {/* Sidebar Wrapper */}
            <div className={`
                fixed inset-y-0 left-0 z-50 w-52 bg-[#0e7490] shadow-xl transform transition-transform duration-300 ease-in-out
                md:relative md:translate-x-0
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <Sidebar onCloseMobile={closeSidebar} />
            </div>

            {/* Main Content Wrapper */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Main Content Area - Full dimensions for app-like pages */}
                <main className="flex-1 relative h-full w-full overflow-hidden bg-slate-50">
                    {children}
                </main>
            </div>
        </div>
    );
}

export default function ClientLayout({ children }) {
    return (
        <SidebarProvider>
            <ClientLayoutContent>{children}</ClientLayoutContent>
        </SidebarProvider>
    );
}
