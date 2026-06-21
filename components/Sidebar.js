"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Navigation Items Configuration (Exported for settings page)
export const navItems = [
    {
        category: "AI Chat",
        items: [
            { name: "AI Chat", icon: "✨", href: "/ai-chat" },
            { name: "Settings", icon: "⚙️", href: "/ai-chat/settings" },
        ],
    },
    {
        category: "タスク管理",
        items: [
            { name: "Today's Focus", icon: "☀️", href: "/dashboard" },
            { name: "Sprint", icon: "🏃", href: "/sprint" },
            { name: "Stock (Backlog)", icon: "📦", href: "/backlog" },
            { name: "Actions (Habits)", icon: "🔥", href: "/actions" },
            { name: "Mindsets (Rules)", icon: "🧠", href: "/mindsets" },
            { name: "Projects", icon: "🚀", href: "/projects" },
            { name: "Recipe", icon: "🍳", href: "/recipes" },
        ],
    },
    {
        category: "DAB",
        items: [
            { name: "Feed", icon: "📰", href: "/dab?tab=feed" },
            { name: "Experts", icon: "✨", href: "/dab?tab=experts" },
            { name: "Topics", icon: "🔥", href: "/dab?tab=topics" },
            { name: "Core Memory", icon: "🧠", href: "/dab?tab=memory" },
            { name: "Settings", icon: "⚙️", href: "/dab?tab=settings" },
        ],
    },
    {
        category: "MTG Training",
        items: [
            { name: "MTG Training", icon: "🏋️", href: "/consulting/training" },
            { name: "Live Train(Browser)", icon: "🎙️", href: "/consulting/training/live-browser" },
            { name: "Live Train(Gemini)", icon: "🧠", href: "/consulting/training/live-gemini" },
        ],
    },
    {
        category: "English",
        items: [
            { name: "Preparation", icon: "📚", href: "/english/preparation" },
            { name: "Review", icon: "📹", href: "/english/review" },
            { name: "YouTube Prep", icon: "📺", href: "/english/youtube-prep" },
            { name: "Phrases", icon: "💬", href: "/english/phrases" },
            { name: "Roleplay (Live)", icon: "🎙️", href: "/english/roleplay" },
        ],
    },
    {
        category: "Hobbies",
        items: [
            { name: "Photos", icon: "📸", href: "/hobbies/photos" },
            { name: "Financial Assets", icon: "💰", href: "/hobbies/finance" },
        ],
    },
    {
        category: "Consulting Support",
        items: [
            { name: "Logic Mapper", icon: "🧠", href: "/consulting/logic-mapper" },
            { name: "MTG Review", icon: "🎙️", href: "/consulting/review" },
            { name: "MTG SME Live", icon: "👂", href: "/consulting/sme" },
            { name: "Knowledge Base", icon: "📚", href: "/consulting/knowledge" },
            { name: "Visual Search（未）", icon: "👁️", href: "/consulting/visual-search" },
            { name: "Slide Polisher（未）", icon: "✨", href: "/consulting/slide-polisher" },
            { name: "Data Admin", icon: "⚙️", href: "/consulting/data" },
        ],
    },
    {
        category: "Car Quiz（未）",
        items: [
            { name: "Admin（未）", icon: "🛠️", href: "/car-quiz/admin" },
            { name: "Play Quiz", icon: "🚗", href: "/car-quiz" },
        ],
    },
    {
        category: "AI PoC（テ）",
        items: [
            { name: "Multimodal（テ）", icon: "📝", href: "/multimodal" },
            { name: "ファイル管理（テ）", icon: "📂", href: "/files" },
        ],
    },
];

import { useSidebar } from "./SidebarContext";

export default function Sidebar({ onCloseMobile }) {
    const pathname = usePathname();
    const [hiddenItems, setHiddenItems] = useState([]);
    const { toggleAgentSidebar } = useSidebar();

    const fetchSettings = async () => {
        try {
            const res = await fetch("/api/consulting/training/sidebar/settings");
            if (res.ok) {
                const data = await res.json();
                setHiddenItems(data.hidden_items || []);
                if (typeof window !== "undefined") {
                    localStorage.setItem("thinking_enabled_agent", data.thinking_enabled_agent !== false);
                    localStorage.setItem("thinking_enabled_roleplay", data.thinking_enabled_roleplay !== false);
                    localStorage.setItem("thinking_enabled_sme_live", data.thinking_enabled_sme_live !== false);
                    localStorage.setItem("thinking_enabled_sme_train", data.thinking_enabled_sme_train !== false);
                }
            }
        } catch (e) {
            console.error("Failed to load sidebar settings", e);
        }
    };

    useEffect(() => {
        fetchSettings();

        const handleSettingsChange = () => {
            fetchSettings();
        };
        window.addEventListener("sidebarSettingsUpdated", handleSettingsChange);
        return () => window.removeEventListener("sidebarSettingsUpdated", handleSettingsChange);
    }, []);

    // フィルタリング処理
    const filteredNavItems = navItems.map(section => {
        const visibleItems = section.items.filter(item => !hiddenItems.includes(item.href));
        return {
            ...section,
            items: visibleItems
        };
    }).filter(section => section.items.length > 0);

    return (
        <aside className="w-52 bg-[#0e7490] text-white flex flex-col h-full font-sans">
            {/* Logo Area */}
            <div className="h-14 flex items-center px-4 bg-[#0891b2] shadow-sm flex-shrink-0">
                <h1 className="text-xl font-bold tracking-widest uppercase">Genai-app</h1>
            </div>

            {/* AI Assistant Toggle Button */}
            <div className="p-3 border-b border-cyan-800 bg-[#0e7490]">
                <button
                    onClick={() => {
                        toggleAgentSidebar();
                        onCloseMobile();
                    }}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 px-3 bg-gradient-to-r from-sky-400 via-cyan-500 to-teal-500 hover:from-sky-500 hover:to-teal-600 text-white rounded-xl font-bold text-xs shadow-lg hover:shadow-xl transform active:scale-95 transition-all duration-300 cursor-pointer text-center"
                >
                    <span className="text-sm animate-pulse">✨</span>
                    <span>AIアシスタント (日本語)</span>
                </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-4">
                {filteredNavItems.map((section, idx) => (
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

            {/* フッター設定リンク (固定表示) */}
            <div className="p-3 border-t border-cyan-800 bg-[#0891b2] flex-shrink-0">
                <Link
                    href="/settings/sidebar"
                    onClick={onCloseMobile}
                    className="flex items-center justify-center space-x-2 py-2 px-3 bg-[#155e75] hover:bg-[#1b4e5d] rounded-lg text-xs font-bold transition-all border border-cyan-700 text-cyan-100 hover:text-white animate-fadeIn"
                >
                    <span>⚙️ システム設定</span>
                </Link>
            </div>
        </aside>
    );
}
