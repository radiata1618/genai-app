"use client";
import React, { useState, useRef } from 'react';
import MobileMenuButton from '../../../components/MobileMenuButton';

export default function SlidePolisherPage() {
    const [text, setText] = useState('');
    const [activeTab, setActiveTab] = useState('text'); // 'text' or 'image'

    // Image State
    const [preview, setPreview] = useState(null);
    const [base64Data, setBase64Data] = useState(null);
    const fileInputRef = useRef(null);

    // Result
    const [generatedHtml, setGeneratedHtml] = useState('');
    const [loading, setLoading] = useState(false);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => {
            setPreview(reader.result);
            setBase64Data(reader.result.split(',')[1]);
        };
        reader.readAsDataURL(file);
    };

    const handlePolish = async () => {
        if (!text && !base64Data) return;
        setLoading(true);
        try {
            const res = await fetch('/api/consulting/slide-polisher', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    image: base64Data
                })
            });
            const data = await res.json();
            setGeneratedHtml(data.html || '');
        } catch (e) {
            console.error(e);
            alert("Polishing failed");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-slate-800">
            <div className="flex items-center gap-4 p-4 bg-white shadow-sm border-b border-slate-200">
                <MobileMenuButton />
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Slide Polisher</h1>
                    <p className="text-xs text-slate-500">Draft to Pro: Reconstruct your slide with professional consulting aesthetics</p>
                </div>
            </div>

            <div className="p-4 md:p-6 flex flex-col xl:flex-row gap-6 h-full overflow-hidden">
                {/* Controls Area */}
                <div className="w-full xl:w-1/3 flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex-shrink-0 overflow-y-auto">
                    <h3 className="font-bold text-slate-700">Input Draft</h3>

                    {/* Tabs */}
                    <div className="flex border-b border-slate-200 mb-2">
                        <button
                            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'text' ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                            onClick={() => setActiveTab('text')}
                        >
                            Text Content
                        </button>
                        <button
                            className={`px-4 py-2 text-sm font-bold border-b-2 transition-colors ${activeTab === 'image' ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                            onClick={() => setActiveTab('image')}
                        >
                            Image Draft
                        </button>
                    </div>

                    {activeTab === 'text' && (
                        <textarea
                            className="w-full h-64 p-4 border border-slate-200 rounded-lg resize-none focus:ring-2 focus:ring-cyan-500 outline-none text-sm leading-relaxed"
                            placeholder="Paste your slide content here...&#10;- Bullet point 1&#10;- Bullet point 2...&#10;Please format as a 3-column layout."
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                        />
                    )}

                    {activeTab === 'image' && (
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full aspect-video bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-slate-100 transition-colors overflow-hidden relative"
                        >
                            {preview ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={preview} alt="Draft" className="w-full h-full object-contain" />
                            ) : (
                                <div className="text-center p-4">
                                    <span className="text-2xl block mb-2">📷</span>
                                    <span className="text-xs text-slate-500 font-medium">Upload Draft Ppt/Image</span>
                                </div>
                            )}
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
                        </div>
                    )}

                    <div className="mt-auto">
                        <button
                            onClick={handlePolish}
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-cyan-600 to-indigo-600 text-white py-3 rounded-lg font-bold shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                        >
                            {loading ? 'Polishing (Generating)...' : '✨ Polish It'}
                        </button>
                    </div>
                </div>

                {/* Preview Area */}
                <div className="flex-1 bg-slate-200 rounded-xl border border-slate-300 p-4 md:p-8 overflow-y-auto flex items-center justify-center relative">
                    {!generatedHtml && !loading && (
                        <div className="text-center text-slate-400">
                            <div className="text-6xl mb-4 opacity-50">🖼️</div>
                            <h3 className="text-lg font-bold">Preview Area</h3>
                            <p className="text-sm max-w-xs mx-auto">Generated slide will appear here.</p>
                        </div>
                    )}

                    {loading && (
                        <div className="text-center">
                            <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                            <div className="text-lg font-bold text-slate-700 animate-pulse">Designing Slide...</div>
                            <div className="text-xs text-slate-500 mt-2">Consulting the AI experts</div>
                        </div>
                    )}

                    {generatedHtml && !loading && (
                        <div className="w-full max-w-5xl aspect-video bg-white shadow-2xl rounded-lg overflow-hidden transform transition-all duration-500 ease-out scale-100">
                            {/* Render HTML safely? For PoC we use dangerouslySetInnerHTML but strip scripts in backend ideally. 
                                 Since this is internal tool, somewhat safe. 
                             */}
                            <div dangerouslySetInnerHTML={{ __html: generatedHtml }} className="w-full h-full" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
