"use client";
import React, { useState } from 'react';
import MobileMenuButton from '../../../components/MobileMenuButton';

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState('url'); // 'url' or 'file'
    const [url, setUrl] = useState('');
    const [file, setFile] = useState(null);
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    const log = (msg) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

    const handleCollect = async () => {
        if (activeTab === 'url' && !url) return;
        if (activeTab === 'file' && !file) return;

        setLoading(true);
        setLogs([]); // Clear previous logs
        let taskId = null;

        try {
            // 1. Start Task
            let res;
            if (activeTab === 'url') {
                log(`Starting URL collection for: ${url}`);
                res = await fetch('/api/consulting/collect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });
            } else {
                log(`Starting File analysis for: ${file.name}`);
                const formData = new FormData();
                formData.append('file', file);
                res = await fetch('/api/consulting/collect-file', {
                    method: 'POST',
                    body: formData
                });
            }

            const data = await res.json();
            if (!res.ok) {
                log(`Error starting task: ${data.detail || data.message}`);
                setLoading(false);
                return;
            }

            taskId = data.task_id;
            log(`Task Started (ID: ${taskId}). Connect to stream...`);

            // 2. Open Stream
            const eventSource = new EventSource(`/api/consulting/tasks/${taskId}/stream`);

            eventSource.onmessage = (event) => {
                const payload = JSON.parse(event.data);
                const message = payload.message;

                // Direct append to logs to avoid "log" helper timestamp duplication if backend sends it? 
                // Backend sends "[HH:MM:SS] Msg". Helper adds another timestamp. 
                // Let's rely on backend timestamp or just print raw message.
                // But "log" helper adds local time. Let's just use "setLogs" directly for stream or modify helper.
                setLogs(prev => [...prev, message]);

                if (message === "DONE" || message.includes("Critical Error")) {
                    eventSource.close();
                    setLoading(false);
                }
            };

            eventSource.onerror = (e) => {
                // EventSource error (often end of stream)
                eventSource.close();
                setLoading(false);
            };

        } catch (e) {
            log(`Network Error: ${e.message}`);
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
                    <div className="flex border-b border-slate-200 mb-6">
                        <button
                            className={`px-6 py-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'url' ? 'border-cyan-600 text-cyan-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('url')}
                        >
                            Web URL
                        </button>
                        <button
                            className={`px-6 py-3 font-bold text-sm border-b-2 transition-colors ${activeTab === 'file' ? 'border-cyan-600 text-cyan-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                            onClick={() => setActiveTab('file')}
                        >
                            <span className="mr-2">📂</span> Upload PDF File
                        </button>
                    </div>

                    <p className="text-sm text-slate-500 mb-4">
                        {activeTab === 'url'
                            ? "Enter a URL (PDF or Page) to download and add to the Consulting Knowledge Base."
                            : "Upload a PDF file containing links to reports. We will extract and download all linked PDFs."}
                    </p>

                    <div className="flex gap-4 items-center">
                        {activeTab === 'url' ? (
                            <input
                                type="text"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://www.meti.go.jp/.../report.pdf"
                                className="flex-1 p-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-cyan-500"
                            />
                        ) : (
                            <div className="flex-1">
                                <label className="flex items-center gap-3 p-3 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                                    <span className="text-2xl">📄</span>
                                    <div className="flex-1">
                                        <div className="text-sm font-bold text-slate-700">{file ? file.name : "Choose a PDF file..."}</div>
                                        <div className="text-xs text-slate-400">PDFs with embedded links</div>
                                    </div>
                                    <input
                                        type="file"
                                        accept=".pdf"
                                        className="hidden"
                                        onChange={(e) => setFile(e.target.files[0])}
                                    />
                                </label>
                            </div>
                        )}

                        <button
                            onClick={handleCollect}
                            disabled={loading || (activeTab === 'url' ? !url : !file)}
                            className="bg-cyan-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-cyan-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                            {loading ? 'Processing...' : 'Collect'}
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
