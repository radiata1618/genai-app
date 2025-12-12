"use client";
import React, { useState } from 'react';
import MobileMenuButton from '../../../components/MobileMenuButton';

export default function AdminPage() {
    const [url, setUrl] = useState('');
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    const log = (msg) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    const handleCollect = async () => {
        if (!url) return;
        setLoading(true);
        log(`Starting collection for: ${url}`);
        try {
            const res = await fetch('/api/consulting/collect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            if (res.ok) {
                log(`Success: ${data.message}`);
            } else {
                log(`Error: ${data.detail}`);
            }
        } catch (e) {
            log(`Network Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 font-sans text-slate-800">
            {/* Header */}
            <div className="flex items-center gap-4 p-4 bg-white shadow-sm border-b border-slate-200">
                <MobileMenuButton />
                <h1 className="text-xl font-bold text-slate-800">Consulting Admin (Data Collection)</h1>
            </div>

            <div className="p-6 max-w-4xl mx-auto w-full space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                    <h2 className="text-lg font-bold mb-4">Web Data Collection</h2>
                    <p className="text-sm text-slate-500 mb-4">
                        Enter a URL (PDF or Page) to download and add to the Consulting Knowledge Base (GCS).
                    </p>
                    <div className="flex gap-4">
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://www.meti.go.jp/.../report.pdf"
                            className="flex-1 p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                        <button
                            onClick={handleCollect}
                            disabled={loading || !url}
                            className="bg-cyan-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-cyan-700 disabled:opacity-50 transition-colors"
                        >
                            {loading ? 'Collecting...' : 'Collect'}
                        </button>
                    </div>
                </div>

                <div className="bg-slate-900 text-slate-200 p-6 rounded-xl shadow-inner font-mono text-xs h-64 overflow-y-auto">
                    <h3 className="text-slate-400 font-bold mb-2 border-b border-slate-700 pb-2">Execution Logs</h3>
                    {logs.length === 0 && <span className="opacity-50">Waiting for commands...</span>}
                    {logs.map((l, i) => <div key={i}>{l}</div>)}
                </div>
            </div>
        </div>
    );
}
