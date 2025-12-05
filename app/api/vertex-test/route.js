import { NextResponse } from "next/server";
import { VertexAI } from "@google-cloud/vertexai";

export async function POST(req) {
    try {
        const { query, image, mimeType } = await req.json();

        const vertexAI = new VertexAI({
            project: process.env.PROJECT_ID,
            location: process.env.LOCATION,
            googleAuthOptions: {
                keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            },
        });

        const generativeModel = vertexAI.getGenerativeModel({
            model: "gemini-2.0-flash-001",
            tools: [{ googleSearch: {} }],
        });

        const parts = [];
        if (query) {
            parts.push({ text: query });
        }
        if (image && mimeType) {
            parts.push({
                inlineData: {
                    mimeType: mimeType,
                    data: image,
                },
            });
        }

        const request = {
            contents: [
                {
                    role: "user",
                    parts: parts,
                },
            ],
        };

        const result = await generativeModel.generateContent(request);

        const text =
            result.response?.candidates?.[0]?.content?.parts?.[0]?.text ??
            "(no text response)";

        return NextResponse.json({ answer: text });
    } catch (err) {
        console.error("Vertex AI Error:", err);
        return NextResponse.json(
            { error: err.message ?? "Unknown error" },
            { status: 500 }
        );
    }
}