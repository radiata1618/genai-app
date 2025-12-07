"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Navigation Items Configuration
const navItems = [
    {
        category: "AI PoC",
        items: [
            { name: "Multimodalテスト", icon: "📝", href: "/" },
            { name: "ファイル管理", icon: "📂", href: "/files" },
        ],
    },
    {
        category: "タスク管理",
        items: [
            { name: "Today's Focus", icon: "☀️", href: "/dashboard" },
            { name: "Stock (Backlog)", icon: "📦", href: "/backlog" },
            { name: "Actions (Habits)", icon: "🔥", href: "/actions" },
            { name: "Mindsets (Rules)", icon: "🧠", href: "/mindsets" },
        ],
    },
];

export default function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className="w-64 bg-[#0e7490] text-white flex flex-col h-screen fixed left-0 top-0 shadow-xl z-50 font-sans">
            {/* Logo Area */}
            <div className="h-16 flex items-center px-6 bg-[#0891b2] shadow-sm">
                <h1 className="text-xl font-bold tracking-widest uppercase">Genai-app</h1>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-6">
                {navItems.map((section, idx) => (
                    <div key={idx} className="mb-6">
                        <h3 className="px-6 text-xs font-semibold text-cyan-200 mb-2 uppercase tracking-wider">
                            {section.category}
                        </h3>
                        <ul>
                            {section.items.map((item, itemIdx) => {
                                const isActive = pathname === item.href;
                                return (
                                    <li key={itemIdx}>
                                        <Link
                                            href={item.href}
                                            className={`flex items-center px-6 py-3 text-sm font-medium transition-colors duration-200
                        ${isActive
                                                    ? "bg-[#155e75] border-l-4 border-cyan-300 text-white"
                                                    : "text-cyan-100 hover:bg-[#0891b2] hover:text-white"
                                                }
                      `}
                                        >
                                            <span className="mr-3 text-lg opacity-80">{item.icon}</span>
                                            {item.name}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>
        </aside>
    );
}
