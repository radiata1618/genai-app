"use client";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

export default function PreparationPage() {
    const [tasks, setTasks] = useState([]);
    const [selectedTask, setSelectedTask] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [newTopic, setNewTopic] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [filterDone, setFilterDone] = useState(false); // Default: show all or only stock? User asked for "Check Done", default "Uncompleted only"

    useEffect(() => {
        fetchTasks();
    }, []);

    const fetchTasks = async () => {
        try {
            const res = await fetch("/api/english/preparation");
            if (res.ok) {
                const data = await res.json();
                setTasks(data);
            }
        } catch (error) {
            console.error("Failed to fetch tasks", error);
        }
    };

    const handleCreate = async () => {
        if (!newTopic.trim()) return;
        setIsLoading(true);
        try {
            const res = await fetch("/api/english/preparation", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topic: newTopic }),
            });
            if (res.ok) {
                const newTask = await res.json();
                setTasks([newTask, ...tasks]);
                setSelectedTask(newTask);
                setIsCreating(false);
                setNewTopic("");
                alert("Generation Successful! \n\n作成が完了しました。"); // Simple alert as requested/implied for clarity
            } else {
                alert("Failed to generate content. Please try again.");
            }
        } catch (error) {
            console.error("Failed to create task", error);
            alert("An error occurred. Please check your connection.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!confirm("Are you sure?")) return;
        try {
            const res = await fetch(`/api/english/preparation/${id}`, {
                method: "DELETE",
            });
            if (res.ok) {
                setTasks(tasks.filter((t) => t.id !== id));
                if (selectedTask?.id === id) setSelectedTask(null);
            }
        } catch (error) {
            console.error("Failed to delete", error);
        }
    };

    const handleToggleStatus = async (task, e) => {
        e.stopPropagation();
        const newStatus = task.status === "DONE" ? "TODO" : "DONE";
        try {
            const res = await fetch(`/api/english/preparation/${task.id}/status?status=${newStatus}`, {
                method: "PATCH"
            });
            if (res.ok) {
                setTasks(tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
                if (selectedTask?.id === task.id) {
                    setSelectedTask({ ...selectedTask, status: newStatus });
                }
            }
        } catch (error) {
            console.error("Failed to update status", error);
        }
    };

    const filteredTasks = tasks.filter(t => filterDone ? true : t.status !== "DONE");

    return (
        <div className="flex h-screen bg-gray-50 text-slate-800 font-sans">
            {/* Left Sidebar for List */}
            <div className="w-80 border-r border-gray-200 bg-white flex flex-col">
                <div className="p-4 border-b border-gray-100 bg-gray-50">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-lg font-bold text-slate-700">Preparation</h2>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="bg-cyan-600 hover:bg-cyan-700 text-white p-2 rounded-full shadow-md transition-colors"
                        >
                            + New
                        </button>
                    </div>
                    <div className="flex items-center space-x-2 text-sm text-slate-500">
                        <label className="flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={filterDone}
                                onChange={(e) => setFilterDone(e.target.checked)}
                                className="mr-2"
                            />
                            Show Completed
                        </label>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {filteredTasks.map((task) => (
                        <div
                            key={task.id}
                            onClick={() => setSelectedTask(task)}
                            className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-cyan-50 transition-colors group relative
                                ${selectedTask?.id === task.id ? "bg-cyan-100 border-l-4 border-cyan-500" : ""}
                            `}
                        >
                            <div className="flex justify-between items-start">
                                <h3 className="font-semibold text-slate-800 line-clamp-1">{task.topic}</h3>
                                <button
                                    onClick={(e) => handleDelete(task.id, e)}
                                    className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2"
                                >
                                    ×
                                </button>
                            </div>
                            <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
                                <span>{new Date(task.created_at).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
                                <button
                                    onClick={(e) => handleToggleStatus(task, e)}
                                    className={`px-2 py-0.5 rounded border ${task.status === "DONE" ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}
                                >
                                    {task.status}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
                {isCreating ? (
                    <div className="flex-1 flex items-center justify-center p-8">
                        <div className="w-full max-w-lg bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
                            <h3 className="text-2xl font-bold mb-6 text-slate-800">New Preparation Topic</h3>
                            <input
                                type="text"
                                value={newTopic}
                                onChange={(e) => setNewTopic(e.target.value)}
                                placeholder="e.g. Job Interview for Google, Talking about AI trends"
                                disabled={isLoading}
                                className="w-full p-4 border border-gray-300 rounded-xl mb-6 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition-all"
                            />
                            <div className="flex justify-end space-x-4">
                                <button
                                    onClick={() => setIsCreating(false)}
                                    className="px-6 py-2 text-gray-500 hover:text-gray-700 font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCreate}
                                    disabled={isLoading || !newTopic}
                                    className="px-6 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white rounded-xl shadow-lg font-bold flex items-center"
                                >
                                    {isLoading ? "Generating..." : "Generate Material"}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : selectedTask ? (
                    <div className="flex-1 overflow-y-auto p-8">
                        <div className="max-w-4xl mx-auto">
                            <h1 className="text-3xl font-extrabold text-slate-900 mb-2">{selectedTask.topic}</h1>
                            <div className="flex items-center space-x-4 mb-8 text-sm text-gray-500">
                                <span>Generated on {new Date(selectedTask.created_at).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                <span className={`px-2 py-0.5 rounded font-medium ${selectedTask.status === "DONE" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                                    {selectedTask.status}
                                </span>
                            </div>
                            <article className="prose prose-slate lg:prose-lg max-w-none">
                                <ReactMarkdown
                                    components={{
                                        blockquote: ({ node, ...props }) => (
                                            <div className="bg-cyan-50 border-l-4 border-cyan-500 p-4 my-6 rounded-r-lg shadow-sm text-slate-700 relative font-medium not-italic" {...props}>
                                                <div className="absolute -top-3 left-4 bg-cyan-100 text-cyan-700 text-xs font-bold px-2 py-1 rounded-full uppercase tracking-wide">
                                                    Dialogue
                                                </div>
                                                <div className="pt-2">
                                                    {props.children}
                                                </div>
                                            </div>
                                        ),
                                        h2: ({ node, ...props }) => (
                                            <h2 className="text-2xl font-bold text-slate-800 mt-10 mb-6 pb-2 border-b border-gray-200" {...props} />
                                        ),
                                        h3: ({ node, ...props }) => (
                                            <h3 className="text-xl font-semibold text-slate-700 mt-8 mb-4 border-l-4 border-cyan-200 pl-3" {...props} />
                                        ),
                                        ul: ({ node, ...props }) => (
                                            <ul className="list-disc pl-6 space-y-2 mb-6 text-slate-600" {...props} />
                                        ),
                                        ol: ({ node, ...props }) => (
                                            <ol className="list-decimal pl-6 space-y-2 mb-6 text-slate-600" {...props} />
                                        ),
                                        li: ({ node, ...props }) => (
                                            <li className="pl-1" {...props} />
                                        ),
                                        p: ({ node, ...props }) => (
                                            <p className="mb-4 leading-relaxed text-slate-600 text-lg" {...props} />
                                        ),
                                        strong: ({ node, ...props }) => (
                                            <strong className="font-bold text-slate-900 bg-yellow-50 px-1 rounded" {...props} />
                                        ),
                                    }}
                                >
                                    {selectedTask.content}
                                </ReactMarkdown>
                            </article>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        <div className="text-center">
                            <p className="text-6xl mb-4">📚</p>
                            <p className="text-xl font-medium">Select a topic or create a new one</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
