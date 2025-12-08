"use client";

import React, { useState } from 'react';

export default function AdminPage() {
    const [prompt, setPrompt] = useState('');
    const [generatedCars, setGeneratedCars] = useState([]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [collectingImages, setCollectingImages] = useState(false);

    // 1. Generate List using Vertex AI
    const handleGenerateList = async () => {
        if (!prompt) return;
        setLoading(true);
        setMessage('');
        try {
            const res = await fetch('/api/car-quiz/generate-list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || 'Failed to generate list');
            }
            const data = await res.json();
            setGeneratedCars(data);
            setMessage(`Successfully generated ${data.length} cars.`);
        } catch (e) {
            console.error(e);
            setMessage(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    // 2. Collect Images using Custom Search
    const handleCollectImages = async () => {
        if (generatedCars.length === 0) return;
        setCollectingImages(true);
        setMessage('Collecting images...');
        try {
            const res = await fetch('/api/car-quiz/collect-images', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cars: generatedCars }),
            });
            if (!res.ok) throw new Error('Failed to collect images');
            const data = await res.json();
            setGeneratedCars(data);
            setMessage('Image collection complete.');
        } catch (e) {
            console.error(e);
            setMessage('Error collecting images.');
        } finally {
            setCollectingImages(false);
        }
    };

    // 3. Approve & Save Car
    const handleApprove = async (index) => {
        const car = generatedCars[index];
        try {
            // Optimistically update UI
            const newCars = [...generatedCars];
            newCars[index].saving = true;
            setGeneratedCars(newCars);

            const res = await fetch('/api/car-quiz/save-car', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(car),
            });

            if (!res.ok) throw new Error('Failed to save car');

            // Update UI to show saved/published status
            newCars[index].is_published = true;
            newCars[index].saving = false;
            setGeneratedCars(newCars);

        } catch (e) {
            console.error(e);
            // alert('Failed to save car');
            setMessage('Failed to save car');
            const newCars = [...generatedCars];
            newCars[index].saving = false;
            setGeneratedCars(newCars);
        }
    };

    // 4. Remove Car from list
    const handleRemove = (index) => {
        const newCars = [...generatedCars];
        newCars.splice(index, 1);
        setGeneratedCars(newCars);
    };

    // 5. Fetch Existing List
    const handleFetchList = async () => {
        setLoading(true);
        setMessage('Loading from database...');
        try {
            const res = await fetch('/api/car-quiz/fetch-list');
            if (!res.ok) throw new Error('Failed to fetch list');
            const data = await res.json();
            setGeneratedCars(data);
            setMessage(`Loaded ${data.length} cars from database.`);
        } catch (e) {
            console.error(e);
            setMessage('Failed to load existing cars.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-8">
            <header className="mb-8 border-b pb-4 border-slate-200">
                <h1 className="text-3xl font-bold text-slate-800">Car Quiz Admin</h1>
                <p className="text-slate-500">Manage car database and generate content with AI.</p>
            </header>

            {/* Generation Section */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                <h2 className="text-xl font-semibold mb-4 text-slate-700">1. Generate Car List</h2>
                <div className="flex gap-4">
                    <input
                        type="text"
                        className="flex-1 border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
                        placeholder='e.g., "List 5 current Toyota SUVs with model codes" or "Initialize Market List"'
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                    />
                    <button
                        onClick={handleGenerateList}
                        disabled={loading}
                        className="bg-cyan-600 text-white px-6 py-2 rounded-lg hover:bg-cyan-700 transition disabled:opacity-50 font-medium whitespace-nowrap"
                    >
                        {loading ? 'Processing...' : 'Generate with AI'}
                    </button>
                </div>
            </section>

            {/* Action Bar */}
            <section className="flex flex-wrap justify-between items-center bg-cyan-50 p-4 rounded-lg gap-4">
                <div className="text-cyan-800 font-medium flex items-center gap-4">
                    <span>{generatedCars.length} cars in view</span>
                    <button
                        onClick={handleFetchList}
                        disabled={loading}
                        className="text-xs bg-white border border-cyan-200 px-3 py-1.5 rounded hover:bg-cyan-100 text-cyan-700 font-semibold transition"
                    >
                        Load Database
                    </button>
                </div>
                <button
                    onClick={handleCollectImages}
                    disabled={collectingImages || generatedCars.length === 0}
                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 font-medium shadow-sm"
                >
                    {collectingImages ? 'Collecting Images...' : '2. Collect Images'}
                </button>
            </section>

            {/* Message Feedback */}
            {message && <div className="text-sm font-medium text-slate-600 bg-slate-100 p-3 rounded">{message}</div>}

            {/* List Display */}
            <div className="grid gap-6">
                {generatedCars.map((car, index) => (
                    <div key={index} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 transition hover:shadow-md">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800">{car.manufacturer} {car.name}</h3>
                                <div className="flex gap-2 text-sm text-slate-500 mt-1">
                                    <span className="bg-slate-100 px-2 py-0.5 rounded">{car.model_code}</span>
                                    <span className="bg-slate-100 px-2 py-0.5 rounded">{car.body_type}</span>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {car.is_published ? (
                                    <span className="text-green-600 font-bold bg-green-50 px-3 py-1 rounded-full text-sm">Published</span>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => handleRemove(index)}
                                            className="text-red-500 hover:text-red-700 font-medium text-sm px-3 py-1"
                                        >
                                            Remove
                                        </button>
                                        <button
                                            onClick={() => handleApprove(index)}
                                            disabled={car.saving || !car.image_urls || car.image_urls.length === 0}
                                            className="bg-emerald-500 text-white px-4 py-1.5 rounded-lg hover:bg-emerald-600 transition disabled:opacity-50 text-sm font-bold shadow-sm"
                                        >
                                            {car.saving ? 'Saving...' : 'Approve & Save'}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Image Preview */}
                        <div className="flex gap-4 overflow-x-auto pb-2">
                            {car.image_urls && car.image_urls.length > 0 ? (
                                car.image_urls.map((url, i) => (
                                    <div key={i} className="relative flex-shrink-0 w-48 h-32 rounded-lg overflow-hidden border border-slate-200">
                                        <img src={url} alt={`${car.name} ${i}`} className="w-full h-full object-cover" />
                                    </div>
                                ))
                            ) : (
                                <div className="w-full h-32 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400 text-sm italic border border-dashed border-slate-200">
                                    No images collected yet.
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
