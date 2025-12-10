"use client";
import React from 'react';
import { useSidebar } from './SidebarContext';

export default function MobileMenuButton({ className = "" }) {
    const { toggleSidebar } = useSidebar();

    return (
        <button
            onClick={toggleSidebar}
            className={`md:hidden p-2 -ml-2 rounded-md text-gray-600 hover:bg-gray-100 ${className}`}
            title="Menu"
        >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
        </button>
    );
}
