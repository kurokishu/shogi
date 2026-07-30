/* ルールエンジンの検証: perft（初期局面からの合法手数え上げ）
 * 既知の正解値: 1手=30, 2手=900, 3手=25470, 4手=719731
 * 実行: node test/perft.js [最大深さ]
 */
var S = require('../js/shogi.js');

function perft(pos, d) {
  var ls = pos.legalMoves();
  if (d === 1) return ls.length;
  var n = 0;
  for (var i = 0; i < ls.length; i++) { pos.doMove(ls[i]); n += perft(pos, d - 1); pos.undoMove(); }
  return n;
}

var EXPECT = { 1: 30, 2: 900, 3: 25470, 4: 719731 };
var maxD = parseInt(process.argv[2] || '4', 10);
var pos = S.startpos();
console.log('初期局面 SFEN:', pos.toSfen());
var fail = 0;
for (var d = 1; d <= maxD; d++) {
  var t = Date.now();
  var n = perft(pos, d);
  var ms = Date.now() - t;
  var ok = EXPECT[d] === undefined ? '(参考)' : (n === EXPECT[d] ? 'OK' : 'NG 期待値=' + EXPECT[d]);
  if (EXPECT[d] !== undefined && n !== EXPECT[d]) fail++;
  console.log('perft(' + d + ') = ' + n + '  ' + ok + '  ' + ms + 'ms');
}

/* SFEN 往復 & 局面ハッシュの整合性 */
var s0 = pos.toSfen();
console.log('SFEN往復:', S.fromSfen(s0).toSfen() === s0 ? 'OK' : 'NG');

(function keyTest() {
  var p = S.startpos(), bad = 0;
  function walk(d) {
    var ls = p.legalMoves();
    for (var i = 0; i < Math.min(ls.length, 6); i++) {
      p.doMove(ls[i]);
      var lo = p.keyLo, hi = p.keyHi;
      var chk = S.fromSfen(p.toSfen());
      if (chk.keyLo !== lo || chk.keyHi !== hi) bad++;
      if (d > 1) walk(d - 1);
      p.undoMove();
    }
  }
  walk(3);
  console.log('Zobrist増分更新:', bad === 0 ? 'OK' : 'NG (' + bad + '件)');
  if (bad) fail++;
})();

/* 打ち歩詰め:
 *   後手玉9一・後手香8一（自陣の駒で塞がっている）・先手金8三
 *   先手が9二に歩を打つと詰み → 打ち歩詰めなので反則
 *   香を外して玉が8一へ逃げられる形なら、同じ歩打は合法
 */
(function uchifuzume() {
  function canDropPawn(sfen, file, rank) {
    var p = S.fromSfen(sfen), ls = p.legalMoves(), sq = S.sqOf(file, rank);
    for (var i = 0; i < ls.length; i++) {
      if (S.mvIsDrop(ls[i]) && S.mvDropPiece(ls[i]) === S.FU && S.mvTo(ls[i]) === sq) return true;
    }
    return false;
  }
  var bad = canDropPawn('kl7/9/1G7/9/9/9/9/9/8K b P 1', 9, 2);
  console.log('打ち歩詰め禁止:', !bad ? 'OK' : 'NG（9二歩打が生成された）');
  if (bad) fail++;
  var good = canDropPawn('k8/9/1G7/9/9/9/9/9/8K b P 1', 9, 2);
  console.log('詰まない歩打は合法:', good ? 'OK' : 'NG（9二歩打が生成されない）');
  if (!good) fail++;
})();

/* 二歩の禁止 */
(function nifu() {
  var p = S.fromSfen('k8/9/9/9/9/9/P8/9/8K b P 1');
  var ls = p.legalMoves(), bad = false;
  for (var i = 0; i < ls.length; i++) {
    if (S.mvIsDrop(ls[i]) && S.mvDropPiece(ls[i]) === S.FU && S.fileOf(S.mvTo(ls[i])) === 9) bad = true;
  }
  console.log('二歩禁止:', !bad ? 'OK' : 'NG');
  if (bad) fail++;
})();

/* 詰み判定: 頭金 */
(function mateTest() {
  var p = S.fromSfen('4k4/4G4/4G4/9/9/9/9/9/4K4 w - 1');
  console.log('詰み判定:', S.gameStatus(p) === 'mate' ? 'OK' : 'NG (' + S.gameStatus(p) + ')');
  if (S.gameStatus(p) !== 'mate') fail++;
})();

/* 成り強制: 先手の桂が1段目へ行くとき成のみ */
(function forcedPromo() {
  var p = S.fromSfen('9/9/2N6/9/9/9/9/9/4K4 b - 1');
  var ls = p.legalMoves(), nonProm = 0;
  for (var i = 0; i < ls.length; i++) {
    if (!S.mvIsDrop(ls[i]) && S.rankOf(S.mvTo(ls[i])) === 1 && !S.mvPromo(ls[i])) nonProm++;
  }
  console.log('桂の成り強制:', nonProm === 0 ? 'OK' : 'NG');
  if (nonProm) fail++;
})();

console.log(fail === 0 ? '\n=== 全テスト成功 ===' : '\n=== 失敗 ' + fail + ' 件 ===');
process.exit(fail ? 1 : 0);
