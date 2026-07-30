/* ==========================================================================
 * sw.js — オフラインで動かすためのサービスワーカー
 *   一度開けば、アプリ本体・定跡・思考エンジンを端末に保存し、
 *   以後は圏外・機内モードでも起動できる。
 *   （2台対戦だけは通信が必要）
 * ========================================================================== */
var VERSION = 'shogi-v11';
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
  './fonts/koma-kaisho.woff2',
  './fonts/koma-kaisho-r.woff2',
  './img/board.png',
  './img/koma.png',
  './img/koma-gote.png',
  './fonts/koma-brush.woff2',
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

/* 通信できるときは最新を取りに行き、取れなければ保存済みを使う。
 * （更新がすぐ届き、圏外でも起動できる） */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 2台対戦の通信はキャッシュを挟まない
  if (url.pathname.indexOf('/api/') === 0) return;
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    new Promise(function (resolve) {
      var settled = false;
      function done(res) { if (!settled) { settled = true; resolve(res); } }

      // 3秒で応答が無ければ保存済みに切り替える（電波が弱くても待たされない）
      var timer = setTimeout(function () {
        caches.match(req).then(function (hit) { if (hit) done(hit); });
      }, 3000);

      fetch(req).then(function (res) {
        clearTimeout(timer);
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
          done(res);
        } else {
          caches.match(req).then(function (hit) { done(hit || res); });
        }
      }).catch(function () {
        clearTimeout(timer);
        caches.match(req).then(function (hit) {
          done(hit || caches.match('./index.html'));
        });
      });
    })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
