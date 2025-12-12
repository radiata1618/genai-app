const CACHE_NAME = 'genai-app-v1';

self.addEventListener('install', (event) => {
    // Force the waiting service worker to become the active service worker.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Tell the active service worker to take control of the page immediately.
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    // A simple pass-through fetch handler is required for PWA installation criteria.
    // We are NOT doing aggressive caching here to prevent stale data issues during development.
    // The app relies on its own localStorage caching logic for speed.
    event.respondWith(fetch(event.request));
});
