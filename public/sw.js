const CACHE_NAME = "v2";
const urlsToCache = [
  "./",
  "./test.html",
  "./manifest.json",
  "./C69P2W_newllo.png",
  "./C69P2W_newllo.png"
];

// Install event: cache all files
self.addEventListener("install", (event) => {
  console.log("Service Worker: Installed");
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// Activate event: clean old caches
self.addEventListener("activate", (event) => {
  console.log("Service Worker: Activated");
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    )
  );
});

// Fetch event: serve from cache, fallback to network
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
