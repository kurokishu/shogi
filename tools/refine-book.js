/* ==========================================================================
 * refine-book.js — 定跡の序盤部分を、より長い時間で読み直して精査する
 *
 *   よく使われるのは序盤の浅い局面なので、そこだけ時間をかけて読み直し、
 *   評価が落ちる候補手を削る。build-book.js の後に実行する。
 *
 *   実行: node tools/refine-book.js [対象の手数] [1局面あたりの秒数]
 *         例) node tools/refine-book.js 8 6
 * ========================================================================== */
var fs = require('fs');
var path = require('path');
var S = require('../js/shogi.js');
var E = require('../js/engine.js');

var MAX_PLY = parseInt(process.argv[2] || '8', 10);
var SEC = parseFloat(process.argv[3] || '6');
var MARGIN = 20;

var bookPath = path.join(__dirname, '..', 'js', 'book.js');
var BOOK = require('../js/book.js');
if (!BOOK || !BOOK.entries) { console.error('js/book.js が見つかりません'); process.exit(1); }

function keyOf(pos) { return pos.toSfen().replace(/\s+\d+$/, ''); }

/* 定跡の手をたどって、各局面の手数を割り出す */
var plyOf = Object.create(null);
(function walk() {
  var start = S.startpos();
  var queue = [{ sfen: start.toSfen(), ply: 0 }];
  var seen = Object.create(null);
  while (queue.length) {
    var job = queue.shift();
    var pos = S.fromSfen(job.sfen);
    var key = keyOf(pos);
    if (seen[key]) continue;
    seen[key] = 1;
    plyOf[key] = job.ply;
    var e = BOOK.entries[key];
    if (!e || job.ply + 1 > MAX_PLY) continue;
    for (var i = 0; i < e.length; i++) {
      var m = S.usiToMove(pos, e[i][0]);
      if (!m) continue;
      pos.doMove(m);
      queue.push({ sfen: pos.toSfen(), ply: job.ply + 1 });
      pos.undoMove();
    }
  }
})();

var targets = Object.keys(BOOK.entries).filter(function (k) {
  return plyOf[k] !== undefined && plyOf[k] < MAX_PLY;
});
console.log(MAX_PLY + '手目までの ' + targets.length + ' 局面を、1局面 ' + SEC + ' 秒で読み直します');
console.log('（見込み ' + Math.round(targets.length * SEC / 60) + ' 分）');

var t0 = Date.now(), changed = 0, pruned = 0;
targets.forEach(function (key, idx) {
  var pos = S.fromSfen(key + ' 1');
  var r = E.think(pos, {
    level: 10, depth: 14, timeMs: Math.round(SEC * 1000),
    deterministic: true, useBook: false
  });
  if (!r.roots || !r.roots.length) return;
  var best = r.roots[0].score;
  var width = plyOf[key] < 2 ? 3 : 2;
  var keep = [];
  for (var i = 0; i < r.roots.length && keep.length < width; i++) {
    if (best - r.roots[i].score > MARGIN) break;
    keep.push([S.moveToUsi(r.roots[i].m), Math.round(r.roots[i].score)]);
  }
  if (!keep.length) return;
  var before = BOOK.entries[key];
  if (before[0][0] !== keep[0][0]) changed++;
  if (keep.length < before.length) pruned += before.length - keep.length;
  BOOK.entries[key] = keep;
  if ((idx + 1) % 10 === 0) {
    console.log('  ' + (idx + 1) + '/' + targets.length +
      ' 経過' + Math.round((Date.now() - t0) / 1000) + '秒 / 深さ' + r.depth);
  }
});

BOOK.refined = { maxPly: MAX_PLY, sec: SEC, at: new Date().toISOString().slice(0, 16).replace('T', ' ') };
var js = '/* 自動生成された定跡。tools/build-book.js で作り直せます。\n' +
  '   生成日時: ' + BOOK.built + ' / 収録局面数: ' + BOOK.positions +
  ' / 序盤精査: ' + MAX_PLY + '手目まで ' + SEC + '秒 */\n' +
  '(function (root) {\n  var BOOK = ' + JSON.stringify(BOOK) + ';\n' +
  '  if (typeof module === "object" && module.exports) module.exports = BOOK;\n' +
  '  else root.OpeningBook = BOOK;\n' +
  '})(typeof self !== "undefined" ? self : this);\n';
fs.writeFileSync(bookPath, js);
console.log('完了: 最善手が変わった局面 ' + changed + ' / 削った候補手 ' + pruned +
  '（' + Math.round((Date.now() - t0) / 1000) + '秒）');
