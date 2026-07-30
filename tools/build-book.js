/* ==========================================================================
 * build-book.js — 定跡（オープニングブック）の自動生成
 *
 *   初期局面から幅優先で局面を展開し、各局面をエンジンで深く読ませて
 *   「評価値が最善に近い手」だけを定跡として記録する。
 *   人がよく指すかどうかではなく、読みの結果として良い手を採用する。
 *
 *   出力: js/book.js  （ブラウザ／Worker／Node のどれからでも読める形）
 *
 *   実行: node tools/build-book.js [局面数] [制限分]
 * ========================================================================== */
var fs = require('fs');
var path = require('path');
var S = require('../js/shogi.js');
var E = require('../js/engine.js');

var BUDGET = parseInt(process.argv[2] || '1800', 10);   // 記録する局面数の上限
var MINUTES = parseFloat(process.argv[3] || '45');      // 実時間の上限（分）
var MAX_PLY = 28;                                       // 何手目まで定跡にするか

/* 手数ごとの「採用する候補手の数」と「最善からの許容差(点)」
 * 序盤ほど広く取って、定跡から外れにくく＆棋譜が単調にならないようにする */
/* 幅を絞って「深さ」を優先する。序盤だけ枝分かれさせ、
 * それ以降は最善手1本を伸ばすことで、定跡が浅いまま終わるのを防ぐ。 */
function width(ply) { return ply < 2 ? 3 : ply < 6 ? 2 : 1; }
function margin(ply) { return ply < 6 ? 20 : 30; }
function thinkTime(ply) { return ply < 6 ? 2200 : ply < 14 ? 1100 : 750; }
function thinkDepth() { return 10; }

/* 手数を除いたSFEN（同じ局面は同じキーになる） */
function keyOf(pos) {
  var s = pos.toSfen();
  return s.replace(/\s+\d+$/, '');
}

var entries = Object.create(null);
var seen = Object.create(null);
var queue = [{ sfen: S.startpos().toSfen(), ply: 0 }];
var count = 0, searched = 0;
var t0 = Date.now();
var outPath = path.join(__dirname, '..', 'js', 'book.js');

function save(done) {
  var obj = {
    version: 1,
    built: new Date().toISOString().slice(0, 16).replace('T', ' '),
    positions: count,
    maxPly: MAX_PLY,
    complete: !!done,
    entries: entries
  };
  var js = '/* 自動生成された定跡。tools/build-book.js で作り直せます。\n' +
    '   生成日時: ' + obj.built + ' / 収録局面数: ' + count + ' */\n' +
    '(function (root) {\n  var BOOK = ' + JSON.stringify(obj) + ';\n' +
    '  if (typeof module === "object" && module.exports) module.exports = BOOK;\n' +
    '  else root.OpeningBook = BOOK;\n' +
    '})(typeof self !== "undefined" ? self : this);\n';
  fs.writeFileSync(outPath, js);
}

console.log('定跡の学習を開始します（上限 ' + BUDGET + '局面 / ' + MINUTES + '分）');

while (queue.length) {
  if (count >= BUDGET) { console.log('局面数の上限に達しました'); break; }
  if ((Date.now() - t0) / 60000 >= MINUTES) { console.log('時間の上限に達しました'); break; }

  var job = queue.shift();
  var pos = S.fromSfen(job.sfen);
  var key = keyOf(pos);
  if (seen[key]) continue;
  seen[key] = 1;

  // useBook:false — 作りかけの定跡を参照してしまうと学習にならないので必ず切る
  var r = E.think(pos, {
    level: 10, depth: thinkDepth(), timeMs: thinkTime(job.ply),
    deterministic: true, useBook: false
  });
  searched++;
  if (!r.roots || !r.roots.length) continue;

  var best = r.roots[0].score;
  var keep = [];
  for (var i = 0; i < r.roots.length && keep.length < width(job.ply); i++) {
    if (best - r.roots[i].score > margin(job.ply)) break;
    keep.push(r.roots[i]);
  }
  if (!keep.length) continue;

  entries[key] = keep.map(function (k) {
    return [S.moveToUsi(k.m), Math.round(k.score)];
  });
  count++;

  if (job.ply + 1 < MAX_PLY) {
    for (var j = 0; j < keep.length; j++) {
      pos.doMove(keep[j].m);
      var childKey = keyOf(pos);
      if (!seen[childKey]) queue.push({ sfen: pos.toSfen(), ply: job.ply + 1 });
      pos.undoMove();
    }
  }

  if (count % 25 === 0) {
    var el = (Date.now() - t0) / 1000;
    console.log('  ' + count + '局面 / ' + job.ply + '手目 / 残り待ち' + queue.length +
      ' / 経過' + Math.round(el) + '秒 / 深さ' + r.depth + ' 評価' + best);
    save(false);
  }
}

save(true);
var el2 = Math.round((Date.now() - t0) / 1000);
console.log('完了: ' + count + '局面を js/book.js に保存しました（' + el2 + '秒）');
