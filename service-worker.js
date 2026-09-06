// service-worker.js — deixa o app instalável e funcionando offline.
// Estratégia simples: cache-first pra tudo (o app não depende de nenhuma
// rede depois de carregado — todo dado é local, todo script é vendorizado).
// Bump no nome do CACHE quando os arquivos abaixo mudarem de verdade.
const CACHE = 'financeiro-v52';
const ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/chart/chart.min.js',
  './vendor/chart/chartjs-plugin-datalabels.min.js',
  './vendor/sqljs/sql-wasm.js',
  './vendor/sqljs/sql-wasm.wasm',
  './js/datas.js',
  './js/dinheiro.js',
  './js/mapeamentos.js',
  './js/db.js',
  './js/dados.js',
  './js/app.js',
  './db/schema.sql',
  './db/views.sql',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (evt) => {
  evt.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
  if (evt.request.method !== 'GET') return;
  evt.respondWith(caches.match(evt.request).then((resposta) => resposta || fetch(evt.request)));
});
