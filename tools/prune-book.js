/* ==========================================================================
 * prune-book.js — 定跡の浅い部分から「最善に及ばない候補手」を削る
 *
 *   refine-book.js で読み直した後に使う。読み直しはせず、
 *   すでに記録されている評価値だけを見て候補を絞るので一瞬で終わる。
 *
 *   実行: node tools/prune-book.js [対象の手数] [許容差]
 *         例) node tools/prune-book.js 2 8
 * ========================================================================== */
var fs = require('fs');
var path = require('path');
var S = require('../js/shogi.js');

var MAX_PLY = parseInt(process.argv[2] || '2', 10);
var MARGIN = parseInt(process.argv[3] || '8', 10);

var bookPath = path.join(__dirname, '..', 'js', 'book.js');
var BOOK = require('../js/book.js');

function keyOf(pos) { return pos.toSfen().replace(/\s+\d+$/, ''); }

/* 定跡をたどって手数を割り出す */
var plyOf = Object.create(null);
(function walk() {
  var queue = [{ sfen: S.startpos().toSfen(), ply: 0 }], seen = Object.create(null);
  while (queue.length) {
    var job = queue.shift();
    var pos = S.fromSfen(job.sfen), key = keyOf(pos);
    if (seen[key]) continue;
    seen[key] = 1;
    plyOf[key] = job.ply;
    var e = BOOK.entries[key];
    if (!e || job.ply >= MAX_PLY) continue;
    for (var i = 0; i < e.length; i++) {
      var m = S.usiToMove(pos, e[i][0]);
      if (!m) continue;
      pos.doMove(m);
      queue.push({ sfen: pos.toSfen(), ply: job.ply + 1 });
      pos.undoMove();
    }
  }
})();

var removed = 0, touched = 0;
Object.keys(BOOK.entries).forEach(function (key) {
  if (plyOf[key] === undefined || plyOf[key] >= MAX_PLY) return;
  var e = BOOK.entries[key], best = e[0][1];
  var keep = e.filter(function (x) { return best - x[1] <= MARGIN; });
  if (keep.length && keep.length < e.length) {
    console.log('  ' + plyOf[key] + '手目: ' +
      e.filter(function (x) { return keep.indexOf(x) < 0; }).map(function (x) { return x[0] + '(' + x[1] + ')'; }).join(' ') +
      ' を削除（最善 ' + e[0][0] + ' ' + best + '）');
    removed += e.length - keep.length;
    BOOK.entries[key] = keep;
    touched++;
  }
});

var js = '/* 自動生成された定跡。tools/build-book.js で作り直せます。\n' +
  '   生成日時: ' + BOOK.built + ' / 収録局面数: ' + BOOK.positions + ' */\n' +
  '(function (root) {\n  var BOOK = ' + JSON.stringify(BOOK) + ';\n' +
  '  if (typeof module === "object" && module.exports) module.exports = BOOK;\n' +
  '  else root.OpeningBook = BOOK;\n' +
  '})(typeof self !== "undefined" ? self : this);\n';
fs.writeFileSync(bookPath, js);
console.log('完了: ' + touched + '局面から ' + removed + ' 手を削りました');
