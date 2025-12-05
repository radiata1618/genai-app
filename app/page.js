"use client";
import { useState } from "react";

export default function Home() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedMimeType, setSelectedMimeType] = useState(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      // reader.result is like "data:image/jpeg;base64,..."
      const base64String = reader.result.split(",")[1];
      setSelectedImage(base64String);
      setSelectedMimeType(file.type);
    };
    reader.readAsDataURL(file);
  };

  const handleSearch = async () => {
    if (!query.trim() && !selectedImage) return;
    setLoading(true);
    setResponse("");

    try {
      const res = await fetch("http://localhost:8000/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          image: selectedImage,
          mimeType: selectedMimeType,
        }),
      });

      const data = await res.json();
      setResponse(data.answer || data.error || data.detail || "No response");
    } catch (e) {
      setResponse("Request failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Multimodalテスト</h2>
          <p className="text-slate-500">Geminiのマルチモーダル機能をテキストと画像でテストします。</p>
        </div>
        <div className="flex space-x-2">
          <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">Active</span>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-semibold text-slate-700 mb-4 border-b border-slate-100 pb-2">
          入力パラメータ
        </h3>

        <div className="space-y-4">
          {/* Text Input */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">質問 / プロンプト</label>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="画像について、または一般的な知識について質問してください..."
              rows={3}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition-all text-slate-700"
            />
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">画像添付</label>
            <div className="flex items-start space-x-4">
              <label className="cursor-pointer inline-flex items-center px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors border border-slate-300">
                <span className="mr-2">📎</span> 画像を選択
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>

              {selectedImage && (
                <div className="relative group">
                  <img
                    src={`data:${selectedMimeType};base64,${selectedImage}`}
                    alt="Preview"
                    className="h-20 w-20 object-cover rounded-lg border border-slate-200 shadow-sm"
                  />
                  <button
                    onClick={() => {
                      setSelectedImage(null);
                      setSelectedMimeType(null);
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
                    title="画像を削除"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              onClick={handleSearch}
              disabled={loading}
              className={`px-6 py-2 rounded-lg font-medium text-white shadow-md transition-all
                ${loading
                  ? "bg-cyan-400 cursor-not-allowed"
                  : "bg-cyan-600 hover:bg-cyan-700 hover:shadow-lg active:transform active:scale-95"
                }`}
            >
              {loading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  処理中...
                </span>
              ) : (
                "分析を実行"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Response Section */}
      {response && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-fade-in">
          <h3 className="text-lg font-semibold text-slate-700 mb-3 flex items-center">
            <span className="mr-2">💡</span> 分析結果
          </h3>
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 text-slate-700 leading-relaxed whitespace-pre-wrap">
            {response}
          </div>
        </div>
      )}
    </div>
  );
}