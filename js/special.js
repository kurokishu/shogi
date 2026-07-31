/* ==========================================================================
 * special.js — 特殊駒モードの定義（駒の一覧・初期配置・特殊ルール）
 *   1局につき1個まで。強さに応じて元の駒と交換する。
 *   依存: shogi.js
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shogi.js'));
  else root.Special = factory(root.Shogi);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  /* ---------------- 特殊駒 ----------------
   *  swap  : 交換する元の駒（表示用の説明）
   *  place : 初期配置。先手基準の [筋, 段] と置く駒コード
   *  remove: 盤から取り除く先手基準の [筋, 段]
   */
  var PIECES = [
    {
      id: 'none', name: 'なし', kind: 0,
      swap: '', move: '通常の駒だけで戦います',
      note: '特殊駒を使わない', place: [], remove: []
    },
    {
      id: 'knight', name: '騎士', kind: S.KNIGHT,
      swap: '桂馬2枚と交換', move: '8方向へL字に跳ぶ（駒を飛び越せる）',
      note: '後退できる桂馬。ただし隣を守れないので囲いには使えない。敵陣で成ると金',
      place: [[2, 9, S.KNIGHT]], remove: [[2, 9], [8, 9]]
    },
    {
      id: 'ninja', name: '忍', kind: S.NINJA,
      swap: '香車1枚と交換', move: '前に1マス／斜め後ろに2マス跳ぶ',
      note: '前線から一気に引き上げられる。攻めは遅い。敵陣で成ると金',
      place: [[9, 9, S.NINJA]], remove: [[9, 9]]
    },
    {
      id: 'wind', name: '風車', kind: S.WIND_B,
      swap: '角行1枚と交換', move: '指すたびに飛車と角行が入れ替わる',
      note: '両方の性質を持つが、どちらになるかは選べない。成れない',
      place: [[8, 8, S.WIND_B]], remove: [[8, 8]]
    },
    {
      id: 'archer', name: '弓兵', kind: S.ARCHER_S,
      swap: '桂馬1枚と交換', move: '斜めに1マス動く／縦横2マス先の駒を動かずに取る',
      note: '移動と射撃を交互にしか行えない。撃った次は動かないと撃てない。成れない',
      place: [[2, 9, S.ARCHER_S]], remove: [[2, 9]]
    },
    {
      id: 'reborn', name: '転生兵', kind: S.REBORN,
      swap: '金1枚と交換', move: '銀と同じ動き',
      note: '取られても相手の持ち駒にならず、自陣に歩として復活する（1局2回まで）',
      place: [[4, 9, S.REBORN]], remove: [[4, 9]]
    }
  ];

  /* ---------------- 特殊ルール ---------------- */
  var RULES = [
    { id: 'hourglass', name: '砂時計', note: 'ランダムに1〜3回、双方の持ち時間が入れ替わる' },
    { id: 'exchange', name: '捕虜交換', note: '双方1度だけ、同じ点数の持ち駒を交換できる' },
    { id: 'lastStand', name: '決死作戦', note: '双方が秒読みに入ったら、盤上の歩がすべて成る' }
  ];

  function get(id) {
    for (var i = 0; i < PIECES.length; i++) if (PIECES[i].id === id) return PIECES[i];
    return PIECES[0];
  }
  function getRule(id) {
    for (var i = 0; i < RULES.length; i++) if (RULES[i].id === id) return RULES[i];
    return null;
  }

  /* 先手基準の (筋,段) を、その手番の升に読み替える */
  function sq(side, file, rank) {
    return side > 0 ? S.sqOf(file, rank) : S.sqOf(10 - file, 10 - rank);
  }

  /* 特殊駒を組み込んだ初期局面をつくる */
  function startpos(blackId, whiteId) {
    var p = S.startpos();
    [[1, blackId], [-1, whiteId]].forEach(function (e) {
      var side = e[0], def = get(e[1]);
      if (!def.kind) return;
      def.remove.forEach(function (r) { p.board[sq(side, r[0], r[1])] = 0; });
      def.place.forEach(function (r) { p.board[sq(side, r[0], r[1])] = r[2] * side; });
    });
    p.computeKey();
    return p;
  }

  /* その駒の利きを、5×5の図で表すためのデータ（対局前の説明用）
     中心が駒。1=行ける 2=射撃できる */
  function moveMap(id) {
    var g = [];
    for (var i = 0; i < 5; i++) g.push([0, 0, 0, 0, 0]);
    function set(dx, dy, v) {
      var x = 2 + dx, y = 2 + dy;
      if (x >= 0 && x < 5 && y >= 0 && y < 5) g[y][x] = v;
    }
    switch (id) {
      case 'knight':
        [[-1, -2], [1, -2], [-2, -1], [2, -1], [-2, 1], [2, 1], [-1, 2], [1, 2]]
          .forEach(function (d) { set(d[0], d[1], 1); });
        break;
      case 'ninja':
        set(0, -1, 1); set(-2, 2, 1); set(2, 2, 1);
        break;
      case 'wind':
        // 角モードで表示（斜め）
        [[-1, -1], [1, -1], [-1, 1], [1, 1], [-2, -2], [2, -2], [-2, 2], [2, 2]]
          .forEach(function (d) { set(d[0], d[1], 1); });
        break;
      case 'archer':
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) { set(d[0], d[1], 1); });
        [[0, -2], [0, 2], [-2, 0], [2, 0]].forEach(function (d) { set(d[0], d[1], 2); });
        break;
      case 'reborn':
        [[-1, -1], [0, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) { set(d[0], d[1], 1); });
        break;
    }
    return g;
  }

  return { PIECES: PIECES, RULES: RULES, get: get, getRule: getRule, startpos: startpos, moveMap: moveMap };
});
