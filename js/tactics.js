/* ==========================================================================
 * tactics.js — 戦法・囲い・手筋の成立を判定する
 *   先手基準で定義し、後手は上下左右を反転して同じ判定を使う。
 *   依存: shogi.js
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shogi.js'));
  else root.Tactics = factory(root.Shogi);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  var FU = S.FU, KY = S.KY, KE = S.KE, GI = S.GI, KI = S.KI, KA = S.KA, HI = S.HI, OU = S.OU;
  var TO = S.TO, UM = S.UM, RY = S.RY;

  /* 先手基準の (筋,段) を、その手番の升に読み替える */
  function sq(side, file, rank) {
    return side > 0 ? S.sqOf(file, rank) : S.sqOf(10 - file, 10 - rank);
  }
  function at(pos, side, file, rank, pt) {
    return pos.board[sq(side, file, rank)] === pt * side;
  }
  function pieceAt(pos, side, file, rank) {
    var v = pos.board[sq(side, file, rank)];
    return v === 0 ? 0 : (v * side);        // 自分の駒なら正、相手の駒なら負
  }

  /* ---------------- 囲い ----------------
   * 主要な囲いを、玉と守り駒の位置で判定する。
   * 手前にあるものから順に見て、最初に当たったものを返す。
   */
  var CASTLES = [
    { name: '居飛車穴熊', note: '玉を隅に押し込む最も堅い囲い',
      test: function (p, s) { return at(p, s, 9, 9, OU) && at(p, s, 9, 8, KY) && at(p, s, 8, 8, GI); } },
    { name: '振り飛車穴熊', note: '振り飛車から玉を隅へ',
      test: function (p, s) { return at(p, s, 1, 9, OU) && at(p, s, 1, 8, KY) && at(p, s, 2, 8, GI); } },
    { name: '銀冠', note: '美濃から銀を繰り替えた上部に強い形',
      test: function (p, s) { return at(p, s, 2, 8, OU) && at(p, s, 2, 7, GI) && at(p, s, 3, 8, KI); } },
    { name: '高美濃囲い', note: '美濃に金を足して上部を厚く',
      test: function (p, s) { return at(p, s, 2, 8, OU) && at(p, s, 3, 8, GI) && at(p, s, 4, 7, KI); } },
    { name: '美濃囲い', note: '振り飛車の定番。横からの攻めに強い',
      test: function (p, s) { return at(p, s, 2, 8, OU) && at(p, s, 3, 8, GI) && at(p, s, 4, 9, KI); } },
    { name: '矢倉囲い', note: '金銀三枚の堅陣。相居飛車の王道',
      test: function (p, s) { return at(p, s, 7, 7, GI) && at(p, s, 7, 8, KI) && at(p, s, 6, 7, KI); } },
    { name: '舟囲い', note: '対振り飛車の基本形。組むのが早い',
      test: function (p, s) { return at(p, s, 6, 8, OU) && at(p, s, 7, 8, GI) && at(p, s, 5, 8, KI); } },
    { name: '中住まい', note: '玉を中央に置き、横に広く構える',
      test: function (p, s) { return at(p, s, 5, 8, OU) && at(p, s, 4, 8, KI) && at(p, s, 6, 8, KI); } },
    { name: '金無双', note: '振り飛車の速い囲い',
      test: function (p, s) { return at(p, s, 3, 8, OU) && at(p, s, 4, 8, KI) && at(p, s, 5, 8, KI); } }
  ];

  function detectCastle(pos, side) {
    for (var i = 0; i < CASTLES.length; i++) {
      if (CASTLES[i].test(pos, side)) return CASTLES[i];
    }
    return null;
  }

  /* ---------------- 戦法 ----------------
   * 飛車がどの筋にいるかを軸に判定する。
   */
  function rookFile(pos, side) {
    for (var s2 = 0; s2 < 81; s2++) {
      var v = pos.board[s2];
      if (v === HI * side || v === RY * side) {
        return side > 0 ? S.fileOf(s2) : 10 - S.fileOf(s2);
      }
    }
    return 0;
  }

  function detectStrategy(pos, side) {
    var f = rookFile(pos, side);
    if (!f) return null;
    var ci = side > 0 ? 0 : 1;
    // 角交換
    var kakuGawari = pos.hands[0][KA] > 0 && pos.hands[1][KA] > 0;

    if (f === 7 && at(pos, side, 7, 5, FU)) return { name: '石田流', note: '三間飛車から7五歩と伸ばす急戦形' };
    if (f === 5) return { name: '中飛車', note: '飛車を中央に据えた攻めの形' };
    if (f === 6) return { name: '四間飛車', note: '振り飛車の代表格' };
    if (f === 7) return { name: '三間飛車', note: '飛車を3つめの筋へ' };
    if (f === 8) return { name: '向かい飛車', note: '相手の飛車と向かい合う' };
    if (f === 4) return { name: '右四間飛車', note: '4筋に集中して攻める' };
    if (f === 2) {
      /* 飛車が2筋にあるのは初期配置と同じ。飛車先も玉もまだ動いていないなら
         「居飛車に構えた」とは言えないので判定しない（1手目で出てしまうのを防ぐ）。 */
      if (at(pos, side, 2, 7, FU) && at(pos, side, 5, 9, OU)) return null;
      if (kakuGawari) return { name: '角換わり', note: '角を交換した相居飛車' };
      // 棒銀：右の銀が飛車先へ進んだ形
      if (at(pos, side, 2, 5, GI) || at(pos, side, 2, 6, GI)) {
        return { name: '棒銀', note: '銀を飛車先にぶつける攻め' };
      }
      if (at(pos, side, 3, 6, GI) || at(pos, side, 4, 6, GI)) {
        return { name: '早繰り銀', note: '銀を素早く繰り出す' };
      }
      return { name: '居飛車', note: '飛車を動かさず正面から戦う' };
    }
    void ci;
    return null;
  }

  /* ---------------- 手筋 ----------------
   *  before : 指す前の局面
   *  m      : 指し手
   *  after  : 指した後の局面（手番は相手に移っている）
   */
  var VAL = [0, 100, 350, 420, 550, 600, 820, 980, 0, 610, 560, 560, 610, 0, 1080, 1250];

  /* その駒が利かせている相手の駒を集める。
     同じ升へは「成」「不成」の2手が出るので、升ごとに1回だけ数える。 */
  function targets(pos, from, side) {
    var out = [], seen = {}, ms = [];
    var save = pos.side;
    pos.side = side;
    S.genMoves(pos, ms, false);
    pos.side = save;
    for (var i = 0; i < ms.length; i++) {
      if (S.mvIsDrop(ms[i]) || S.mvFrom(ms[i]) !== from) continue;
      var to = S.mvTo(ms[i]), v = pos.board[to];
      if (v === 0 || (v > 0) === (side > 0)) continue;
      if (seen[to]) continue;
      seen[to] = 1;
      out.push(v > 0 ? v : -v);        // 升ごとに1件（同じ種類が2枚なら2件）
    }
    return out;
  }


  function detectTechnique(before, m, after) {
    var side = before.side;
    var to = S.mvTo(m);
    var isDrop = S.mvIsDrop(m);
    var moved = isDrop ? S.mvDropPiece(m) : (function () {
      var v = before.board[S.mvFrom(m)];
      return v > 0 ? v : -v;
    })();
    var promoted = !isDrop && S.mvPromo(m);
    var captured = isDrop ? 0 : (function () {
      var v = before.board[to];
      return v === 0 ? 0 : (v > 0 ? v : -v);
    })();
    var gaveCheck = after.inCheck(after.side);
    var hits = targets(after, to, side);
    var big = hits.filter(function (p) { return VAL[p] >= 550; });

    // 王手しながら駒取り
    if (gaveCheck) {
      if (hits.some(function (p) { return p === HI || p === RY; })) {
        return { name: '王手飛車', note: '王手をかけながら飛車を取りにいく' };
      }
      if (hits.some(function (p) { return p === KA || p === UM; })) {
        return { name: '王手角取り', note: '王手をかけながら角を取りにいく' };
      }
      if (hits.some(function (p) { return p === KI; })) {
        return { name: '王手金取り', note: '王手をかけながら金を取りにいく' };
      }
      if (hits.some(function (p) { return p === GI; })) {
        return { name: '王手銀取り', note: '王手をかけながら銀を取りにいく' };
      }
    }
    // 両取り
    if (big.length >= 2) {
      if (moved === GI && isDrop) return { name: '割り打ちの銀', note: '銀を打って二枚に当てる' };
      return { name: '両取り', note: '一手で二枚に当てる' };
    }
    // 香で串刺し（田楽刺し）
    if (moved === KY) {
      var x = to % 9, y = (to / 9) | 0, dy = side > 0 ? -1 : 1, seen = 0;
      for (var k = 1; k < 9; k++) {
        var ny = y + dy * k;
        if (ny < 0 || ny > 8) break;
        var v = after.board[ny * 9 + x];
        if (v === 0) continue;
        if ((v > 0) === (side > 0)) break;
        seen++;
        if (seen >= 2) return { name: '田楽刺し', note: '香で二枚を串刺しにする' };
      }
    }
    // と金作り・成り込み
    if (promoted) {
      if (moved === FU) return { name: 'と金作り', note: '歩を成って攻めの拠点をつくる' };
      if (moved === HI) return { name: '竜をつくる', note: '飛車が成って一気に働く' };
      if (moved === KA) return { name: '馬をつくる', note: '角が成って守りにも攻めにも利く' };
      if (moved === KY) return { name: '成香', note: '香が成って金の働きに' };
    }
    // 垂れ歩（敵陣に歩を打ってと金を狙う）
    if (isDrop && moved === FU) {
      var r = S.rankOf(to), inCamp = side > 0 ? r <= 3 : r >= 7;
      if (inCamp) return { name: '垂れ歩', note: '次にと金をつくる狙いの歩' };
      var r4 = side > 0 ? r === 4 : r === 6;
      if (r4) return { name: '継ぎ歩', note: '歩を足して攻めをつなぐ' };
    }
    // 端攻め
    var f = S.fileOf(to);
    if ((f === 1 || f === 9) && (moved === FU || moved === KY || moved === KE)) {
      var ek = after.kingSq[side > 0 ? 1 : 0];
      if (ek >= 0 && Math.abs(S.fileOf(ek) - f) <= 2) {
        return { name: '端攻め', note: '玉のいる端から攻め込む' };
      }
    }
    // 大駒をタダで取った
    if (captured && VAL[captured] >= 820 && !after.isAttacked(to, -side)) {
      return { name: '大駒得', note: '大駒を安全に取った' };
    }
    return null;
  }

  return {
    CASTLES: CASTLES,
    detectCastle: detectCastle,
    detectStrategy: detectStrategy,
    detectTechnique: detectTechnique
  };
});
