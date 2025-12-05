"use client";
import { useState } from "react";

export default function Home() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResponse("");

    try {
      const res = await fetch("/api/vertex-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
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