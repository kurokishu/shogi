/* ==========================================================================
 * sw.js — オフラインで動かすためのサービスワーカー
 *   一度開けば、アプリ本体・定跡・思考エンジンを端末に保存し、
 *   以後は圏外・機内モードでも起動できる。
 *   （2台対戦だけは通信が必要）
 * ========================================================================== */
var VERSION = 'shogi-v4';
var FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/shogi.js',
  './js/engine.js',
  './js/book.js',
  './js/kifu.js',
  './js/ui.js',
  './js/app.js',
  './js/worker.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      // 1つでも失敗すると全部失敗するので、個別に入れる
      return Promise.all(FILES.map(function (f) {
        return c.add(new Request(f, { cache: 'reload' })).catch(function () { });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 2台対戦の通信はキャッシュしない（常に最新をとりにいく）
  if (url.pathname.indexOf('/api/') === 0) return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        // 裏で新しいものを取りに行き、次回から差し替える
        fetch(req).then(function (res) {
          if (res && res.ok) caches.open(VERSION).then(function (c) { c.put(req, res.clone()); });
        }).catch(function () { });
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
