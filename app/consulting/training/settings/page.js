"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import MobileMenuButton from "../../../../components/MobileMenuButton";

export default function MtgTrainingSettingsPage() {
    const [systemInstruction, setSystemInstruction] = useState("");
    const [rubricDefinition, setRubricDefinition] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    // AI壁打ちチャット用状態
    const [chatMessages, setChatMessages] = useState([
        {
            role: "assistant",
            content: "こんにちは！！MTG Trainingの評価プロンプト調整アシスタントです。現在のシステムプロンプトやルーブリックの評価基準に対して「咀嚼力の配点を大きくしてほしい」「滑舌の評価項目をさらに細分化したい」などの調整要求を教えてください。要望を反映した新しいプロンプトを提案します。"
        }
    ]);
    const [userMessage, setUserMessage] = useState("");
    const [isChatLoading, setIsChatLoading] = useState(false);

    // AIから提案された新しい設定（一時保存用）
    const [proposedInstruction, setProposedInstruction] = useState("");
    const [proposedRubric, setProposedRubric] = useState("");

    // 初期設定の読み込み
    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const res = await fetch("/api/consulting/training/config");
            if (res.ok) {
                const data = await res.json();
                setSystemInstruction(data.system_instruction || "");
                setRubricDefinition(data.rubric_definition || "");
            }
        } catch (error) {
            console.error("Failed to load training config", error);
        }
    };

    // 手動保存
    const handleSaveConfig = async () => {
        setIsSaving(true);
        try {
            const res = await fetch("/api/consulting/training/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    system_instruction: systemInstruction,
                    rubric_definition: rubricDefinition
                })
            });
            if (res.ok) {
                alert("プロンプト設定を保存しました。");
            } else {
                throw new Error("保存に失敗しました。");
            }
        } catch (error) {
            alert("エラー: " + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    // AI壁打ちの送信
    const handleSendChatMessage = async (e) => {
        e.preventDefault();
        if (!userMessage.trim() || isChatLoading) return;

        const newMessages = [...chatMessages, { role: "user", content: userMessage }];
        setChatMessages(newMessages);
        const currentMessage = userMessage;
        setUserMessage("");
        setIsChatLoading(true);

        try {
            const res = await fetch("/api/consulting/training/config/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    user_message: currentMessage,
                    current_system_instruction: systemInstruction,
                    current_rubric_definition: rubricDefinition
                })
            });

            if (res.ok) {
                const data = await res.json();

                setChatMessages([
                    ...newMessages,
                    { role: "assistant", content: data.assistant_response }
                ]);

                setProposedInstruction(data.proposed_system_instruction);
                setProposedRubric(data.proposed_rubric_definition);
            } else {
                throw new Error("AIからの応答取得に失敗しました。");
            }
        } catch (error) {
            setChatMessages([
                ...newMessages,
                { role: "assistant", content: "申し訳ありません。エラーが発生しました: " + error.message }
            ]);
        } finally {
            setIsChatLoading(false);
        }
    };

    const handleApplyProposal = () => {
        if (!proposedInstruction && !proposedRubric) return;

        if (proposedInstruction) setSystemInstruction(proposedInstruction);
        if (proposedRubric) setRubricDefinition(proposedRubric);

        setProposedInstruction("");
        setProposedRubric("");

        alert("AIの提案を設定画面に適用しました。内容を確認し、よろしければ「設定を保存する」ボタンを押してください。");
    };

    return (
        <div className="flex h-full bg-gray-50 text-slate-800 font-sans overflow-hidden">
            {/* メインビュー */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
                {/* ヘッダー */}
                <div className="flex items-center p-3.5 border-b border-gray-200 justify-between flex-shrink-0 bg-white z-10">
                    <div className="flex items-center gap-3">
                        <MobileMenuButton />
                        <Link href="/consulting/training" className="text-slate-600 hover:text-cyan-600 transition-colors text-xs flex items-center bg-white px-3 py-1.5 rounded-full border border-gray-300 shadow-xs">
                            ◀ トレーニングへ戻る
                        </Link>
                        <h1 className="text-base font-bold text-slate-700 hidden sm:block">🏋️ MTG Training プロンプト管理・AI壁打ち</h1>
                    </div>

                    <button
                        onClick={handleSaveConfig}
                        disabled={isSaving}
                        className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 text-white font-medium px-4 py-2 rounded-full shadow-md transition-all text-xs"
                    >
                        {isSaving ? "保存中..." : "💾 設定を保存する"}
                    </button>
                </div>

                {/* 2カラムスプリットレイアウト */}
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden p-4 sm:p-6 gap-6 bg-gray-50">
                    {/* 左カラム: 手動設定編集エリア */}
                    <div className="flex-1 flex flex-col space-y-4 overflow-hidden bg-white p-4 sm:p-6 rounded-2xl border border-gray-200 shadow-xs">
                        <div className="flex justify-between items-center flex-shrink-0">
                            <h2 className="text-sm font-bold text-slate-800 flex items-center">
                                <span className="mr-2">📝</span> 評価プロンプト・ルーブリック定義
                            </h2>
                            {/* 適用可能な提案がある場合のみ表示するバッジ */}
                            {(proposedInstruction || proposedRubric) && (
                                <button
                                    onClick={handleApplyProposal}
                                    className="bg-amber-100 hover:bg-amber-200 animate-pulse text-amber-800 font-bold px-3 py-1 rounded-full text-xs transition-colors flex items-center shadow-xs border border-amber-300"
                                >
                                    ✨ AIの提案を反映する
                                </button>
                            )}
                        </div>

                        <div className="flex-1 flex flex-col space-y-4 overflow-y-auto pr-1">
                            {/* システム指示文 */}
                            <div className="flex flex-col space-y-1.5 flex-1 min-h-[200px]">
                                <label className="text-xs font-bold text-slate-500 flex justify-between">
                                    <span>AIコーチの役割・システムプロンプト (System Instruction)</span>
                                    <span className="text-slate-400">会議音声全体に対するGeminiの振る舞い・ペルソナを指定</span>
                                </label>
                                <textarea
                                    value={systemInstruction}
                                    onChange={(e) => setSystemInstruction(e.target.value)}
                                    className="w-full flex-1 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono resize-none custom-scrollbar"
                                    placeholder="Geminiのシステムロールを設定してください..."
                                />
                            </div>

                            {/* ルーブリック定義 */}
                            <div className="flex flex-col space-y-1.5 flex-1 min-h-[300px]">
                                <label className="text-xs font-bold text-slate-500 flex justify-between">
                                    <span>定量的評価基準 (ルーブリック定義)</span>
                                    <span className="text-slate-400">1点〜5点の具体的なスコアリング判定条件を指定</span>
                                </label>
                                <textarea
                                    value={rubricDefinition}
                                    onChange={(e) => setRubricDefinition(e.target.value)}
                                    className="w-full flex-1 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-slate-700 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono resize-none custom-scrollbar"
                                    placeholder="スコアリングのルールやルーブリックを設定してください..."
                                />
                            </div>
                        </div>
                    </div>

                    {/* 右カラム: 壁打ちAIチャットエリア (ライトテーマ化) */}
                    <div className="w-full lg:w-[450px] flex flex-col overflow-hidden bg-white rounded-2xl border border-gray-200 shadow-xs">
                        <div className="p-4 border-b border-gray-200 bg-gray-50 flex-shrink-0 flex items-center gap-2">
                            <span className="text-lg">🤖</span>
                            <div>
                                <h2 className="text-xs font-bold text-slate-800">プロンプト壁打ち調整AI</h2>
                                <p className="text-[10px] text-slate-400">対話を通して最適な指示文を生成します</p>
                            </div>
                        </div>

                        {/* メッセージログ */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-gray-50/50">
                            {chatMessages.map((msg, mIdx) => (
                                <div
                                    key={mIdx}
                                    className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                                >
                                    <span className="text-[10px] text-slate-400 mb-1">
                                        {msg.role === 'user' ? 'あなた' : '調整AI'}
                                    </span>
                                    <div
                                        className={`p-3 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap shadow-xs
                                            ${msg.role === 'user'
                                                ? 'bg-cyan-600 text-white rounded-tr-none'
                                                : 'bg-white text-slate-700 rounded-tl-none border border-gray-200'}`}
                                    >
                                        {msg.content}
                                    </div>
                                </div>
                            ))}
                            {isChatLoading && (
                                <div className="flex items-center gap-1.5 text-slate-400 text-xs pl-2">
                                    <span className="animate-bounce">●</span>
                                    <span className="animate-bounce delay-100">●</span>
                                    <span className="animate-bounce delay-200">●</span>
                                    <span>AIが調整プロンプトを生成中...</span>
                                </div>
                            )}
                        </div>

                        {/* 適用ガイダンスエリア */}
                        {(proposedInstruction || proposedRubric) && (
                            <div className="p-3 bg-amber-50 border-t border-b border-amber-200 text-center flex-shrink-0 flex justify-between items-center gap-2">
                                <span className="text-[10px] text-amber-800 text-left font-medium">
                                    調整が完了したプロンプト案があります。
                                </span>
                                <button
                                    onClick={handleApplyProposal}
                                    className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-colors shadow-xs flex-shrink-0"
                                >
                                    👈 設定に反映
                                </button>
                            </div>
                        )}

                        {/* 入力欄 */}
                        <form onSubmit={handleSendChatMessage} className="p-3 border-t border-gray-200 flex gap-2 flex-shrink-0 bg-white">
                            <input
                                type="text"
                                value={userMessage}
                                onChange={(e) => setUserMessage(e.target.value)}
                                placeholder="例: 滑舌の評価をもう少し優しくして..."
                                disabled={isChatLoading}
                                className="flex-1 px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-slate-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            />
                            <button
                                type="submit"
                                disabled={isChatLoading || !userMessage.trim()}
                                className="bg-cyan-600 hover:bg-cyan-700 text-white rounded-full p-2 w-8 h-8 flex items-center justify-center transition-all shadow-xs flex-shrink-0"
                            >
                                ➔
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
