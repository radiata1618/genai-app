"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Navigation Items Configuration
const navItems = [
    {
        category: "タスク管理",
        items: [
            { name: "Today's Focus", icon: "☀️", href: "/dashboard" },
            { name: "Stock (Backlog)", icon: "📦", href: "/backlog" },
            { name: "Actions (Habits)", icon: "🔥", href: "/actions" },
            { name: "Mindsets (Rules)", icon: "🧠", href: "/mindsets" },
            { name: "Projects", icon: "🚀", href: "/projects" },
        ],
    },
    {
        category: "Car Quiz",
        items: [
            { name: "Admin Dashboard", icon: "🛠️", href: "/car-quiz/admin" },
            { name: "Play Quiz", icon: "🚗", href: "/car-quiz" },
        ],
    },
    {
        category: "AI PoC",
        items: [
            { name: "Multimodalテスト", icon: "📝", href: "/multimodal" },
            { name: "ファイル管理", icon: "📂", href: "/files" },
        ],
    },
    {
        category: "English",
        items: [
            { name: "Preparation", icon: "📚", href: "/english/preparation" },
            { name: "Review", icon: "📹", href: "/english/review" },
            { name: "YouTube Prep", icon: "📺", href: "/english/youtube-prep" },
        ],
    },
    {
        category: "Consulting Support",
        items: [
            { name: "Logic Mapper", icon: "🧠", href: "/consulting/logic-mapper" },
            { name: "Visual Search", icon: "👁️", href: "/consulting/visual-search" },
            { name: "Slide Polisher", icon: "✨", href: "/consulting/slide-polisher" },
            { name: "Admin (Data)", icon: "⚙️", href: "/consulting/data" },
        ],
    },
];

export default function Sidebar({ onCloseMobile }) {
    const pathname = usePathname();

    return (
        <aside className="w-52 bg-[#0e7490] text-white flex flex-col h-full font-sans">
            {/* Logo Area */}
            <div className="h-14 flex items-center px-4 bg-[#0891b2] shadow-sm flex-shrink-0">
                <h1 className="text-xl font-bold tracking-widest uppercase">Genai-app</h1>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-4">
                {navItems.map((section, idx) => (
                    <div key={idx} className="mb-3">
                        <h3 className="px-4 text-xs font-semibold text-cyan-200 mb-2 uppercase tracking-wider">
                            {section.category}
                        </h3>
                        <ul>
                            {section.items.map((item, itemIdx) => {
                                const isActive = pathname === item.href;
                                return (
                                    <li key={itemIdx}>
                                        <Link
                                            href={item.href}
                                            onClick={onCloseMobile}
                                            className={`flex items-center px-4 py-2 text-sm font-medium transition-colors duration-200 whitespace-nowrap
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
