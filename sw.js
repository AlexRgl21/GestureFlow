const CACHE_NAME = 'gesturecontrol-vFinal';

// Lista de archivos vitales. Si falta uno aquí, la app no funciona offline.
const STATIC_FILES = [
  './',
  './index.html',
  './style.css',
  './app_module.js',
  './classify.js',
  './logger.js',
  './manifest.json'
];

// EVENTO INSTALL: Se dispara la primera vez que entras
self.addEventListener('install', evt => {
  evt.waitUntil(
    // Abre el cajón 'gesturecontrol' y mete todos los archivos
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting();
});

// EVENTO ACTIVATE: Limpieza (borrar cachés viejos si actualizas)
self.addEventListener('activate', evt => {
  evt.waitUntil(self.clients.claim());
});

// EVENTO FETCH: Intercepta cada petición de red
self.addEventListener('fetch', evt => {
  evt.respondWith(
    // Primero mira si el archivo está en caché. Si no, bájalo de internet.
    caches.match(evt.request).then(res => res || fetch(evt.request))
  );
});