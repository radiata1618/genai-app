"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getRecipes } from '../actions/recipe';
import StarRating from '../../components/StarRating';
import MobileMenuButton from '../../components/MobileMenuButton';

export default function RecipeListPage() {
    const [recipes, setRecipes] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => {
            loadRecipes();
        }, 500);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    async function loadRecipes() {
        setIsLoading(true);
        try {
            const data = await getRecipes(searchQuery);
            setRecipes(data);
        } catch (error) {
            console.error("Failed to load recipes:", error);
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="flex flex-col h-full bg-slate-50 p-3 md:p-6 overscroll-none">
            <header className="flex flex-col md:flex-row md:justify-between md:items-center mb-4 md:mb-8 gap-4">
                <div className="flex items-center gap-2">
                    <MobileMenuButton />
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Recipes</h1>
                        <p className="text-xs md:text-base text-slate-500 mt-1">Manage your cooking collection</p>
                    </div>
                </div>
                <Link href="/recipes/new" className="self-end md:self-auto">
                    <button className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 md:px-6 md:py-2.5 rounded-full font-medium shadow-lg transition-all transform hover:scale-105 active:scale-95 flex items-center text-sm md:text-base">
                        <span className="mr-2 text-lg md:text-xl">+</span> Add Recipe
                    </button>
                </Link>
            </header>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
                {/* Search Bar */}
                <div className="mb-4 md:mb-8 relative group">
                    <input
                        type="text"
                        placeholder="Search recipes by title or type..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full p-3 md:p-4 pl-10 md:pl-12 rounded-2xl border-2 border-slate-200 bg-white text-slate-700 shadow-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all outline-none text-sm md:text-base"
                    />
                    <span className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-xl md:text-2xl text-slate-400 group-focus-within:text-indigo-500 transition-colors">
                        🔍
                    </span>
                </div>

                {/* Recipe List */}
                {isLoading ? (
                    <div className="flex justify-center items-center h-64">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                        {recipes.length > 0 ? (
                            recipes.map((recipe) => (
                                <Link href={`/recipes/${recipe.id}`} key={recipe.id} className="block group">
                                    <div className="bg-white rounded-2xl p-4 md:p-6 shadow-sm border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 h-full flex flex-col">
                                        <div className="flex justify-between items-start mb-3 md:mb-4">
                                            <div className={`px-3 py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wide 
                                                ${recipe.type === 'Main' ? 'bg-orange-100 text-orange-600' :
                                                    recipe.type === 'Side' ? 'bg-green-100 text-green-600' :
                                                        recipe.type === 'Soup' ? 'bg-blue-100 text-blue-600' :
                                                            'bg-gray-100 text-gray-600'}`}>
                                                {recipe.type || 'Other'}
                                            </div>
                                            {/* <span className="text-slate-400 text-sm">{new Date(recipe.updated_at).toLocaleDateString()}</span> */}
                                        </div>
                                        <h2 className="text-lg md:text-xl font-bold text-slate-800 mb-2 group-hover:text-indigo-600 transition-colors line-clamp-2">
                                            {recipe.title || 'Untitled Recipe'}
                                        </h2>

                                        {/* Ratings Summary */}
                                        <div className="flex gap-3 md:gap-4 mb-3">
                                            <div className="flex items-center gap-1">
                                                <span className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase">Effort</span>
                                                <StarRating value={recipe.effort_rating} sizeClass="text-xs" colorClass="text-blue-400" />
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <span className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase">Taste</span>
                                                <StarRating value={recipe.taste_rating} sizeClass="text-xs" colorClass="text-orange-400" />
                                            </div>
                                        </div>
                                        <p className="text-slate-500 text-xs md:text-sm line-clamp-3 mb-3 md:mb-4 flex-grow">
                                            {recipe.content ? recipe.content.replace(/[#*`]/g, '') : 'No content...'}
                                        </p>
                                        <div className="mt-auto pt-3 md:pt-4 border-t border-slate-100 flex justify-end items-center text-indigo-500 font-medium opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity text-sm">
                                            View Details →
                                        </div>
                                    </div>
                                </Link>
                            ))
                        ) : (
                            <div className="col-span-full text-center py-20 text-slate-400 bg-white rounded-3xl border border-dashed border-slate-300">
                                <p className="text-xl mb-4">No recipes found matching "{searchQuery}"</p>
                                <p>Try a different search or add a new recipe.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
