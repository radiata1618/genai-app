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
      const res = await fetch("/api/vertex-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          image: selectedImage,
          mimeType: selectedMimeType,
        }),
      });

      const data = await res.json();
      setResponse(data.answer || data.error || "No response");
    } catch (e) {
      setResponse("Request failed: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: 32 }}>
      <h1>💡 Gemini (Vertex AI) テストページaa</h1>

      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="質問を入力してください..."
        rows={3}
        style={{ width: "100%", marginBottom: 12 }}
      />

      <div style={{ marginBottom: 12 }}>
        <label style={{ cursor: "pointer", marginRight: 10 }}>
          📎 画像を選択
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </label>
        {selectedImage && (
          <div style={{ marginTop: 8 }}>
            <img
              src={`data:${selectedMimeType};base64,${selectedImage}`}
              alt="Preview"
              style={{ maxWidth: "200px", maxHeight: "200px", borderRadius: 8 }}
            />
            <button
              onClick={() => {
                setSelectedImage(null);
                setSelectedMimeType(null);
              }}
              style={{ marginLeft: 8 }}
            >
              ❌ 削除
            </button>
          </div>
        )}
      </div>

      <button onClick={handleSearch} disabled={loading}>
        {loading ? "送信中..." : "送信"}
      </button>

      {response && (
        <p style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>
          <b>回答:</b> {response}
        </p>
      )}
    </main>
  );
}