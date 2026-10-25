// Service worker of the browser (WebUSB) version: lets it start without internet and
// be installed as an app (PWA), e.g. on an Android phone used on the bike.
//
// Network first, so a page opened online always gets the current files (the UI and
// the server modules have to match), and each response refreshes the copy kept here.
// Offline, or when the network does not answer within NETWORK_TIMEOUT_MS, the kept
// copy is served. Everything the app needs is fetched on install, so it works offline
// right after the first visit, before any tab was opened.
'use strict';

const CACHE = 'bafang-canable-pro-v1';
const NETWORK_TIMEOUT_MS = 4000;

// Paths relative to this file (the repository root). Keep in step with what the page
// loads: ui/index.html, ui/js/*, ui/webusb/* and MODULES in ui/webusb/server-worker.js.
// Anything missing here is still cached the first time it is fetched online.
const PRECACHE = [
    './', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
    'ui/', 'ui/index.html', 'ui/style.css', 'ui/tailwind.js', 'ui/plotly-2.24.1.min.js',
    'ui/js/init.js', 'ui/js/shared.js', 'ui/js/websocket.js',
    'ui/js/tab-battery.js', 'ui/js/tab-controller.js', 'ui/js/tab-data-backup.js', 'ui/js/tab-debug.js',
    'ui/js/tab-display.js', 'ui/js/tab-firmware.js', 'ui/js/tab-gears.js', 'ui/js/tab-info.js',
    'ui/js/tab-ride-logger.js', 'ui/js/tab-sensor.js', 'ui/js/tab-sniffer.js',
    'ui/webusb/boot.js', 'ui/webusb/node-shim.js', 'ui/webusb/server-worker.js',
    'server.js', 'canbus.js', 'gsusb.js', 'canframe.js', 'bafang-parser.js', 'bafang-serializer.js',
    'request-manager.js', 'bafang-can-requests.js', 'bafang-constants.js',
    'bafang-can-read-commands.js', 'bafang-can-write-commands.js', 'bafang-can-broadcast-commands.js',
    'fw-updater.js', 'sniffer.js', 'logger.js', 'utils.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // One by one, so a single missing file does not leave the app uncached.
        await Promise.all(PRECACHE.map(async (path) => {
            try {
                const response = await fetch(new Request(path, { cache: 'reload' }));
                if (response.ok) await cache.put(path, response);
            } catch (e) { /* cached later, when fetched */ }
        }));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    // The app fetches its modules with cache: 'no-store'; the kept copy is keyed by URL.
    const key = new Request(request.url);
    const network = fetch(request).then((response) => {
        if (response.ok) cache.put(key, response.clone());
        return response;
    });
    network.catch(() => {}); // a late failure after the cache answered is not an error
    const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
    try {
        const response = await Promise.race([network, timeout]);
        if (response) return response;
    } catch (e) { /* offline: fall back to the kept copy */ }
    const cached = await cache.match(key, { ignoreSearch: true });
    if (cached) return cached;
    return network; // nothing kept: wait for the network after all, or fail with it
}
