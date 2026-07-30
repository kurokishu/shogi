/* ==========================================================================
 * server.js — 静的ファイル配信 ＋ 2台対戦の中継サーバー
 *   Node.js だけで動く（追加インストール不要）
 *   実行: node server.js [ポート]
 *
 *   同じWi-Fiにいるスマホ2台から  http://<このPCのIP>:8777/  を開けば対戦できる。
 *   対局の進行（指し手の列）だけを預かる仕組みで、ルール判定は各端末側で行う。
 * ========================================================================== */
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var url = require('url');

var PORT = parseInt(process.argv[2] || process.env.PORT || '8777', 10);
var ROOT = __dirname;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.kif': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

/* ---------------- 対局部屋 ---------------- */
var rooms = Object.create(null);
var ROOM_TTL = 6 * 60 * 60 * 1000;   // 6時間放置で破棄
/* 待ち受けの上限。クラウドの中継機に切られないよう短めにしている */
var POLL_TIMEOUT = parseInt(process.env.POLL_TIMEOUT || '20000', 10);

function newId() {
  var s = '';
  for (var i = 0; i < 4; i++) s += Math.floor(Math.random() * 10);
  return rooms[s] ? newId() : s;
}
function token() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}
function roomState(r) {
  return {
    room: r.id, version: r.version,
    black: r.black ? r.black.name : null,
    white: r.white ? r.white.name : null,
    startSfen: r.startSfen,
    moves: r.moves,
    result: r.result,
    rules: r.rules,
    started: !!(r.black && r.white)
  };
}
function bump(r) {
  r.version++;
  r.touched = Date.now();
  var ws = r.waiters; r.waiters = [];
  for (var i = 0; i < ws.length; i++) {
    clearTimeout(ws[i].timer);
    sendJson(ws[i].res, 200, roomState(r));
  }
}
function sideOf(r, tk) {
  if (r.black && r.black.token === tk) return 1;
  if (r.white && r.white.token === tk) return -1;
  return 0;
}
setInterval(function () {
  var now = Date.now();
  for (var k in rooms) if (now - rooms[k].touched > ROOM_TTL) delete rooms[k];
}, 10 * 60 * 1000);

/* ---------------- HTTP ---------------- */
function sendJson(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function readBody(req, cb) {
  var data = '';
  req.on('data', function (c) {
    data += c;
    if (data.length > 1e6) { req.destroy(); }
  });
  req.on('end', function () {
    try { cb(data ? JSON.parse(data) : {}); }
    catch (e) { cb(null); }
  });
}

function localIPs() {
  var out = [], ifs = os.networkInterfaces();
  for (var name in ifs) {
    (ifs[name] || []).forEach(function (i) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    });
  }
  return out;
}

function handleApi(req, res, pathname, query) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (pathname === '/api/info') {
    return sendJson(res, 200, { ok: true, ips: localIPs(), port: PORT, rooms: Object.keys(rooms).length });
  }

  if (pathname === '/api/create') {
    return readBody(req, function (b) {
      if (!b) return sendJson(res, 400, { error: 'bad request' });
      var id = newId();
      var tk = token();
      var side = b.side === -1 ? -1 : (b.side === 1 ? 1 : (Math.random() < .5 ? 1 : -1));
      var r = {
        id: id, version: 1, moves: [], result: null, waiters: [],
        touched: Date.now(), startSfen: b.startSfen || 'startpos',
        rules: b.rules || {}, black: null, white: null
      };
      var me = { token: tk, name: String(b.name || '対局者').slice(0, 12) };
      if (side > 0) r.black = me; else r.white = me;
      rooms[id] = r;
      return sendJson(res, 200, { room: id, token: tk, side: side, state: roomState(r) });
    });
  }

  if (pathname === '/api/join') {
    return readBody(req, function (b) {
      if (!b) return sendJson(res, 400, { error: 'bad request' });
      var r = rooms[String(b.room || '').trim()];
      if (!r) return sendJson(res, 404, { error: '部屋が見つかりません' });
      // 再接続
      if (b.token) {
        var s = sideOf(r, b.token);
        if (s) return sendJson(res, 200, { room: r.id, token: b.token, side: s, state: roomState(r) });
      }
      var side = r.black ? -1 : 1;
      if (r.black && r.white) return sendJson(res, 409, { error: 'その部屋は満員です' });
      var tk = token();
      var me = { token: tk, name: String(b.name || '対局者').slice(0, 12) };
      if (side > 0) r.black = me; else r.white = me;
      bump(r);
      return sendJson(res, 200, { room: r.id, token: tk, side: side, state: roomState(r) });
    });
  }

  if (pathname === '/api/state') {
    var r2 = rooms[String(query.room || '').trim()];
    if (!r2) return sendJson(res, 404, { error: '部屋が見つかりません' });
    var since = parseInt(query.v || '0', 10);
    r2.touched = Date.now();
    if (r2.version > since) return sendJson(res, 200, roomState(r2));
    var w = { res: res, timer: null };
    w.timer = setTimeout(function () {
      var i = r2.waiters.indexOf(w);
      if (i >= 0) r2.waiters.splice(i, 1);
      sendJson(res, 200, roomState(r2));
    }, POLL_TIMEOUT);
    r2.waiters.push(w);
    req.on('close', function () {
      var i = r2.waiters.indexOf(w);
      if (i >= 0) { r2.waiters.splice(i, 1); clearTimeout(w.timer); }
    });
    return;
  }

  if (pathname === '/api/move') {
    return readBody(req, function (b) {
      if (!b) return sendJson(res, 400, { error: 'bad request' });
      var r = rooms[String(b.room || '').trim()];
      if (!r) return sendJson(res, 404, { error: '部屋が見つかりません' });
      var s = sideOf(r, b.token);
      if (!s) return sendJson(res, 403, { error: 'この部屋の対局者ではありません' });
      if (r.result) return sendJson(res, 409, { error: '対局は終了しています' });
      // 手番チェック（先手が偶数番目、後手が奇数番目）
      var turn = (r.moves.length % 2 === 0) ? 1 : -1;
      if (s !== turn) return sendJson(res, 409, { error: '相手の手番です', state: roomState(r) });
      if (typeof b.ply === 'number' && b.ply !== r.moves.length) {
        return sendJson(res, 409, { error: '手数が合いません', state: roomState(r) });
      }
      r.moves.push({ usi: String(b.usi), sec: Math.max(0, Math.min(36000, b.sec || 0)) });
      bump(r);
      return sendJson(res, 200, roomState(r));
    });
  }

  if (pathname === '/api/end') {
    return readBody(req, function (b) {
      if (!b) return sendJson(res, 400, { error: 'bad request' });
      var r = rooms[String(b.room || '').trim()];
      if (!r) return sendJson(res, 404, { error: '部屋が見つかりません' });
      if (!sideOf(r, b.token)) return sendJson(res, 403, { error: 'この部屋の対局者ではありません' });
      if (!r.result) {
        r.result = { winner: b.winner | 0, text: String(b.text || '終局').slice(0, 60), kif: String(b.kif || '') };
        bump(r);
      }
      return sendJson(res, 200, roomState(r));
    });
  }

  return sendJson(res, 404, { error: 'not found' });
}

var server = http.createServer(function (req, res) {
  var u = url.parse(req.url, true);
  var pathname = decodeURIComponent(u.pathname);

  if (pathname.indexOf('/api/') === 0) return handleApi(req, res, pathname, u.query);

  if (pathname === '/') pathname = '/index.html';
  var file = path.join(ROOT, pathname);
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end('forbidden'); }

  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('見つかりません: ' + pathname); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', function () {
  var ips = localIPs();
  console.log('================================================');
  console.log(' 将棋アプリ サーバー起動');
  console.log('   このPC   : http://localhost:' + PORT + '/');
  ips.forEach(function (ip) {
    console.log('   スマホから: http://' + ip + ':' + PORT + '/');
  });
  console.log('');
  console.log(' 2台対戦は、同じWi-Fiにつないだ端末で上のURLを開き、');
  console.log(' 「2台で対戦」タブから部屋を作る／参加してください。');
  console.log(' 終了するには Ctrl+C');
  console.log('================================================');
});
