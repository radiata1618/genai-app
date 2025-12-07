"use client";
import { useState, useEffect } from "react";

export default function FilesPage() {
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchFiles = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("http://localhost:8000/api/management/files");
            if (!res.ok) throw new Error("Failed to fetch files");
            const data = await res.json();
            setFiles(data.files || []);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFiles();
    }, []);

    const handleDelete = async (filename) => {
        if (!confirm(`本当に削除しますか？\n対象: ${filename}`)) return;

        try {
            // API expects just the filename, but let's be careful about paths.
            // The API logic handles "manual_pages/" prefix internally for delete_file if we pass just filename,
            // BUT current management.py implementation assumes `files` return full name (e.g. manual_pages/foo.jpg)?
            // Let's check management.py implementation again.
            // `list_files` returns blob.name (full path like manual_pages/foo.jpg).
            // `delete_file` takes {filename} and does `full_path = f"{GCS_SOURCE_FOLDER}/{filename}"`.
            // So we need to pass JUST the filename part, not the manual_pages/ prefix.

            const justName = filename.split('/').pop();
            const res = await fetch(`http://localhost:8000/api/management/files/${justName}`, {
                method: "DELETE",
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Delete failed");
            }

            alert("削除しました");
            fetchFiles(); // Reload
        } catch (e) {
            alert("エラー: " + e.message);
        }
    };

    const handleUpload = async (file) => {
        if (!file) return;

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch("http://localhost:8000/api/management/files/upload", {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Upload failed");
            }

            // Success (silent or snackbar, here just reload)
            fetchFiles();
        } catch (e) {
            alert("アップロード失敗: " + e.message);
        }
    };

    // Drag & Drop Handlers
    const onDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const onDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const droppedFiles = e.dataTransfer.files;
        if (droppedFiles && droppedFiles.length > 0) {
            // Upload each file
            for (let i = 0; i < droppedFiles.length; i++) {
                await handleUpload(droppedFiles[i]);
            }
        }
    };

    return (
        <div className="space-y-6" onDragOver={onDragOver} onDrop={onDrop}>
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">ファイル管理</h2>
                    <p className="text-slate-500">GCS上のマニュアル画像一覧</p>
                </div>
                <div className="flex space-x-2">
                    <label className="cursor-pointer px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors">
                        <span>➕ 追加</span>
                        <input
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                                if (e.target.files && e.target.files.length > 0) {
                                    handleUpload(e.target.files[0]);
                                }
                            }}
                        />
                    </label>
                    <button
                        onClick={fetchFiles}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600 font-medium transition-colors"
                    >
                        🔄 更新
                    </button>
                </div>
            </div>

            {/* Drag & Drop Hint */}
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center text-slate-400 bg-slate-50 hover:bg-slate-100 transition-colors">
                <p>ここにファイルをドラッグ＆ドロップしてアップロード</p>
            </div>

            {loading && <div className="text-slate-500 text-center py-8">読み込み中...</div>}

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-100">
                    エラー: {error}
                </div>
            )}

            {!loading && !error && files.length === 0 && (
                <div className="text-center py-12 bg-white rounded-xl border border-slate-200 text-slate-400">
                    ファイルが見つかりません
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {files.map((file) => (
                    <div key={file.name} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                        <div className="mb-3">
                            <div className="flex items-center justify-center bg-slate-100 rounded-lg h-32 mb-3 text-slate-400">
                                {/* Since we don't have signed URLs easily without auth, just show icon */}
                                <span className="text-4xl">🖼️</span>
                            </div>
                            <h3 className="font-semibold text-slate-700 text-sm truncate" title={file.name}>
                                {file.name}
                            </h3>
                            <p className="text-xs text-slate-400 mt-1">
                                {(file.size / 1024).toFixed(1)} KB • {new Date(file.updated).toLocaleDateString()}
                            </p>
                        </div>

                        <button
                            onClick={() => handleDelete(file.name)}
                            className="w-full py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-medium transition-colors"
                        >
                            削除
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
