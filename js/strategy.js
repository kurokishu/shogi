/* ==========================================================================
 * strategy.js — 戦法（序盤の組み立て）の指定
 *   先手の手順だけを持ち、後手ぶんは上下反転して自動生成する。
 *   指定した戦法の手が「その局面で指せる」あいだは順に指し、
 *   指せなくなったら（相手に妨げられた等）通常の読みに切り替える。
 *   依存: shogi.js
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shogi.js'));
  else root.Strategy = factory(root.Shogi);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  /* 先手番での手順（USI表記）。玉を囲うところまでを骨格として持つ。 */
  var LIST = [
    { id: 'auto', name: 'おまかせ', note: '定跡と読みにまかせる', castle: 'auto', moves: [] },

    { id: 'ibisha', name: '居飛車', note: '飛車を動かさず、飛車先を伸ばす',
      castle: 'funa', moves: ['7g7f', '2g2f', '2f2e'] },

    { id: 'yagura', name: '矢倉', note: '角道を止めて堅く組む。相居飛車の王道',
      castle: 'yagura', moves: ['7g7f', '6g6f', '1g1f'] },

    { id: 'kakugawari', name: '角換わり', note: '角を交換して手得と速さを争う',
      castle: 'funa', moves: ['7g7f', '2g2f', '2f2e', '8h7g', '7i8h'] },

    { id: 'aigakari', name: '相掛かり', note: 'いきなり飛車先を伸ばし合う',
      castle: 'nakazumai', moves: ['2g2f', '2f2e'] },

    { id: 'shiken', name: '四間飛車', note: '飛車を4つめの筋へ。振り飛車の代表格',
      castle: 'mino', moves: ['7g7f', '6g6f', '2h6h', '1g1f'] },

    { id: 'sanken', name: '三間飛車', note: '飛車を3つめの筋へ',
      castle: 'mino', moves: ['7g7f', '6g6f', '2h7h'] },

    { id: 'nakabisha', name: '中飛車', note: '飛車を中央へ。攻めが分かりやすい',
      castle: 'mino', moves: ['7g7f', '5g5f', '2h5h'] },

    { id: 'mukai', name: '向かい飛車', note: '相手の飛車と向かい合う筋へ',
      castle: 'mino', moves: ['7g7f', '8h7g', '2h8h'] },

    { id: 'ishida', name: '石田流', note: '三間飛車から7五歩と伸ばす急戦形',
      castle: 'mino', moves: ['7g7f', '2h7h', '7f7e'] },

    /* オリジナル戦法「黒滝流」。
       ① 初手で飛車を7八へ振り、三間飛車に見せる。
          こう指されると相手は高い確率で反対側（自分から見て左）に玉を囲う。美濃系が多い。
       ② こちらは右側に高美濃囲い（2八玉・3八銀・4七金）を作る。
       ③ 囲いができたところで、飛車を7八から4八へ振り直して右四間飛車にする。
       ④ 高美濃の4七金は、そのまま4筋の攻め駒として使える。守りと攻めを兼ねるのが狙い。
       囲いは手順に組み込んであるので、囲いの指定は要らない（castle は auto）。
       後手番は上下左右の反転（初手△3二飛 → 8二玉・7二銀・6三金 → △6二飛）。 */
    { id: 'kurotaki78', name: '黒滝流７八飛', note: '初手7八飛で三間飛車に見せ、右側に高美濃を作りながら右四間へ振り直す。囲いの金がそのまま攻め駒になる',
      castle: 'auto',
      moves: ['2h7h', '5i4h', '4h3h', '3h2h', '3i3h', '6i5h', '4g4f', '5h4g', '7h4h'] }
  ];

  /* 囲い（玉の守り）の組み方。戦法とは別に指定できる。
     戦法の手順を指し終えたあと、こちらの手順に移る。
     手の順番は「通り道の升が空いているか」に依存するので、入れ替えないこと。 */
  var CASTLE_LIST = [
    { id: 'auto', name: 'おまかせ', note: '囲いは指定せず、読みにまかせる', moves: [] },

    { id: 'yagura', name: '矢倉囲い', note: '金銀3枚の堅陣。相居飛車の王道',
      moves: ['7i6h', '6h7g', '6i7h', '4i5h', '5h6g', '5i6i'] },

    { id: 'mino', name: '美濃囲い', note: '振り飛車の定番。組むのが速く、横に強い',
      moves: ['5i4h', '4h3h', '3h2h', '3i3h', '6i5h'] },

    { id: 'takamino', name: '高美濃囲い', note: '美濃に金を足して上部を厚くする',
      moves: ['5i4h', '4h3h', '3h2h', '3i3h', '6i5h', '4g4f', '5h4g'] },

    { id: 'ginkanmuri', name: '銀冠', note: '美濃から銀を繰り替えた、上からの攻めに強い形',
      moves: ['5i4h', '4h3h', '3h2h', '2g2f', '3i3h', '3h2g', '4i3h'] },

    { id: 'funa', name: '舟囲い', note: '対振り飛車の基本形。手数が少ない',
      moves: ['5i6h', '7i7h', '4i5h'] },

    { id: 'nakazumai', name: '中住まい', note: '玉を中央に置き、横に広く構える',
      moves: ['5i5h', '4i4h', '6i6h'] },

    { id: 'kinmusou', name: '金無双', note: '振り飛車の速い囲い。金2枚を並べる',
      moves: ['5i4h', '4h3h', '6i5h', '4i4h'] },

    { id: 'anaguma', name: '居飛車穴熊', note: '玉を隅に押し込む最も堅い囲い。手数はかかる',
      moves: ['7g7f', '8h7g', '5i6h', '6h7h', '7h8h', '9i9h', '8h9i', '7i8h'] },

    { id: 'furianaguma', name: '振り飛車穴熊', note: '振り飛車から玉を隅へ',
      moves: ['5i4h', '4h3h', '3h2h', '1i1h', '2h1i', '3i2h'] }
  ];

  function getCastle(id) {
    for (var i = 0; i < CASTLE_LIST.length; i++) if (CASTLE_LIST[i].id === id) return CASTLE_LIST[i];
    return CASTLE_LIST[0];
  }

  /* USIの升を上下左右反転（先手の手順を後手用に読み替える） */
  function mirrorSq(f, r) {
    return String(10 - parseInt(f, 10)) + String.fromCharCode(97 + (8 - (r.charCodeAt(0) - 97)));
  }
  function mirrorUsi(m) {
    if (m[1] === '*') return m[0] + '*' + mirrorSq(m[2], m[3]);
    return mirrorSq(m[0], m[1]) + mirrorSq(m[2], m[3]) + (m[4] === '+' ? '+' : '');
  }

  function get(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return LIST[0];
  }

  /* その戦法の手順を、指定した手番用に取り出す */
  function movesFor(id, side) {
    var st = get(id);
    if (!st.moves.length) return [];
    return side > 0 ? st.moves.slice() : st.moves.map(mirrorUsi);
  }

  /* いまの局面で指すべき戦法の手を返す（無ければ 0）
   *  - 王手されているときは戦法を離れて対応する
   *  - 手順のうち「いま指せる最初の手」を選ぶ（既に指した手は指せないので自然に進む）
   *  - 相手の駒をタダで取られる手になる場合は見送る
   */
  function nextMove(pos, id, maxPly) {
    if (!id || id === 'auto') return 0;
    if (pos.ply >= (maxPly === undefined ? 40 : maxPly)) return 0;
    if (pos.inCheck()) return 0;
    if (tacticalAlert(pos)) return 0;
    var seq = movesFor(id, pos.side);
    if (!seq.length) return 0;
    var legal = pos.legalMoves();
    for (var i = 0; i < seq.length; i++) {
      var m = S.usiToMove(pos, seq[i]);
      if (!m) continue;
      var ok = false;
      for (var j = 0; j < legal.length; j++) if (legal[j] === m) { ok = true; break; }
      if (!ok) continue;
      if (isHanging(pos, m)) return 0;      // 危ないときは戦法を離れる
      return m;
    }
    return 0;
  }

  /* 手順を機械的に消化してよい局面かどうか。
     大駒を取られた直後に取り返さず囲いを続ける、といった事故を防ぐ。
     ここで true を返したときは戦法を離れ、通常の読みにまかせる。 */
  var VAL = [0, 100, 350, 420, 550, 600, 820, 980, 0, 610, 560, 560, 610, 0, 1080, 1250];
  function valueOf(p) { return p < VAL.length ? VAL[p] : 700; }   // 特殊駒は一律で高めに見る

  function tacticalAlert(pos) {
    var side = pos.side, b = pos.board;
    for (var sq = 0; sq < 81; sq++) {
      var v = b[sq];
      if (v === 0) continue;
      var p = v > 0 ? v : -v;
      var val = valueOf(p);
      if ((v > 0) === (side > 0)) {
        // 自分の銀以上の駒が、ヒモ無しで狙われている
        if (val >= 550 && pos.isAttacked(sq, -side) && !pos.isAttacked(sq, side)) return true;
      } else {
        // 相手の大駒を取れる位置にある（取り返しも含む）
        if (val >= 820 && pos.isAttacked(sq, side)) return true;
      }
    }
    return false;
  }

  /* その手を指すと、動かした駒がすぐ取られてしまうか（ごく簡単な確認） */
  function isHanging(pos, m) {
    var to = S.mvTo(m), side = pos.side;
    pos.doMove(m);
    var attacked = pos.isAttacked(to, -side);
    var defended = pos.isAttacked(to, side);
    pos.undoMove();
    if (!attacked) return false;
    if (defended) return false;                       // 取り返せるなら可
    var pc = S.mvIsDrop(m) ? S.mvDropPiece(m) : pos.board[S.mvFrom(m)];
    var p = pc > 0 ? pc : -pc;
    return p !== S.FU;                                 // 歩以外がタダなら見送る
  }

  function castleMovesFor(id, side) {
    var c = getCastle(id);
    if (!c.moves.length) return [];
    return side > 0 ? c.moves.slice() : c.moves.map(mirrorUsi);
  }

  /* いまの局面で組むべき囲いの手を返す（無ければ 0）
     手順は順番が意味を持つので、「いま指せる最初の手」ではなく
     「まだ済んでいない先頭の手」から順に試す。 */
  function nextCastleMove(pos, id, maxPly) {
    if (!id || id === 'auto') return 0;
    if (pos.ply >= (maxPly === undefined ? 60 : maxPly)) return 0;
    if (pos.inCheck()) return 0;
    if (tacticalAlert(pos)) return 0;
    var seq = castleMovesFor(id, pos.side);
    if (!seq.length) return 0;
    var legal = pos.legalMoves();
    for (var i = 0; i < seq.length; i++) {
      var m = S.usiToMove(pos, seq[i]);
      if (!m) continue;
      var ok = false;
      for (var j = 0; j < legal.length; j++) if (legal[j] === m) { ok = true; break; }
      if (!ok) continue;
      if (isHanging(pos, m)) return 0;
      return m;
    }
    return 0;
  }

  /* 戦法 → 囲い の順に、いま指すべき手を1つ返す。
     囲いが「おまかせ」なら、その戦法と相性のよい囲いを自動で選ぶ。 */
  function nextPlan(pos, stratId, castleId, maxPly) {
    var m = nextMove(pos, stratId, maxPly);
    if (m) return m;
    var cid = castleId;
    if (!cid || cid === 'auto') cid = get(stratId).castle || 'auto';
    return nextCastleMove(pos, cid, maxPly);
  }

  return {
    LIST: LIST, get: get, movesFor: movesFor, nextMove: nextMove, mirrorUsi: mirrorUsi,
    nextPlan: nextPlan,
    CASTLE_LIST: CASTLE_LIST, getCastle: getCastle,
    castleMovesFor: castleMovesFor, nextCastleMove: nextCastleMove
  };
});
