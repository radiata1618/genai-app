"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';

export default function GcsBucketPage() {
    const [currentPath, setCurrentPath] = useState(""); // 現在のフォルダパス（例: ""、"folder1/"）
    const [items, setItems] = useState([]); // ファイルとフォルダのリスト
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [isDragActive, setIsDragActive] = useState(false);
    
    // フォルダ作成モーダルの状態
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");

    // ファイル一覧の取得
    const fetchFiles = async (path = currentPath) => {
        setLoading(true);
        try {
            const data = await api.gcsListFiles(path);
            setItems(data);
        } catch (e) {
            console.error(e);
            alert("ファイル一覧の読み込みに失敗しました。");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFiles(currentPath);
    }, [currentPath]);

    // フォルダに入る
    const handleEnterFolder = (folderPath) => {
        setCurrentPath(folderPath);
    };

    // 親フォルダに戻る
    const handleGoBack = () => {
        if (!currentPath) return;
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop(); // 最後の階層を取り除く
        const parentPath = parts.length > 0 ? parts.join('/') + '/' : "";
        setCurrentPath(parentPath);
    };

    // パンくずリスト用のクリック処理
    const handleBreadcrumbClick = (index) => {
        if (index === -1) {
            setCurrentPath("");
            return;
        }
        const parts = currentPath.split('/').filter(Boolean);
        const targetPath = parts.slice(0, index + 1).join('/') + '/';
        setCurrentPath(targetPath);
    };

    // ドラッグ＆ドロップ関連
    const onDragOver = useCallback((e) => {
        e.preventDefault();
        setIsDragActive(true);
    }, []);

    const onDragLeave = useCallback((e) => {
        e.preventDefault();
        setIsDragActive(false);
    }, []);

    // アップロード共通処理
    const handleUploadFiles = async (filesToUpload) => {
        if (filesToUpload.length === 0) return;
        setUploading(true);
        try {
            for (const file of filesToUpload) {
                // すでに同名ファイルが存在するかチェック
                const exists = items.some(item => item.type === 'file' && item.name === file.name);
                if (exists) {
                    if (!confirm(`「${file.name}」は既に存在します。上書き（更新）しますか？`)) {
                        continue;
                    }
                }
                await api.gcsUploadFile(currentPath, file);
            }
            fetchFiles(currentPath);
        } catch (e) {
            console.error(e);
            alert("アップロードに失敗しました。");
        } finally {
            setUploading(false);
        }
    };

    const onDrop = useCallback(async (e) => {
        e.preventDefault();
        setIsDragActive(false);
        const acceptedFiles = Array.from(e.dataTransfer.files);
        await handleUploadFiles(acceptedFiles);
    }, [items, currentPath]);

    // ファイル選択インプット
    const fileInputRef = useRef(null);
    const onFileInputChange = async (e) => {
        const selectedFiles = Array.from(e.target.files || []);
        await handleUploadFiles(selectedFiles);
    };
    const openFileDialog = () => {
        if (fileInputRef.current) fileInputRef.current.click();
    };

    // フォルダの作成
    const handleCreateFolder = async (e) => {
        e.preventDefault();
        if (!newFolderName.trim()) return;
        if (newFolderName.includes('/')) {
            alert("フォルダ名にスラッシュ「/」は含められません。");
            return;
        }
        try {
            await api.gcsCreateFolder(currentPath, newFolderName.trim());
            setShowFolderModal(false);
            setNewFolderName("");
            fetchFiles(currentPath);
        } catch (e) {
            console.error(e);
            alert("フォルダの作成に失敗しました。");
        }
    };

    // ファイル/フォルダの削除
    const handleDelete = async (item) => {
        const message = item.type === 'folder' 
            ? `フォルダ「${item.name}」とその中身すべてを完全に削除しますか？` 
            : `ファイル「${item.name}」を削除しますか？`;
            
        if (!confirm(message)) return;
        
        try {
            await api.gcsDelete(item.path, item.type);
            fetchFiles(currentPath);
        } catch (e) {
            console.error(e);
            alert("削除に失敗しました。");
        }
    };

    // 別タブで開く
    const handleViewFile = (itemPath) => {
        const url = api.gcsGetViewUrl(itemPath);
        window.open(url, '_blank');
    };

    // ファイルサイズフォーマット
    const formatBytes = (bytes, decimals = 2) => {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    };

    // パンくずのパース
    const breadcrumbs = currentPath.split('/').filter(Boolean);

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 p-8 font-sans transition-colors duration-300">
            <div className="max-w-6xl mx-auto space-y-8">
                
                {/* ヘッダーエリア */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-sky-500">
                            GCSバケット管理
                        </h1>
                        <p className="text-slate-400 mt-1 text-sm">
                            バケット <code>claude-cowork-output</code> の中身をメンテします。
                        </p>
                    </div>

                    <div className="flex items-center space-x-3">
                        <button
                            onClick={() => setShowFolderModal(true)}
                            className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-800/50 rounded-xl px-4 py-2.5 text-sm font-bold shadow-lg hover:shadow-cyan-900/10 transform active:scale-95 transition-all duration-200"
                        >
                            <span>📁 新規フォルダ</span>
                        </button>
                        <button
                            onClick={openFileDialog}
                            className="flex items-center space-x-2 bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white rounded-xl px-4 py-2.5 text-sm font-bold shadow-lg shadow-cyan-500/10 transform active:scale-95 transition-all duration-200"
                        >
                            <span>📤 アップロード</span>
                        </button>
                    </div>
                </div>

                {/* パンくずナビゲーション */}
                <div className="flex items-center space-x-2 text-sm bg-slate-800/50 px-4 py-3 rounded-xl border border-slate-700/50">
                    <span 
                        onClick={() => handleBreadcrumbClick(-1)}
                        className="cursor-pointer text-slate-400 hover:text-cyan-400 transition-colors font-medium"
                    >
                        Root
                    </span>
                    {breadcrumbs.map((crumb, idx) => (
                        <React.Fragment key={idx}>
                            <span className="text-slate-600">/</span>
                            <span 
                                onClick={() => handleBreadcrumbClick(idx)}
                                className={`cursor-pointer hover:text-cyan-400 transition-colors font-medium ${
                                    idx === breadcrumbs.length - 1 ? "text-cyan-400" : "text-slate-400"
                                }`}
                            >
                                {crumb}
                            </span>
                        </React.Fragment>
                    ))}
                </div>

                {/* ファイルインプット (非表示) */}
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={onFileInputChange}
                    style={{ display: 'none' }}
                    multiple
                />

                {/* ドラッグ＆ドロップ アップロード領域 */}
                <div
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onClick={openFileDialog}
                    className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 relative overflow-hidden group
                        ${isDragActive 
                            ? 'border-cyan-400 bg-cyan-950/20 shadow-inner' 
                            : 'border-slate-700/80 bg-slate-800/30 hover:border-cyan-800/80 hover:bg-slate-800/50'}
                    `}
                >
                    {uploading ? (
                        <div className="space-y-3">
                            <div className="animate-spin text-4xl inline-block text-cyan-400">🌀</div>
                            <p className="text-lg font-bold text-cyan-400 animate-pulse">ファイルをアップロード中...</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <p className="text-4xl group-hover:scale-110 transition-transform duration-300 inline-block">📤</p>
                            <p className="text-base font-bold text-slate-300">ここにファイルをドラッグ＆ドロップ、またはクリックして選択</p>
                            <p className="text-xs text-slate-500">HTML、PDF、画像、ドキュメントなどあらゆるファイルを登録・更新できます</p>
                        </div>
                    )}
                </div>

                {/* ローディング表示 */}
                {loading && (
                    <div className="text-center py-20 bg-slate-800/20 rounded-2xl border border-slate-800">
                        <div className="animate-spin text-4xl inline-block text-cyan-500 mb-4">🌀</div>
                        <p className="text-slate-400 font-medium">ファイルを読み込んでいます...</p>
                    </div>
                )}

                {/* ファイル・フォルダ一覧 */}
                {!loading && (
                    <div className="bg-slate-800/40 rounded-2xl border border-slate-800/80 overflow-hidden shadow-xl">
                        {items.length === 0 ? (
                            <div className="text-center py-20 text-slate-500 italic">
                                {currentPath ? (
                                    <div className="space-y-4">
                                        <p>このフォルダは空です。</p>
                                        <button 
                                            onClick={handleGoBack}
                                            className="text-cyan-400 hover:text-cyan-300 underline font-semibold text-sm"
                                        >
                                            上の階層に戻る
                                        </button>
                                    </div>
                                ) : (
                                    "バケットにファイルがありません。"
                                )}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-800 bg-slate-800/70 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                                            <th className="px-6 py-4">名前</th>
                                            <th className="px-6 py-4">サイズ</th>
                                            <th className="px-6 py-4">最終更新</th>
                                            <th className="px-6 py-4 text-right">アクション</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/60">
                                        {/* 親フォルダへの遷移行 */}
                                        {currentPath && (
                                            <tr 
                                                onClick={handleGoBack}
                                                className="hover:bg-slate-800/30 cursor-pointer text-slate-400 transition-colors"
                                            >
                                                <td className="px-6 py-4 font-bold flex items-center space-x-3">
                                                    <span className="text-lg">↩️</span>
                                                    <span>.. (上の階層へ)</span>
                                                </td>
                                                <td className="px-6 py-4">-</td>
                                                <td className="px-6 py-4">-</td>
                                                <td className="px-6 py-4"></td>
                                            </tr>
                                        )}
                                        {items.map((item, index) => (
                                            <tr 
                                                key={index} 
                                                className="hover:bg-slate-800/30 transition-colors group cursor-pointer"
                                                onClick={() => item.type === 'folder' ? handleEnterFolder(item.path) : null}
                                            >
                                                <td className="px-6 py-4 font-medium text-slate-200">
                                                    <div className="flex items-center space-x-3">
                                                        <span className="text-xl">
                                                            {item.type === 'folder' ? '📁' : '📄'}
                                                        </span>
                                                        <span className="hover:text-cyan-400 transition-colors truncate max-w-md">
                                                            {item.name}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-sm text-slate-400">
                                                    {item.type === 'folder' ? '-' : formatBytes(item.size)}
                                                </td>
                                                <td className="px-6 py-4 text-sm text-slate-400">
                                                    {item.type === 'folder' ? '-' : new Date(item.updated).toLocaleString('ja-JP')}
                                                </td>
                                                <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center justify-end space-x-2">
                                                        {item.type === 'file' && (
                                                            <button
                                                                onClick={() => handleViewFile(item.path)}
                                                                className="px-3 py-1.5 text-xs font-bold text-cyan-400 bg-cyan-950/30 hover:bg-cyan-950/70 border border-cyan-800/50 rounded-lg transition-all"
                                                            >
                                                                別タブで開く
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleDelete(item)}
                                                            className="px-3 py-1.5 text-xs font-bold text-rose-400 bg-rose-950/20 hover:bg-rose-950/60 border border-rose-900/40 rounded-lg transition-all"
                                                        >
                                                            削除
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* フォルダ作成モーダル */}
                {showFolderModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn">
                        <div className="bg-slate-800 border border-slate-700/80 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
                            <h2 className="text-xl font-bold text-slate-100">新規フォルダ作成</h2>
                            <form onSubmit={handleCreateFolder} className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-bold text-slate-400">フォルダ名</label>
                                    <input
                                        type="text"
                                        value={newFolderName}
                                        onChange={(e) => setNewFolderName(e.target.value)}
                                        placeholder="フォルダ名を入力"
                                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all text-sm"
                                        autoFocus
                                    />
                                </div>
                                <div className="flex items-center justify-end space-x-3 pt-2">
                                    <button
                                        type="button"
                                        onClick={() => { setShowFolderModal(false); setNewFolderName(""); }}
                                        className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-slate-200 transition-colors"
                                    >
                                        キャンセル
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-4 py-2 text-sm font-bold bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl shadow-lg shadow-cyan-500/10 transition-colors"
                                    >
                                        作成
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
