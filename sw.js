// Permite usar la guía sin conexión. Con red siempre se pide la versión nueva; sin red se usa la copia guardada.
const COPIA = 'guia-estudio-v2';
const ARCHIVOS = ['./', 'index.html', 'estilos.css', 'app.js', 'datos.js', 'vendor/mathjax-tex-svg.js', 'manifest.webmanifest', 'icono-180.png', 'icono-512.png'];

self.addEventListener('install', (evento) => {
  self.skipWaiting();
  evento.waitUntil(caches.open(COPIA).then((copia) => copia.addAll(ARCHIVOS)).catch(() => {}));
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n !== COPIA).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;
  evento.respondWith(
    fetch(pedido)
      .then((respuesta) => {
        if (respuesta.ok) {
          const duplicado = respuesta.clone();
          caches.open(COPIA).then((copia) => copia.put(pedido, duplicado));
        }
        return respuesta;
      })
      .catch(() => caches.match(pedido, { ignoreSearch: true }).then((guardado) => guardado || caches.match('index.html'))),
  );
});
