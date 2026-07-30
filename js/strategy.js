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
    { id: 'auto', name: 'おまかせ', note: '定跡と読みにまかせる', moves: [] },

    { id: 'ibisha', name: '居飛車', note: '飛車を動かさず、飛車先を伸ばす',
      moves: ['7g7f', '2g2f', '2f2e', '6i7h', '3i3h', '5i6h'] },

    { id: 'yagura', name: '矢倉', note: '金銀3枚で堅く囲う。相居飛車の王道',
      moves: ['7g7f', '7i6h', '6g6f', '6h7g', '6i7h', '4i5h', '5h6g', '5i6i', '1g1f'] },

    { id: 'kakugawari', name: '角換わり', note: '角を交換して手得と速さを争う',
      moves: ['7g7f', '2g2f', '2f2e', '8h7g', '7i8h', '3i3h'] },

    { id: 'aigakari', name: '相掛かり', note: 'いきなり飛車先を伸ばし合う',
      moves: ['2g2f', '2f2e', '6i7h', '3i3h', '5i6h'] },

    { id: 'shiken', name: '四間飛車', note: '飛車を4つめの筋へ。美濃囲いと相性がよい',
      moves: ['7g7f', '6g6f', '2h6h', '5i4h', '4h3h', '3h2h', '3i3h', '6i5h', '1g1f'] },

    { id: 'sanken', name: '三間飛車', note: '飛車を3つめの筋へ',
      moves: ['7g7f', '6g6f', '2h7h', '5i4h', '4h3h', '3h2h', '3i3h', '6i5h'] },

    { id: 'nakabisha', name: '中飛車', note: '飛車を中央へ。攻めが分かりやすい',
      moves: ['7g7f', '5g5f', '2h5h', '5i4h', '4h3h', '3h2h', '3i3h', '6i7h'] },

    { id: 'mukai', name: '向かい飛車', note: '相手の飛車と向かい合う筋へ',
      moves: ['7g7f', '8h7g', '2h8h', '5i4h', '4h3h', '3h2h', '3i3h', '6i5h'] },

    { id: 'ishida', name: '石田流', note: '三間飛車から7五歩と伸ばす急戦形',
      moves: ['7g7f', '2h7h', '7f7e', '5i4h', '4h3h', '3h2h', '3i3h', '6i5h'] },

    /* オリジナル戦法。
       後手番だと △8四歩・△8五歩と居飛車に構えてから、8二の飛車を6二へ振り直して
       右四間飛車にする。先手番ではその上下反転（2八飛のまま伸ばして4八飛へ）。 */
    { id: 'kurotaki82', name: '黒滝式82飛', note: '居飛車に構えてから飛車を振り直し、右四間で急襲する',
      moves: ['7g7f', '2g2f', '2f2e', '6i7h', '5g5f', '4g4f', '2h4h', '3i3h', '3h4g', '5i6h', '6h7i'] }
  ];

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
    if (pos.ply >= (maxPly === undefined ? 24 : maxPly)) return 0;
    if (pos.inCheck()) return 0;
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

  return { LIST: LIST, get: get, movesFor: movesFor, nextMove: nextMove, mirrorUsi: mirrorUsi };
});
