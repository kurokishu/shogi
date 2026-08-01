/* ==========================================================================
 * worker.js — 思考エンジンを別スレッドで動かす（UIを固めないため）
 * ========================================================================== */
// 定跡ファイルは無くても動くように、先に読み込んでおく
try { importScripts('book.js'); } catch (e) { /* 定跡なし */ }
importScripts('shogi.js', 'engine.js');

var S = self.Shogi, E = self.Engine;
var abort = false;

function buildPos(msg) {
  var pos = (!msg.sfen || msg.sfen === 'startpos') ? S.startpos() : S.fromSfen(msg.sfen);
  if (msg.moves && msg.moves.length) {
    for (var i = 0; i < msg.moves.length; i++) {
      var m = S.usiToMove(pos, msg.moves[i]);
      if (m) pos.doMove(m);
    }
  }
  return pos;
}

self.onmessage = function (ev) {
  var d = ev.data || {};
  if (d.cmd === 'ping') { self.postMessage({ type: 'pong' }); return; }
  if (d.cmd === 'stop') { abort = true; E.stop(); return; }
  if (d.cmd === 'clear') { E.clearTT(); return; }
  if (d.cmd !== 'go') return;

  abort = false;
  var pos;
  try { pos = buildPos(d); }
  catch (e) { self.postMessage({ type: 'error', id: d.id, message: String(e) }); return; }

  var r;
  try {
    r = E.think(pos, {
      level: d.level, timeMs: d.timeMs, depth: d.depth,
      deterministic: !!d.deterministic, useBook: d.useBook !== false,
      abort: function () { return abort; },
      onInfo: function (info) {
        self.postMessage({
          type: 'info', id: d.id, depth: info.depth, seldepth: info.seldepth,
          score: info.score, nodes: info.nodes, time: info.time,
          pv: info.pv.map(S.moveToUsi)
        });
      }
    });
  } catch (e) {
    self.postMessage({ type: 'error', id: d.id, message: String(e && e.stack || e) });
    return;
  }

  self.postMessage({
    type: 'bestmove', id: d.id,
    move: r.move ? S.moveToUsi(r.move) : '',
    best: r.best ? S.moveToUsi(r.best) : '',
    score: r.score, depth: r.depth, nodes: r.nodes, time: r.time,
    pv: (r.pv || []).map(S.moveToUsi),
    /* 各候補手の評価値。戦法どおりに指してよいかの判断に使う */
    roots: (r.roots || []).map(function (x) { return [S.moveToUsi(x.m), x.score]; }),
    book: !!r.book, aborted: abort
  });
};
