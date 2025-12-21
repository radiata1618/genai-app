import { NextResponse } from 'next/server';
import { db } from '@/app/lib/firebase';
import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import { FieldValue } from 'firebase-admin/firestore';

// Configuration
// Ideally these are in environment variables. 
// If process.env.PROJECT_ID is missing, we try to infer it.
const PROJECT_ID = process.env.PROJECT_ID || process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
// Embedding Location (must match where data is stored)
const LOCATION = process.env.LOCATION || 'asia-northeast1';
// Gemini 3 Location (must be 'global' for Preview)
const GENAI_LOCATION = 'global';
const EMBEDDING_MODEL_ID = 'multimodalembedding@001';
const GENERATIVE_MODEL_ID = 'gemini-3-flash-preview';

/**
 * Generates Multimodal Embedding using direct REST API (via GoogleAuth)
 * This is used because the Node.js SDK support for multimodalembedding@001 might vary.
 */
async function getEmbedding(text) {
    if (!text) return null;

    // Auth for Vertex AI (Embedding)
    const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
    });
    const client = await auth.getClient();
    const projectId = await auth.getProjectId();
    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${LOCATION}/publishers/google/models/${EMBEDDING_MODEL_ID}:predict`;

    // Payload for multimodalembedding@001
    // Format: { instances: [ { text: "..." } ] }
    // Note: dimension limits? Default is 1408.
    const data = {
        instances: [
            { text: text }
        ]
    };

    try {
        const res = await client.request({
            url,
            method: 'POST',
            data
        });

        // Response format: { predictions: [ { textEmbedding: [...] }, ... ] }
        const predictions = res.data.predictions;
        if (predictions && predictions.length > 0 && predictions[0].textEmbedding) {
            return predictions[0].textEmbedding;
        }
        return null;
    } catch (e) {
        console.error("Embedding API Error:", e.response ? e.response.data : e.message);
        throw e;
    }
}

/**
 * Refines the user query into a visual structural search query using Gemini 3.
 * Uses @google/genai SDK.
 */
async function refineQuery(originalQuery) {
    if (!PROJECT_ID) {
        console.warn("PROJECT_ID is not set. Skipping refinement.");
        return originalQuery; // Fallback
    }

    try {
        // Initialize GoogleGenAI SDK (Vertex AI mode) as per article
        const ai = new GoogleGenAI({
            vertexai: true,
            project: PROJECT_ID,
            location: GENAI_LOCATION // 'global'
        });

        const prompt = `
        You are an expert presentation consultant.
        Your task is to transform the user's raw query (which describes a business logic or intent) into a visual slide structure description used for vector search.
        
        Rules:
        1. Output ONLY the refined description. No intro/outro.
        2. Focus on visual elements types (e.g., "Bar chart comparing...", "3-step process flow...", "2x2 matrix...").
        3. Be specific about the relationship (e.g., "Contrast", "Growth", "Hierarchy").
        
        User Query: "${originalQuery}"
        Refined Description:
        `;

        const response = await ai.models.generateContent({
            model: GENERATIVE_MODEL_ID,
            contents: prompt
        });

        return response.text ? response.text.trim() : originalQuery;
    } catch (e) {
        console.error("Gemini Refinement Error:", e);
        return originalQuery; // Fallback to original
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { query } = body;

        if (!query) {
            return NextResponse.json({ error: 'Query is required' }, { status: 400 });
        }

        // 1. Refine Query (Gemini)
        console.log(`[LogicMapper] Original Query: ${query}`);
        const refinedQuery = await refineQuery(query);
        console.log(`[LogicMapper] Refined Query: ${refinedQuery}`);

        // 2. Generate Embedding (Multimodal)
        const embeddingVector = await getEmbedding(refinedQuery);

        if (!embeddingVector) {
            return NextResponse.json({ error: 'Failed to generate embedding' }, { status: 500 });
        }

        // 3. Vector Search (Firestore)
        const coll = db.collection('consulting_slides');
        const vectorQuery = coll.findNearest('embedding', FieldValue.vector(embeddingVector), {
            limit: 10,
            distanceMeasure: 'COSINE'
        });

        const snapshot = await vectorQuery.get();

        // Helper to get Signed URL
        const { getStorage } = await import('firebase-admin/storage');
        const bucket = getStorage().bucket(process.env.GCS_BUCKET_NAME || `${PROJECT_ID}.firebasestorage.app`);
        // Note: Default bucket might be different. 
        // Ideally we parse the 'uri' field: gs://<bucket>/<path>

        // Helper: Cosine Similarity
        function cosineSimilarity(vecA, vecB) {
            let dotProduct = 0;
            let magnitudeA = 0;
            let magnitudeB = 0;
            for (let i = 0; i < vecA.length; i++) {
                dotProduct += vecA[i] * vecB[i];
                magnitudeA += vecA[i] * vecA[i];
                magnitudeB += vecB[i] * vecB[i];
            }
            magnitudeA = Math.sqrt(magnitudeA);
            magnitudeB = Math.sqrt(magnitudeB);
            if (magnitudeA === 0 || magnitudeB === 0) return 0;
            return dotProduct / (magnitudeA * magnitudeB);
        }

        const results = await Promise.all(snapshot.docs.map(async (doc) => {
            const data = doc.data();
            const { embedding, ...rest } = data;

            // Calculate Score manually
            let score = 0;
            if (embedding && embeddingVector) {
                // embedding might be an object/Vector type depending on SDK version, 
                // or a plain array. Adjust if needed.
                // Usually it's an array or has .toArray(). 
                // Let's assume array for now or try to convert.
                const docVec = Array.isArray(embedding) ? embedding :
                    (embedding.toArray ? embedding.toArray() : Object.values(embedding));
                score = cosineSimilarity(embeddingVector, docVec);
            }

            let signedUrl = null;
            if (data.uri && data.uri.startsWith('gs://')) {
                try {
                    // uri format: gs://bucket/path/to/file
                    const match = data.uri.match(/gs:\/\/([^\/]+)\/(.+)/);
                    if (match) {
                        const bucketName = match[1];
                        const filePath = match[2];
                        const file = getStorage().bucket(bucketName).file(filePath);
                        const [url] = await file.getSignedUrl({
                            action: 'read',
                            expires: Date.now() + 1000 * 60 * 60, // 1 hour
                        });
                        signedUrl = url;
                    }
                } catch (e) {
                    console.warn("Failed to generate signed URL for", data.uri, e);
                }
            }

            return {
                id: doc.id,
                ...rest,
                url: signedUrl || data.public_url || null,
                score: score
            };
        }));

        // Sort by score just in case (though vectorQuery should have done it)
        results.sort((a, b) => b.score - a.score);

        return NextResponse.json({
            results,
            metadata: {
                refinedQuery,
                originalQuery: query
            }
        });

    } catch (e) {
        console.error("Logic Mapper Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
