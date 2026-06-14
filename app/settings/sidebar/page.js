"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import MobileMenuButton from "../../../components/MobileMenuButton";
import { navItems } from "../../../components/Sidebar";

export default function SidebarSettingsPage() {
    const [hiddenItems, setHiddenItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        setIsLoading(true);
        try {
            const res = await fetch("/api/consulting/training/sidebar/settings");
            if (res.ok) {
                const data = await res.json();
                setHiddenItems(data.hidden_items || []);
            }
        } catch (e) {
            console.error("Failed to fetch sidebar settings:", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleToggle = async (href) => {
        if (isSaving) return;

        let updatedHiddenItems;
        if (hiddenItems.includes(href)) {
            updatedHiddenItems = hiddenItems.filter(item => item !== href);
        } else {
            updatedHiddenItems = [...hiddenItems, href];
        }

        setHiddenItems(updatedHiddenItems);
        setIsSaving(true);

        try {
            const res = await fetch("/api/consulting/training/sidebar/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ hidden_items: updatedHiddenItems })
            });

            if (res.ok) {
                const event = new Event("sidebarSettingsUpdated");
                window.dispatchEvent(event);
            } else {
                throw new Error("保存に失敗しました。");
            }
        } catch (error) {
            alert("設定の保存に失敗しました: " + error.message);
            fetchSettings();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex h-screen bg-gray-50 text-slate-800 font-sans overflow-hidden">
            {/* メインビュー */}
            <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
                {/* ヘッダー */}
                <div className="flex items-center p-3.5 border-b border-gray-200 justify-between flex-shrink-0 bg-white z-10">
                    <div className="flex items-center gap-3">
                        <MobileMenuButton />
                        <Link href="/consulting/training" className="text-slate-600 hover:text-cyan-600 transition-colors text-xs flex items-center bg-white px-3 py-1.5 rounded-full border border-gray-300 shadow-xs">
                            ◀ MTG Training 一覧へ
                        </Link>
                        <h1 className="text-sm font-bold tracking-wider text-slate-700 hidden sm:block">⚙️ サイドバー表示設定</h1>
                    </div>
                    {isSaving && (
                        <div className="text-xs text-cyan-600 animate-pulse font-medium bg-cyan-50 border border-cyan-200 px-3 py-1 rounded-full">
                            Database同期中...
                        </div>
                    )}
                </div>

                {/* 設定コンテンツ */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar max-w-4xl mx-auto w-full pb-16">
                    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                        <h2 className="text-base font-bold text-slate-800 mb-2">サイドバーボタンの表示切り替え</h2>
                        <p className="text-xs text-slate-500 leading-relaxed">
                            左側のナビゲーションメニューの各項目を表示または非表示にトグルで切り替えることができます。<br />
                            設定はデータベース（Firestore）に自動的に保存され、すべてのデバイスで同期されます。セクション内の項目をすべて非表示にすると、セクションヘッダー自体も自動的に非表示になります。
                        </p>
                    </div>

                    {isLoading ? (
                        <div className="h-60 flex flex-col items-center justify-center space-y-3">
                            <span className="animate-spin text-3xl text-cyan-600">🌀</span>
                            <span className="text-xs text-slate-500">設定データを読み込み中...</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {navItems.map((section, sIdx) => (
                                <div 
                                    key={sIdx}
                                    className="bg-white border border-gray-200 p-5 rounded-2xl shadow-sm space-y-4 hover:border-cyan-300 transition-all flex flex-col justify-between"
                                >
                                    <div>
                                        <h3 className="text-xs font-black text-cyan-600 uppercase tracking-widest border-b border-gray-100 pb-2 mb-3">
                                            {section.category}
                                        </h3>
                                        <div className="space-y-3">
                                            {section.items.map((item, iIdx) => {
                                                const isVisible = !hiddenItems.includes(item.href);
                                                return (
                                                    <div 
                                                        key={iIdx}
                                                        className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 border border-gray-100 hover:bg-cyan-50/20 transition-all"
                                                    >
                                                        <div className="flex items-center space-x-3">
                                                            <span className="text-base opacity-85">{item.icon}</span>
                                                            <span className="text-xs font-bold text-slate-700">{item.name}</span>
                                                        </div>
                                                        
                                                        {/* トグルスイッチ */}
                                                        <button
                                                            onClick={() => handleToggle(item.href)}
                                                            className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors duration-300 focus:outline-none ${
                                                                isVisible ? "bg-cyan-600" : "bg-gray-300"
                                                            }`}
                                                        >
                                                            <span
                                                                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-300 ${
                                                                    isVisible ? "translate-x-5.5" : "translate-x-1"
                                                                }`}
                                                            />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
