"use client";
import React, { useState, useRef } from 'react';
import MobileMenuButton from '../../../components/MobileMenuButton';

export default function VisualSearchPage() {
    const [preview, setPreview] = useState(null); // base64 for display
    const [base64Data, setBase64Data] = useState(null); // base64 for api
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);

    // File Input
    const fileInputRef = useRef(null);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            const res = reader.result;
            setPreview(res);
            setBase64Data(res.split(',')[1]); // remove data:image/...;base64,
        };
        reader.readAsDataURL(file);
    };

    const handleSearch = async () => {
        if (!base64Data) return;
        setLoading(true);
        try {
            const res = await fetch('/api/consulting/visual-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Data })
            });
            const data = await res.json();
            setResults(data.results || []);
        } catch (e) {
            console.error(e);
            alert("Visual Search failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-slate-800">
            <div className="flex items-center gap-4 p-4 bg-white shadow-sm border-b border-slate-200">
                <MobileMenuButton />
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Visual Search</h1>
                    <p className="text-xs text-slate-500">Sketch to Slide: Find professional examples from rough ideas</p>
                </div>
            </div>

            <div className="p-4 md:p-6 flex flex-col md:flex-row gap-6 h-full overflow-hidden">
                {/* Input Area */}
                <div className="w-full md:w-1/3 flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex-shrink-0 overflow-y-auto">
                    <h3 className="font-bold text-slate-700">Upload Sketch / Image</h3>

                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full aspect-square bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors overflow-hidden relative"
                    >
                        {preview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={preview} alt="Preview" className="w-full h-full object-contain" />
                        ) : (
                            <div className="text-center p-4">
                                <span className="text-4xl block mb-2">✏️</span>
                                <span className="text-sm text-slate-500 font-medium">Click to upload image</span>
                            </div>
                        )}
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
                    </div>

                    <button
                        onClick={handleSearch}
                        disabled={loading || !base64Data}
                        className="w-full bg-pink-600 text-white py-3 rounded-lg font-bold hover:bg-pink-700 transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Searching...' : 'Find References'}
                    </button>

                    <div className="text-xs text-slate-400 mt-2">
                        <p>Supported: Hand-drawn sketches, screenshots, whiteboard photos.</p>
                    </div>
                </div>

                {/* Results Area */}
                <div className="flex-1 bg-slate-100 rounded-xl border border-slate-200 p-6 overflow-y-auto">
                    <h3 className="font-bold text-slate-700 mb-4 sticky top-0 bg-slate-100 py-2 z-10 flex justify-between items-center">
                        <span>Visual Matches</span>
                        <span className="text-xs font-normal text-slate-500">{results.length} found</span>
                    </h3>

                    {results.length === 0 && !loading && (
                        <div className="text-center py-20 text-slate-400">
                            <div className="text-4xl mb-2">👁️</div>
                            <p>Upload an image to see similar slides.</p>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {results.map((item, idx) => (
                            <div key={idx} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow group cursor-pointer">
                                <div className="aspect-video bg-slate-200 relative overflow-hidden">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={item.url} alt="Slide Result" className="w-full h-full object-cover" />
                                </div>
                                <div className="p-3">
                                    <div className="text-xs text-slate-400 font-mono mb-1">{item.id || item.uri}</div>
                                    <div className="text-sm font-bold text-slate-700">Similarity: {(item.score || 0).toFixed(2)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
