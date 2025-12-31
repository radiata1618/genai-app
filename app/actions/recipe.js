'use server';

import { db } from '../lib/firebase';
import { getNowJST } from '../utils/date';

function serialize(obj) {
    if (obj === null || obj === undefined) return obj;

    // Handle Firestore Timestamp
    if (obj && typeof obj.toDate === 'function') {
        return obj.toDate().toISOString();
    }

    // Handle Date
    if (obj instanceof Date) {
        return obj.toISOString();
    }

    // Handle Array
    if (Array.isArray(obj)) {
        return obj.map(item => serialize(item));
    }

    // Handle Object
    if (typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = serialize(obj[key]);
        }
        return newObj;
    }

    return obj;
}

export async function getRecipes(query = '') {
    let ref = db.collection('recipes');

    // Simple client-side filtering might be better for small datasets, 
    // but here we get all and filter if query is present, or use Firestore queries if possible.
    // Firestore lacks simple substring search, so we'll fetch all and filter in memory for now 
    // assuming the recipe count isn't massive yet.

    const snapshot = await ref.orderBy('updated_at', 'desc').get();

    let recipes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (query) {
        const lowerQuery = query.toLowerCase();
        recipes = recipes.filter(r =>
            (r.title && r.title.toLowerCase().includes(lowerQuery)) ||
            (r.type && r.type.toLowerCase().includes(lowerQuery))
        );
    }

    return serialize(recipes);
}

export async function getRecipe(id) {
    const doc = await db.collection('recipes').doc(id).get();
    if (!doc.exists) return null;
    return serialize({ id: doc.id, ...doc.data() });
}

export async function saveRecipe(recipe) {
    const now = getNowJST();

    const data = {
        title: recipe.title,
        type: recipe.type, // 'Main', 'Side', 'Soup', 'Other'
        content: recipe.content, // Markdown content
        effort_rating: recipe.effort_rating || 0,
        taste_rating: recipe.taste_rating || 0,
        updated_at: now
    };

    let id = recipe.id;

    if (id) {
        await db.collection('recipes').doc(id).update(data);
    } else {
        data.created_at = now;
        const ref = await db.collection('recipes').add(data);
        id = ref.id;
    }

    return { status: 'success', id };
}

export async function deleteRecipe(id) {
    await db.collection('recipes').doc(id).delete();
    return { status: 'success', id };
}
