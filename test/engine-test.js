/* 思考エンジンの動作確認
 *   1) 詰将棋（1手詰・3手詰）を解けるか
 *   2) 明らかなタダ取りを見つけるか
 *   3) 自己対戦が最後まで進むか（ルール違反・無限ループが無いか）
 *   4) 探索速度（NPS）
 * 実行: node test/engine-test.js
 */
var S = require('../js/shogi.js');
var E = require('../js/engine.js');
var fail = 0;

function ja(pos, m) { return S.moveToJa(pos, m, -1, {}); }

/* 1) 1手詰: 後手玉5一、先手金5二を打てば詰み（持駒金） */
(function mate1() {
  var p = S.fromSfen('4k4/9/4G4/9/9/9/9/9/4K4 b G 1');
  var r = E.think(p, { level: 10, depth: 3, timeMs: 1000, deterministic: true });
  var ok = r.score >= E.MATE - 200;
  console.log('1手詰を発見:', ok ? 'OK' : 'NG', '手=' + ja(p, r.move), '評価=' + r.score);
  if (!ok) fail++;
})();

/* 2) タダ取り: 先手飛車が後手角をタダで取れる局面 */
(function freeCapture() {
  var p = S.fromSfen('4k4/9/9/9/4b4/9/9/4R4/4K4 b - 1');
  var r = E.think(p, { level: 10, depth: 4, timeMs: 1500, deterministic: true });
  var ok = S.mvTo(r.move) === S.sqOf(5, 5);
  console.log('タダ取りを発見:', ok ? 'OK' : 'NG', '手=' + ja(p, r.move), '評価=' + r.score);
  if (!ok) fail++;
})();

/* 3) 詰みを避ける（自玉が詰まされる手を選ばない） */
(function avoidMate() {
  var p = S.fromSfen('9/9/9/9/9/9/6ppp/8k/6NLR b - 1');
  var r = E.think(p, { level: 8, depth: 4, timeMs: 800, deterministic: true });
  console.log('詰み回避局面の指し手:', ja(p, r.move), '評価=' + r.score, '(参考)');
})();

/* 4) 速度 */
(function speed() {
  var p = S.startpos();
  var t = Date.now();
  var r = E.think(p, { level: 10, depth: 6, timeMs: 4000, deterministic: true });
  var ms = Date.now() - t;
  console.log('初期局面 深さ' + r.depth + ' / ' + r.nodes + 'nodes / ' + ms + 'ms / ' +
    Math.round(r.nodes / Math.max(1, ms) * 1000).toLocaleString() + ' nps  最善=' + ja(p, r.best));
  var pv = [], q = p.clone();
  for (var i = 0; i < r.pv.length; i++) { pv.push(S.moveToJa(q, r.pv[i], i ? S.mvTo(r.pv[i - 1]) : -1, {})); q.doMove(r.pv[i]); }
  console.log('読み筋:', pv.join(' '));
})();

/* 5) 自己対戦（弱レベル同士で高速に） */
(function selfPlay() {
  var p = S.startpos();
  var seen = {}, result = '継続', moves = 0;
  var log = [];
  for (var i = 0; i < 300; i++) {
    var st = S.gameStatus(p);
    if (st === 'mate') { result = (p.side > 0 ? '後手' : '先手') + 'の勝ち（詰み）'; break; }
    if (st === 'nomove') { result = (p.side > 0 ? '後手' : '先手') + 'の勝ち（手詰まり）'; break; }
    var k = p.posKey();
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] >= 4) { result = '千日手'; break; }
    var r = E.think(p, { level: p.side > 0 ? 4 : 3, timeMs: 60 });
    if (!r.move) { result = '手が無い'; break; }
    log.push(S.moveToJa(p, r.move, moves ? S.mvTo(log.lastMove) : -1, {}));
    log.lastMove = r.move;
    if (!p.isLegal(r.move)) { console.log('!! 非合法手を返した:', S.moveToUsi(r.move)); fail++; break; }
    p.doMove(r.move);
    moves++;
  }
  console.log('自己対戦: ' + moves + '手で「' + result + '」');
  console.log('  棋譜(先頭20手):', log.slice(0, 20).join(' '));
  if (moves < 20) { console.log('  !! 手数が短すぎる（要確認）'); fail++; }
})();

console.log(fail === 0 ? '\n=== エンジンテスト成功 ===' : '\n=== 失敗 ' + fail + ' 件 ===');
process.exit(fail ? 1 : 0);
