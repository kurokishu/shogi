/* ==========================================================================
 * research-line.js — 特定の戦法を深く研究して、定跡に足す
 *
 *   build-book.js が初期局面から広く浅く調べるのに対し、こちらは
 *   「指定した戦法を自分が指す」前提で、相手の応手だけを広げて深く読む。
 *   その戦法のレパートリーを作るための道具。
 *
 *   自分の手番 : 戦法どおりの手を1本だけ伸ばす（研究したい形に集中する）
 *   相手の手番 : 有力な応手を複数ぶら下げる（外されたときに困らないように）
 *
 *   実行: node tools/research-line.js <戦法id> <先手|後手> [制限分] [応手の幅]
 *   例  : node tools/research-line.js kurotaki78 先手 25 3
 * ========================================================================== */
var fs = require('fs');
var path = require('path');
var S = require('../js/shogi.js');
var E = require('../js/engine.js');
var St = require('../js/strategy.js');

var STRAT = process.argv[2] || 'kurotaki78';
var HERO = (process.argv[3] === '先手' || process.argv[3] === 'b') ? 1 : -1;
var MINUTES = parseFloat(process.argv[4] || '25');
var WIDTH = parseInt(process.argv[5] || '3', 10);      // 相手の応手をいくつ調べるか
var MAX_PLY = 40;                                       // 何手目まで研究するか
var THINK_MS = 3500;                                    // 1局面あたりの読みの長さ

var BOOK_PATH = path.join(__dirname, '..', 'js', 'book-' + STRAT + '.js');
var VAR_NAME = 'BOOK_' + STRAT.toUpperCase();

function keyOf(pos) {
  var f = pos.toSfen().split(' ');
  return f[0] + ' ' + f[1] + ' ' + f[2];
}

/* その戦法の研究定跡を読み込んで、そこに足していく（無ければ新規） */
function loadBook() {
  if (!fs.existsSync(BOOK_PATH)) {
    return { version: 1, built: '', strategy: STRAT, positions: 0, entries: {} };
  }
  var src = fs.readFileSync(BOOK_PATH, 'utf8');
  var i = src.indexOf('var ' + VAR_NAME + ' = ');
  var j = src.lastIndexOf('};');
  var json = src.slice(i + ('var ' + VAR_NAME + ' = ').length, j + 1);
  return JSON.parse(json);
}

var stName = St.get(STRAT).name;
var book = loadBook();
var entries = book.entries;
var before = Object.keys(entries).length;

function stamp() {
  var d = new Date();
  function z(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) +
    ' ' + z(d.getHours()) + ':' + z(d.getMinutes());
}

function save() {
  book.built = stamp();
  book.positions = Object.keys(entries).length;
  var out = '/* ' + stName + 'の研究定跡。tools/research-line.js で作り直せます。\n' +
    '   通常の定跡とは別に持ち、この戦法を選んだときだけ使う。\n' +
    '   生成日時: ' + book.built + ' / 収録局面数: ' + book.positions + ' */\n' +
    '(function (root) {\n  var ' + VAR_NAME + ' = ' + JSON.stringify(book) + ';\n' +
    '  if (typeof module === "object" && module.exports) module.exports = ' + VAR_NAME + ';\n' +
    '  else root.' + VAR_NAME + ' = ' + VAR_NAME + ';\n' +
    '})(typeof self !== "undefined" ? self : this);\n';
  fs.writeFileSync(BOOK_PATH, out);
}

console.log('書き出し先: ' + BOOK_PATH);
console.log('研究: ' + stName + '（' + (HERO > 0 ? '先手' : '後手') + '番）');
console.log('相手の応手を' + WIDTH + '手ずつ、' + MAX_PLY + '手目まで、1局面' + THINK_MS + 'msで読みます');
console.log('既存の定跡: ' + before + '局面\n');

var t0 = Date.now();
var limit = MINUTES * 60 * 1000;
var queue = [{ sfen: S.startpos().toSfen(), ply: 0 }];
var seen = {}, added = 0, searched = 0, offLine = 0;

while (queue.length) {
  if (Date.now() - t0 > limit) { console.log('時間切れで打ち切りました'); break; }
  var job = queue.shift();
  var pos = S.fromSfen(job.sfen);
  var key = keyOf(pos);
  if (seen[key]) continue;
  seen[key] = 1;

  var st = S.gameStatus(pos);
  if (st !== 'ok') continue;

  var myTurn = (pos.side === HERO);

  /* 自分の手番で、戦法の手がまだ残っているなら、その手を主軸にする */
  var stratMove = myTurn ? St.nextMove(pos, STRAT, MAX_PLY) : 0;

  var r = E.think(pos, {
    level: 10, depth: 16, timeMs: THINK_MS,
    deterministic: true, useBook: false
  });
  searched++;
  if (!r.roots || !r.roots.length) continue;

  var keep = [];
  if (stratMove) {
    /* 戦法の手の評価値を、読みの結果から拾う */
    for (var i = 0; i < r.roots.length; i++) {
      if (r.roots[i].m === stratMove) { keep.push(r.roots[i]); break; }
    }
    if (!keep.length) keep.push({ m: stratMove, score: r.roots[0].score });
    /* 戦法どおりだと大きく損をする局面だけ、最善手に戻す。
       ここを厳しくしすぎると、少しの差ですぐ別の戦型に逸れて研究にならない。 */
    if (r.roots[0].score - keep[0].score > 700) {
      offLine++;
      keep = [r.roots[0]];
      stratMove = 0;
    }
  } else {
    /* 相手の手番、または戦法を指し終えたあと */
    var w = myTurn ? 1 : WIDTH;
    for (var j = 0; j < r.roots.length && keep.length < w; j++) {
      if (r.roots[0].score - r.roots[j].score > 60) break;
      keep.push(r.roots[j]);
    }
  }
  if (!keep.length) continue;

  if (myTurn) {
    entries[key] = keep.map(function (k) {
      return [S.moveToUsi(k.m), Math.round(k.score)];
    });
    added++;
  }

  if (job.ply + 1 < MAX_PLY) {
    for (var q = 0; q < keep.length; q++) {
      pos.doMove(keep[q].m);
      if (!seen[keyOf(pos)]) queue.push({ sfen: pos.toSfen(), ply: job.ply + 1 });
      pos.undoMove();
    }
  }

  if (myTurn && added % 10 === 0) {
    console.log('  ' + added + '局面 / ' + job.ply + '手目 / 待ち' + queue.length +
      ' / ' + Math.round((Date.now() - t0) / 1000) + '秒 / 深さ' + r.depth +
      ' 評価' + Math.round(keep[0].score) + (stratMove ? ' ←戦法どおり' : ''));
    save();
  }
}

save();
console.log('\n完了: ' + added + '局面を研究しました（' + searched + '局面を読み、' +
  Object.keys(entries).length + '局面の定跡になりました）');
if (offLine) console.log('うち' + offLine + '局面は、戦法どおりだと損なので最善手に切り替えました');
