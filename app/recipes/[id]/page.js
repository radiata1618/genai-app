"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { getRecipe, saveRecipe, deleteRecipe } from '../../actions/recipe';
import StarRating from '../../../components/StarRating';

export default function RecipeDetailPage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id; // 'new' or actual ID

    // Unwrapping params is necessary in Next.js 15+ if using as props, but here we use hook which is synchronous or wrapped? 
    // Actually useParams returns params directly.

    const [recipe, setRecipe] = useState({
        title: '',
        type: 'Main',
        content: '',
        effort_rating: 0,
        taste_rating: 0
    });
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isPreview, setIsPreview] = useState(false); // Toggle between Edit and Preview

    useEffect(() => {
        if (id && id !== 'new') {
            loadRecipe(id);
        } else {
            setIsLoading(false);
            // Default to 'Edit' mode for new recipes
            setIsPreview(false);
        }
    }, [id]);

    async function loadRecipe(recipeId) {
        try {
            const data = await getRecipe(recipeId);
            if (data) {
                setRecipe(data);
                // Default to 'Preview' mode for existing recipes
                setIsPreview(true);
            } else {
                // Determine if 404
                console.error("Recipe not found");
            }
        } catch (error) {
            console.error("Failed to load recipe", error);
        } finally {
            setIsLoading(false);
        }
    }

    async function handleSave() {
        if (!recipe.title.trim()) {
            alert("Title is required");
            return;
        }
        setIsSaving(true);
        try {
            await saveRecipe({ ...recipe, id: id === 'new' ? null : id });
            router.push('/recipes');
        } catch (error) {
            console.error("Failed to save", error);
            alert("Failed to save recipe");
        } finally {
            setIsSaving(false);
        }
    }

    async function handleDelete() {
        if (!confirm("Are you sure you want to delete this recipe?")) return;
        try {
            await deleteRecipe(id);
            router.push('/recipes');
        } catch (error) {
            console.error("Failed to delete", error);
            alert("Failed to delete recipe");
        }
    }

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-full bg-slate-50">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 p-6 overflow-hidden">
            {/* Header / Actions */}
            <div className="flex justify-between items-center mb-6">
                <Link href="/recipes" className="text-slate-500 hover:text-slate-800 flex items-center transition-colors">
                    <span className="mr-1">←</span> Back to List
                </Link>

                <div className="flex gap-3">
                    {id !== 'new' && (
                        <button
                            onClick={handleDelete}
                            className="bg-red-50 text-red-600 px-4 py-2 rounded-lg font-medium hover:bg-red-100 transition-colors"
                        >
                            Delete
                        </button>
                    )}

                    <button
                        onClick={() => setIsPreview(!isPreview)}
                        className="bg-white text-slate-600 border border-slate-200 px-4 py-2 rounded-lg font-medium hover:bg-slate-50 transition-colors shadow-sm"
                    >
                        {isPreview ? 'Edit Mode ✏️' : 'Preview Mode 👁️'}
                    </button>

                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-md disabled:opacity-70 disabled:cursor-not-allowed flex items-center"
                    >
                        {isSaving ? 'Saving...' : 'Save Recipe'}
                    </button>
                </div>
            </div>

            <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col md:flex-row">

                {/* Meta Data & Editor Side / Full View */}
                <div className={`flex flex-col p-6 overflow-y-auto ${isPreview ? 'hidden md:flex md:w-1/3 border-r border-slate-100' : 'w-full'} transition-all`}>

                    {/* Title & Type */}
                    <div className="mb-6 space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Title</label>
                            <input
                                type="text"
                                value={recipe.title}
                                onChange={e => setRecipe({ ...recipe, title: e.target.value })}
                                className="w-full text-2xl font-bold p-2 -ml-2 rounded-lg border-2 border-transparent hover:border-slate-100 focus:border-indigo-100 focus:bg-indigo-50/30 outline-none transition-all text-slate-800 placeholder-slate-300"
                                placeholder="Recipe Name"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Type</label>
                            <div className="flex gap-2">
                                {['Main', 'Side', 'Soup', 'Other'].map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setRecipe({ ...recipe, type })}
                                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all
                                            ${recipe.type === type
                                                ? 'bg-indigo-600 text-white shadow-md transform scale-105'
                                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Ratings */}
                        <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <StarRating
                                label="Effort (手間)"
                                value={recipe.effort_rating}
                                onChange={(val) => setRecipe({ ...recipe, effort_rating: val })}
                                colorClass="text-blue-400"
                            />
                            <StarRating
                                label="Taste (味)"
                                value={recipe.taste_rating}
                                onChange={(val) => setRecipe({ ...recipe, taste_rating: val })}
                                colorClass="text-orange-400"
                            />
                        </div>
                    </div>

                    {/* Markdown Editor */}
                    <div className="flex-1 flex flex-col">
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex justify-between">
                            <span>Content (Markdown)</span>
                            <span className="text-slate-300 font-normal normal-case">Paste Gemini output here</span>
                        </label>
                        <textarea
                            value={recipe.content}
                            onChange={e => setRecipe({ ...recipe, content: e.target.value })}
                            className="flex-1 w-full p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-mono text-sm leading-relaxed outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50/50 resize-none transition-all"
                            placeholder="# Recipe Instructions&#10;&#10;**Ingredients:**&#10;- item 1&#10;- item 2&#10;&#10;**Steps:**&#10;1. Do this..."
                        />
                    </div>
                </div>

                {/* Preview Side */}
                <div className={`bg-white p-8 overflow-y-auto ${isPreview ? 'w-full md:flex-1' : 'hidden'} transition-all`}>
                    {/* Rendered View */}
                    <div className="max-w-none text-slate-700 leading-relaxed">
                        {/* Custom Title Display in Preview */}
                        <div className="mb-6 border-b pb-4 border-slate-100">
                            <div className="flex justify-between items-start mb-3">
                                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide 
                                                ${recipe.type === 'Main' ? 'bg-orange-100 text-orange-600' :
                                        recipe.type === 'Side' ? 'bg-green-100 text-green-600' :
                                            recipe.type === 'Soup' ? 'bg-blue-100 text-blue-600' :
                                                'bg-gray-100 text-gray-600'}`}>
                                    {recipe.type}
                                </span>
                                <div className="flex gap-4">
                                    <StarRating
                                        label="Effort"
                                        value={recipe.effort_rating}
                                        colorClass="text-blue-400"
                                    />
                                    <StarRating
                                        label="Taste"
                                        value={recipe.taste_rating}
                                        colorClass="text-orange-400"
                                    />
                                </div>
                            </div>

                            <h1 className="text-3xl font-extrabold text-slate-800 m-0">{recipe.title || 'Untitled Recipe'}</h1>
                        </div>

                        {recipe.content ? (
                            <ReactMarkdown
                                components={{
                                    h1: ({ node, ...props }) => <h1 className="text-2xl font-bold text-slate-800 mt-6 mb-3" {...props} />,
                                    h2: ({ node, ...props }) => <h2 className="text-xl font-bold text-slate-800 mt-5 mb-2 border-b border-slate-100 pb-1" {...props} />,
                                    h3: ({ node, ...props }) => <h3 className="text-lg font-bold text-slate-800 mt-4 mb-2" {...props} />,
                                    p: ({ node, ...props }) => <p className="mb-3 leading-7 text-slate-700 whitespace-pre-line" {...props} />,
                                    ul: ({ node, ...props }) => <ul className="list-disc pl-5 mb-3 space-y-1" {...props} />,
                                    ol: ({ node, ...props }) => <ol className="list-decimal pl-5 mb-3 space-y-1" {...props} />,
                                    li: ({ node, ...props }) => <li className="pl-1" {...props} />,
                                    blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-indigo-200 pl-4 py-1 my-3 bg-slate-50 italic text-slate-600" {...props} />,
                                    code: ({ node, inline, className, children, ...props }) => {
                                        return inline ?
                                            <code className="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono text-indigo-600" {...props}>{children}</code> :
                                            <pre className="bg-slate-800 text-slate-100 p-4 rounded-lg overflow-x-auto my-4 text-sm font-mono" {...props}><code>{children}</code></pre>
                                    }
                                }}
                            >
                                {recipe.content}
                            </ReactMarkdown>
                        ) : (
                            <div className="text-slate-300 italic text-center py-20">
                                Nothing to preview yet. Add content in Edit mode.
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
