"use client";

import React, { useState, useEffect } from 'react';
import {
    getProjects, createProject, deleteProject, reorderProjects, updateProject,
    getProjectTasks, createProjectTask, updateProjectTask, deleteProjectTask, reorderProjectTasks, toggleProjectTask
} from '../utils/projectsApi';
import MobileMenuButton from '../../components/MobileMenuButton';



export default function ProjectsPage() {
    const [projects, setProjects] = useState([]);
    const [selectedProject, setSelectedProject] = useState(null);
    const [tasks, setTasks] = useState([]);
    const [loadingProjects, setLoadingProjects] = useState(true);
    const [loadingTasks, setLoadingTasks] = useState(false);

    // Project Creation State
    const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
    const [newProjectTitle, setNewProjectTitle] = useState("");

    // Task Creation State
    const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
    const [newTask, setNewTask] = useState({ title: "", details: "" });

    // Drag State for Tasks
    const [draggedTask, setDraggedTask] = useState(null);

    // Drag State for Projects
    const [draggedProject, setDraggedProject] = useState(null);

    // Inline Editing State
    const [editingProjectId, setEditingProjectId] = useState(null);
    const [editingTitle, setEditingTitle] = useState("");

    useEffect(() => {
        fetchProjects();
    }, []);

    useEffect(() => {
        if (selectedProject) {
            fetchTasks(selectedProject.id);
        } else {
            setTasks([]);
        }
    }, [selectedProject]);

    const fetchProjects = async () => {
        setLoadingProjects(true);
        try {
            const data = await getProjects();
            setProjects(data);
            if (data.length > 0 && !selectedProject) {
                // Only auto-select if we don't have one, or if the current one is gone
                // But for now, if data exists and selected is null, select first.
                // If selected is not null, verify it still exists?
                // Let's just keep it simple.
                setSelectedProject(data[0]);
            } else if (data.length === 0) {
                setSelectedProject(null);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingProjects(false);
        }
    };

    const fetchTasks = async (projectId) => {
        setLoadingTasks(true);
        try {
            const data = await getProjectTasks(projectId);
            setTasks(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingTasks(false);
        }
    };

    const handleCreateProject = async (e) => {
        e.preventDefault();
        if (!newProjectTitle.trim()) return;
        try {
            const newProj = await createProject(newProjectTitle);
            setNewProjectTitle("");
            setIsProjectModalOpen(false);
            // Refresh and select new
            const data = await getProjects();
            setProjects(data);
            setSelectedProject(newProj);
        } catch (e) {
            alert("Failed to create project");
        }
    };

    const handleDeleteProject = async (projectId, e) => {
        e.stopPropagation();
        if (!confirm("Delete this project?")) return;
        try {
            await deleteProject(projectId);
            const data = await getProjects();
            setProjects(data);
            if (selectedProject && selectedProject.id === projectId) {
                setSelectedProject(data.length > 0 ? data[0] : null);
            }
        } catch (e) {
            alert("Failed to delete project");
        }
    };

    // Rename Logic
    const startEditing = (project) => {
        setEditingProjectId(project.id);
        setEditingTitle(project.title);
    };

    const cancelEditing = () => {
        setEditingProjectId(null);
        setEditingTitle("");
    };

    const saveEditing = async (projectId) => {
        if (!editingTitle.trim()) return cancelEditing();

        // Optimistic update
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, title: editingTitle } : p));
        if (selectedProject?.id === projectId) {
            setSelectedProject(prev => ({ ...prev, title: editingTitle }));
        }
        setEditingProjectId(null);

        try {
            await updateProject(projectId, editingTitle);
        } catch (e) {
            alert("Failed to rename project");
            fetchProjects(); // Revert
        }
    };

    // Project Drag & Drop
    const onProjectDragStart = (e, project) => {
        setDraggedProject(project);
        e.dataTransfer.effectAllowed = 'move';
        // e.dataTransfer.setDragImage(e.target, 0, 0); // Optional
    };

    const onProjectDragOver = (e, targetProject) => {
        e.preventDefault();
        if (!draggedProject || draggedProject.id === targetProject.id) return;

        const oldIndex = projects.findIndex(p => p.id === draggedProject.id);
        const newIndex = projects.findIndex(p => p.id === targetProject.id);
        if (oldIndex === -1 || newIndex === -1) return;

        const newProjects = [...projects];
        newProjects.splice(oldIndex, 1);
        newProjects.splice(newIndex, 0, draggedProject);
        setProjects(newProjects);
    };

    const onProjectDragEnd = async () => {
        if (!draggedProject) return;
        setDraggedProject(null);

        const ids = projects.map(p => p.id);
        try {
            await reorderProjects(ids);
        } catch (e) {
            console.error("Failed to reorder projects", e);
        }
    };

    // --- Task Logic ---

    const handleCreateTask = async (e) => {
        e.preventDefault();
        if (!newTask.title.trim() || !selectedProject) return;
        try {
            await createProjectTask(selectedProject.id, newTask.title, newTask.details);
            setNewTask({ title: "", details: "" });
            setIsTaskModalOpen(false);
            fetchTasks(selectedProject.id);
        } catch (e) {
            alert("Failed to create task");
        }
    };

    const handleToggleTask = async (taskId) => {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, is_completed: !t.is_completed } : t));
        try {
            await toggleProjectTask(selectedProject.id, taskId);
        } catch (e) {
            console.error(e);
            fetchTasks(selectedProject.id);
        }
    };

    const handleDeleteTask = async (taskId) => {
        if (!confirm("Delete task?")) return;
        try {
            await deleteProjectTask(selectedProject.id, taskId);
            setTasks(prev => prev.filter(t => t.id !== taskId));
        } catch (e) {
            alert("Failed to delete task");
        }
    };

    const onTaskDragStart = (e, task) => {
        setDraggedTask(task);
        e.dataTransfer.effectAllowed = 'move';
    };

    const onTaskDragOver = (e, targetTask) => {
        e.preventDefault();
        if (!draggedTask || draggedTask.id === targetTask.id) return;

        const oldIndex = tasks.findIndex(t => t.id === draggedTask.id);
        const newIndex = tasks.findIndex(t => t.id === targetTask.id);
        if (oldIndex === -1 || newIndex === -1) return;

        const newTasks = [...tasks];
        newTasks.splice(oldIndex, 1);
        newTasks.splice(newIndex, 0, draggedTask);
        setTasks(newTasks);
    };

    const onTaskDragEnd = async () => {
        if (!draggedTask || !selectedProject) return;
        setDraggedTask(null);

        const ids = tasks.map(t => t.id);
        try {
            await reorderProjectTasks(selectedProject.id, ids);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="relative w-full h-full bg-slate-50 text-slate-800 font-sans flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col p-6 h-full gap-4">

                {/* Header & Tabs */}
                <div className="flex-none space-y-4">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <MobileMenuButton />
                            <h1 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                                <span>🚀</span> Projects
                            </h1>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setIsProjectModalOpen(true)}
                                className="bg-slate-900 text-white text-xs font-bold px-3 py-2 rounded-lg shadow hover:bg-slate-800 transition-all flex items-center gap-2"
                            >
                                <span>+</span> New Project
                            </button>
                        </div>
                    </div>

                    {/* Tabs Scroll Area */}
                    <div className="flex overflow-x-auto gap-2 pb-2 custom-scrollbar border-b border-slate-200">
                        {projects.map(p => (
                            <div
                                key={p.id}
                                className={`
                                    flex items-center gap-2 px-3 py-2 rounded-t-lg border-b-2 transition-all whitespace-nowrap group relative pr-8
                                    ${selectedProject?.id === p.id
                                        ? 'border-indigo-500 bg-white text-indigo-700 font-bold shadow-sm'
                                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'}
                                `}
                                onClick={() => {
                                    if (editingProjectId !== p.id) setSelectedProject(p);
                                }}
                                onDragOver={(e) => onProjectDragOver(e, p)}
                            >
                                {/* Drag Handle */}
                                <div
                                    draggable
                                    onDragStart={(e) => onProjectDragStart(e, p)}
                                    onDragEnd={onProjectDragEnd}
                                    className="cursor-move text-slate-300 hover:text-slate-500 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    ⋮
                                </div>

                                {editingProjectId === p.id ? (
                                    <input
                                        autoFocus
                                        type="text"
                                        className="bg-white border border-indigo-300 rounded px-1 py-0.5 text-xs font-bold text-indigo-700 outline-none w-24"
                                        value={editingTitle}
                                        onChange={(e) => setEditingTitle(e.target.value)}
                                        onBlur={() => saveEditing(p.id)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveEditing(p.id);
                                            if (e.key === 'Escape') cancelEditing();
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span
                                        className="cursor-pointer"
                                        title="Double click to rename"
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            startEditing(p);
                                        }}
                                    >
                                        {p.title}
                                    </span>
                                )}

                                {/* Delete Button */}
                                {selectedProject?.id === p.id && !editingProjectId && (
                                    <button
                                        onClick={(e) => handleDeleteProject(p.id, e)}
                                        className="absolute right-2 w-4 h-4 rounded-full hover:bg-red-100 text-slate-300 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all text-xs"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        ))}
                        {projects.length === 0 && !loadingProjects && (
                            <div className="text-sm text-slate-400 italic px-2 py-2">No projects yet. Create one!</div>
                        )}
                    </div>
                </div>

                {/* Project Tasks Area */}
                <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative">
                    {selectedProject ? (
                        <>
                            {/* Toolbar */}
                            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                                <h2 className="font-bold text-lg text-slate-700 truncate max-w-md" title={selectedProject.title}>
                                    {selectedProject.title}
                                </h2>
                                <button
                                    onClick={() => setIsTaskModalOpen(true)}
                                    className="text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-full text-xs font-bold transition-colors flex items-center gap-1"
                                >
                                    <span>+</span> Add Task
                                </button>
                            </div>

                            {/* Task List */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                                {tasks.map(t => (
                                    <div
                                        key={t.id}
                                        draggable
                                        onDragStart={(e) => onTaskDragStart(e, t)}
                                        onDragOver={(e) => onTaskDragOver(e, t)}
                                        onDragEnd={onTaskDragEnd}
                                        className={`group p-3 rounded-lg border transition-all flex items-start gap-3 bg-white hover:shadow-md
                                            ${t.is_completed ? 'opacity-50 bg-slate-50' : 'hover:border-indigo-200'}
                                        `}
                                    >
                                        <div
                                            onClick={() => handleToggleTask(t.id)}
                                            className={`mt-0.5 w-5 h-5 rounded border flex-shrink-0 cursor-pointer flex items-center justify-center transition-colors
                                                ${t.is_completed ? 'bg-indigo-500 border-indigo-500' : 'bg-white border-slate-300 hover:border-indigo-400'}
                                            `}
                                        >
                                            {t.is_completed && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                                        </div>

                                        <div className="flex-1 min-w-0 select-none">
                                            <div className={`font-semibold text-sm ${t.is_completed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                                {t.title}
                                            </div>
                                            {t.details && (
                                                <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{t.details}</div>
                                            )}
                                        </div>

                                        <button
                                            onClick={() => handleDeleteTask(t.id)}
                                            className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                ))}
                                {tasks.length === 0 && !loadingTasks && (
                                    <div className="text-center py-20 text-slate-400 text-sm">
                                        No tasks in this project.
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                            {loadingProjects ? "Loading..." : "Select or create a project to get started."}
                        </div>
                    )}
                </div>

            </div>

            {/* Create Project Modal */}
            {isProjectModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden p-6 animate-in zoom-in-95">
                        <h3 className="font-bold text-lg mb-4">Create New Project</h3>
                        <form onSubmit={handleCreateProject} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Project Name</label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={newProjectTitle}
                                    onChange={(e) => setNewProjectTitle(e.target.value)}
                                    placeholder="e.g. App Development"
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => setIsProjectModalOpen(false)} className="px-4 py-2 text-slate-500 font-bold text-sm">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700">Create</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Create Task Modal */}
            {isTaskModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden p-6 animate-in zoom-in-95">
                        <h3 className="font-bold text-lg mb-4">Add Task to {selectedProject?.title}</h3>
                        <form onSubmit={handleCreateTask} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Title</label>
                                <input
                                    autoFocus
                                    type="text"
                                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={newTask.title}
                                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                                    placeholder="Task title"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Details (Optional)</label>
                                <textarea
                                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                    value={newTask.details}
                                    onChange={(e) => setNewTask({ ...newTask, details: e.target.value })}
                                    placeholder="Add more context..."
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => setIsTaskModalOpen(false)} className="px-4 py-2 text-slate-500 font-bold text-sm">Cancel</button>
                                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700">Add Task</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
