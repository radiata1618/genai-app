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
        return [originalQuery]; // Fallback
    }

    try {
        // Initialize GoogleGenAI SDK
        const ai = new GoogleGenAI({
            vertexai: true,
            project: PROJECT_ID,
            location: GENAI_LOCATION
        });

        const prompt = `
        You are an expert presentation search assistant.
        
        User Query: "${originalQuery}"
        
        Task: Generate 3 distinct search queries to find relevant slides.
        1. **Topic Query**: Focus purely on the business topic (e.g., "Customer Satisfaction", "Market Sizing").
        2. **Structure Query**: Focus purely on the visual structure (e.g., "Bar chart", "Process flow", "2x2 Matrix").
        3. **Combined Query**: A natural sentence combining both (e.g., "Bar chart showing customer satisfaction trends").
        
        Output: A JSON array of strings. Example: ["Customer Satisfaction", "Bar chart", "Customer Satisfaction Bar chart"]
        RETURN JSON ONLY.
        `;

        const response = await ai.models.generateContent({
            model: GENERATIVE_MODEL_ID, // gemini-3-flash-preview or switch to 2.0 if needed
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json"
            }
        });

        // The @google/genai SDK response might vary. 
        // Typically response.text() exists.
        let jsonStr;
        if (typeof response.text === 'function') {
            jsonStr = response.text();
        } else if (response.response && typeof response.response.text === 'function') {
            // Fallback for some versions
            jsonStr = response.response.text();
        } else {
            console.warn("Unexpected Gemini response structure:", JSON.stringify(response, null, 2));
            // Try manual extraction
            jsonStr = response.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
        }

        jsonStr = jsonStr.replace(/```json|```/g, "").trim();
        return JSON.parse(jsonStr);

    } catch (e) {
        console.error("Gemini Refinement Error:", e);
        return [originalQuery]; // Fallback to array
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const { query } = body;

        if (!query) {
            return NextResponse.json({ error: 'Query is required' }, { status: 400 });
        }

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

        // 1. Generate Multiple Queries (Gemini)
        console.log(`[LogicMapper] Original Query: ${query}`);
        const queries = await refineQuery(query);
        console.log(`[LogicMapper] Generated Queries:`, queries);

        // 2. Generate Embeddings & Run Vector Searches in Parallel
        const coll = db.collection('consulting_slides');
        const CANDIDATE_LIMIT = 50; // Fetch 50 per query

        const searchPromises = queries.map(async (q) => {
            const vector = await getEmbedding(q);
            if (!vector) return [];

            const vQuery = coll.findNearest('embedding', FieldValue.vector(vector), {
                limit: CANDIDATE_LIMIT,
                distanceMeasure: 'COSINE'
            });
            const snap = await vQuery.get();
            return snap.docs.map(doc => {
                const data = doc.data();
                const { embedding, ...rest } = data;

                // Calculate Vector Score
                let vectorScore = 0;
                if (embedding) {
                    const docVec = Array.isArray(embedding) ? embedding :
                        (embedding.toArray ? embedding.toArray() : Object.values(embedding));
                    vectorScore = cosineSimilarity(vector, docVec);
                }

                return {
                    id: doc.id,
                    ...rest,
                    vectorScore: vectorScore // Note: this is score against THIS query
                };
            });
        });

        const resultsArrays = await Promise.all(searchPromises);

        // Flatten and Deduplicate
        const uniqueCandidates = new Map();
        resultsArrays.flat().forEach(item => {
            if (!uniqueCandidates.has(item.id)) {
                uniqueCandidates.set(item.id, item);
            } else {
                // If already exists, maybe keep the one with higher vectorScore?
                // Or just keep first one. Let's keep higher score.
                const existing = uniqueCandidates.get(item.id);
                if (item.vectorScore > existing.vectorScore) {
                    uniqueCandidates.set(item.id, item);
                }
            }
        });

        let initialResults = Array.from(uniqueCandidates.values());
        console.log(`[LogicMapper] Total unique candidates: ${initialResults.length}`);

        // 3. Reranking (Gemini)
        async function rerankResults(query, candidates) {
            if (!candidates || candidates.length === 0) return [];

            // Initialize GoogleGenAI SDK (Vertex AI mode) for reranking
            const ai = new GoogleGenAI({
                vertexai: true,
                project: PROJECT_ID,
                location: GENAI_LOCATION
            });

            // Prepare prompt with candidates
            // Limit candidates for reranking to avoid token limits? 
            // 150 candidates * ~100 tokens = 15k tokens. Should be fine for Gemini 2.0.
            const candidateText = candidates.map((c, i) => {
                // Truncate description slightly to save tokens
                const desc = (c.description || "").substring(0, 300);
                // Also include OCR text if available, as description might be thin
                const textContent = c.text_content ? c.text_content.substring(0, 200) : "";
                return `ID: ${c.id}\nContent: [${c.structure_type}] KeyMsg: ${c.key_message}. Desc: ${desc}. Text: ${textContent}`;
            }).join('\n---\n');

            console.log(`[LogicMapper] Rerank candidates text (snippet): ${candidateText.substring(0, 500)}...`);

            const prompt = `
            You are a rigorous search relevance evaluator.
            
            User Query: "${query}"
            
            Task: Rate the relevance of the following slide candidates to the User Query on a scale of 0 to 100.
            
            Criteria:
            - High Score (80-100): The slide content (Key Message, Description, or Text) DIRECTLY addresses the specific business topic in the User Query.
            - Low Score (0-39): The slide is about a completely different topic, OR it is just a generic template without specific content matching the query.
            
            Candidates:
            ${candidateText}
            
            Output JSON format ONLY:
            [
              { "id": "candidate_id", "score": 85, "reason": "Explicitly mentions 'Digital Strategy' and 'Roadmap'" },
              ...
            ]
            `;

            try {
                const result = await ai.models.generateContent({
                    model: "gemini-2.0-flash-exp",
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                });

                let jsonStr;
                if (typeof result.text === 'function') {
                    jsonStr = result.text();
                } else if (result.response && typeof result.response.text === 'function') {
                    jsonStr = result.response.text();
                } else {
                    jsonStr = result.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
                }

                // console.log(`[LogicMapper] Rerank raw response: ${jsonStr.substring(0, 200)}...`);
                jsonStr = jsonStr.replace(/```json|```/g, "").trim();
                return JSON.parse(jsonStr);
            } catch (e) {
                console.error("Reranking failed:", e);
                return [];
            }
        }

        console.log(`[LogicMapper] Reranking ${initialResults.length} candidates...`);
        const rerankScores = await rerankResults(query, initialResults);

        const scoreMap = new Map(rerankScores.map(r => [r.id, r]));

        const finalResults = initialResults.map(item => {
            const rankData = scoreMap.get(item.id);
            const aiScore = rankData ? rankData.score / 100 : 0;
            const finalScore = rankData ? aiScore : item.vectorScore;

            return {
                ...item,
                aiReason: rankData ? rankData.reason : "Vector match",
                score: finalScore,
                vectorScore: item.vectorScore
            };
        });

        finalResults.sort((a, b) => b.score - a.score);
        const topResults = finalResults.slice(0, 30);

        // Helper to get Signed URL
        const { getStorage } = await import('firebase-admin/storage');

        // Sign URLs
        const results = await Promise.all(topResults.map(async (item) => {
            let signedUrl = null;
            if (item.uri && item.uri.startsWith('gs://')) {
                try {
                    const match = item.uri.match(/gs:\/\/([^\/]+)\/(.+)/);
                    if (match) {
                        const bucketName = match[1];
                        const filePath = match[2];
                        const file = getStorage().bucket(bucketName).file(filePath);
                        const [url] = await file.getSignedUrl({
                            action: 'read',
                            expires: Date.now() + 1000 * 60 * 60,
                        });
                        signedUrl = url;
                    } else {
                        console.warn(`[LogicMapper] Invalid gs format for doc ${item.id}: ${item.uri}`);
                    }
                } catch (e) {
                    console.warn(`[LogicMapper] Failed to sign URL for ${item.id} (${item.uri}):`, e.message);
                }
            } else {
                console.warn(`[LogicMapper] No valid uri for doc ${item.id}: ${item.uri}`);
            }
            return {
                ...item,
                url: signedUrl || item.public_url || null
            };
        }));

        return NextResponse.json({
            results,
            metadata: {
                // Join queries for display
                refinedQuery: queries.join(' / '),
                originalQuery: query
            }
        });

    } catch (e) {
        console.error("Logic Mapper Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
