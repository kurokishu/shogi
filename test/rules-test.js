/* 大会ルール周りのテスト
 *  ・二歩／打ち歩詰めが「反則手」として入力候補に出るか（大会ルール時）
 *  ・行き所のない駒・王手放置は、そもそも指せないか
 *  ・持将棋（24点法）の点数計算
 * 実行: node test/rules-test.js
 */
var S = require('../js/shogi.js');
var fail = 0;
function check(label, cond, extra) {
  console.log((cond ? 'OK  ' : 'NG  ') + label + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
}

/* ---- 二歩は「反則手」として出てくる（大会ルール） ---- */
(function () {
  var p = S.fromSfen('lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b P 1');
  var legal = p.legalMoves();
  var pawnDropsLegal = legal.filter(function (m) { return S.mvIsDrop(m) && S.mvDropPiece(m) === S.FU; });
  check('全ての筋に歩がある局面では歩を「合法に」打てない', pawnDropsLegal.length === 0);

  var withFouls = p.movesForInput(true);
  var nifu = withFouls.filter(function (e) { return e.foul === 'nifu'; });
  check('大会ルールでは二歩の手が入力候補に出る', nifu.length > 0, '(' + nifu.length + '通り)');

  var noFouls = p.movesForInput(false);
  check('初心者モードでは二歩は候補に出ない',
    noFouls.filter(function (e) { return e.foul; }).length === 0);
})();

/* ---- 打ち歩詰めも反則手として出る ---- */
(function () {
  var p = S.fromSfen('kl7/9/1G7/9/9/9/9/9/8K b P 1');
  var withFouls = p.movesForInput(true);
  var uchifu = withFouls.filter(function (e) { return e.foul === 'uchifu'; });
  check('打ち歩詰めが反則手として出る', uchifu.length === 1,
    uchifu.length ? '9二歩打' : '(出ていない)');
  var legal = p.legalMoves().filter(function (m) {
    return S.mvIsDrop(m) && S.mvDropPiece(m) === S.FU && S.mvTo(m) === S.sqOf(9, 2);
  });
  check('打ち歩詰めは合法手には含まれない', legal.length === 0);
})();

/* ---- 行き所のない駒は「反則手」にもならない（＝指せない） ---- */
(function () {
  var p = S.fromSfen('9/9/9/9/9/9/9/9/4K4 b PLN 1');
  var all = p.movesForInput(true);
  var bad = all.filter(function (e) {
    var m = e.m;
    if (!S.mvIsDrop(m)) return false;
    var pt = S.mvDropPiece(m), r = S.rankOf(S.mvTo(m));
    if ((pt === S.FU || pt === S.KY) && r === 1) return true;
    if (pt === S.KE && r <= 2) return true;
    return false;
  });
  check('行き所のない駒は打てない（歩香1段目・桂1〜2段目）', bad.length === 0, '(' + bad.length + '件)');

  var q = S.fromSfen('9/9/2N6/9/9/9/9/9/4K4 b - 1');
  var nonProm = q.movesForInput(true).filter(function (e) {
    return !S.mvIsDrop(e.m) && S.rankOf(S.mvTo(e.m)) === 1 && !S.mvPromo(e.m);
  });
  check('桂は1段目へ「不成」で進めない', nonProm.length === 0);
})();

/* ---- 王手放置（自殺手）は指せない ---- */
(function () {
  // 先手玉5九、後手飛車5一で王手。玉を横に逃げる以外の手は指せない
  var p = S.fromSfen('4r4/9/9/9/9/9/9/9/4K4 b - 1');
  var all = p.movesForInput(true);
  var stillInCheck = 0;
  for (var i = 0; i < all.length; i++) {
    p.doMove(all[i].m);
    if (p.isAttacked(p.kingSq[0], -1)) stillInCheck++;
    p.undoMove();
  }
  check('王手放置になる手は入力候補に出ない', stillInCheck === 0, '(' + stillInCheck + '件)');
})();

/* ---- 持将棋（24点法） ---- */
(function () {
  var p = S.fromSfen('4K4/9/9/9/9/9/9/9/4k4 b RB2G2S9P2Lrb2g2s9p 1');
  check('双方入玉の検出', p.bothEnteredCamp());
  check('点数計算（飛角5点・他1点）', S.points24(p, 1) === 25 && S.points24(p, -1) === 23,
    '先手' + S.points24(p, 1) + '点 / 後手' + S.points24(p, -1) + '点');
  var j = p.jishogiCheck();
  check('24点未満の側が負け', j.winner === 1, j.text);

  var q = S.fromSfen('4K4/9/9/9/9/9/9/9/4k4 b RB2G2S9P3LrbR2g2s9p2n 1');
  check('双方24点以上なら持将棋（引き分け）', q.jishogiCheck().winner === 0, q.jishogiCheck().text);

  // 入玉していなければ判定対象外
  var r = S.startpos();
  check('初期局面は双方入玉ではない', !r.bothEnteredCamp());
})();

/* ---- 27点法（入玉宣言）---- */
(function () {
  var p = S.fromSfen('4K4/9/9/9/9/9/9/9/4k4 b RB2G2S9P2Lrb2g2s9p 1');
  var d = p.declarationCheck(1);
  check('入玉宣言：条件不足なら宣言できない', !d.ok, d.reasons.join('/'));
})();

console.log(fail === 0 ? '\n=== ルールテスト成功 ===' : '\n=== 失敗 ' + fail + ' 件 ===');
process.exit(fail ? 1 : 0);
