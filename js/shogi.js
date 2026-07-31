/* ==========================================================================
 * shogi.js — 将棋ルールエンジン（盤面表現・合法手生成・判定・SFEN・棋譜表記）
 * ブラウザ / WebWorker / Node の3環境で動作する。
 * ========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Shogi = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 駒コード ----------------
   * 1..8  : 歩 香 桂 銀 金 角 飛 玉
   * +8    : 成駒 (と 成香 成桂 成銀 -- 馬 竜)  ※ 13(金成) は欠番
   * 盤上は符号で手番を表す（正=先手, 負=後手）
   */
  var EMPTY = 0, FU = 1, KY = 2, KE = 3, GI = 4, KI = 5, KA = 6, HI = 7, OU = 8;
  var TO = 9, NY = 10, NK = 11, NG = 12, UM = 14, RY = 15;
  var BLACK = 1, WHITE = -1;

  /* ---------------- 特殊駒 ----------------
   * 通常の駒は 1〜8（成りは +8 で 9〜15）。
   * 特殊駒は 16〜22 を使い、成りは同じく +8（24〜30）。
   * 風車と弓兵は「状態」を持つため、状態ごとに別のコードを割り当てている。
   */
  var KNIGHT = 16;    // 騎士：8方向へL字に跳ぶ
  var NINJA = 17;     // 忍：前1マス／斜め後ろ2マス跳び
  var WIND_R = 18;    // 風車（飛車の動き。指すと角の動きに変わる）
  var WIND_B = 19;    // 風車（角行の動き。指すと飛車の動きに変わる）
  var ARCHER_S = 20;  // 弓兵（射撃できる状態）
  var ARCHER_M = 21;  // 弓兵（要移動＝撃てない状態）
  var REBORN = 22;    // 転生兵：取られると自陣に歩として戻る
  var P_KNIGHT = 24, P_NINJA = 25, P_REBORN = 30;   // それぞれの成り（金の動き）

  function isSpecial(p) { return p >= 16; }
  /* 風車・弓兵は状態違いを同じ駒として扱うための代表コード */
  function baseKind(p) {
    if (p === WIND_B) return WIND_R;
    if (p === ARCHER_M) return ARCHER_S;
    return p;
  }

  var PIECE_NAME = {
    1: '歩', 2: '香', 3: '桂', 4: '銀', 5: '金', 6: '角', 7: '飛', 8: '玉',
    9: 'と', 10: '成香', 11: '成桂', 12: '成銀', 14: '馬', 15: '竜',
    16: '騎士', 17: '忍', 18: '風車', 19: '風車', 20: '弓兵', 21: '弓兵', 22: '転生兵',
    24: '成騎士', 25: '成忍', 30: '成転生'
  };
  // 盤面表示用（1文字）
  var PIECE_CHAR = {
    1: '歩', 2: '香', 3: '桂', 4: '銀', 5: '金', 6: '角', 7: '飛', 8: '玉',
    9: 'と', 10: '杏', 11: '圭', 12: '全', 14: '馬', 15: '竜',
    16: '騎', 17: '忍', 18: '飛', 19: '角', 20: '弓', 21: '矢', 22: '転',
    24: '騎', 25: '忍', 30: '転'
  };
  /* SFEN用の文字。特殊駒はこのアプリ独自の拡張（Y=騎士 D=忍 W/V=風車 A/Q=弓兵 E=転生兵） */
  var USI_CHAR = {
    1: 'P', 2: 'L', 3: 'N', 4: 'S', 5: 'G', 6: 'B', 7: 'R', 8: 'K',
    16: 'Y', 17: 'D', 18: 'W', 19: 'V', 20: 'A', 21: 'Q', 22: 'E'
  };
  var USI_TO_PIECE = {
    P: 1, L: 2, N: 3, S: 4, G: 5, B: 6, R: 7, K: 8,
    Y: 16, D: 17, W: 18, V: 19, A: 20, Q: 21, E: 22
  };
  var KANJI_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var ZEN_NUM = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];
  var HAND_ORDER = [7, 6, 5, 4, 3, 2, 1]; // 飛 角 金 銀 桂 香 歩

  function raw(p) {
    if (p >= 24) return p - 8;          // 特殊駒の成り
    if (p >= 16) return p;              // 特殊駒（成っていない）
    return p >= 9 ? p - 8 : p;          // 通常の駒
  }
  function prom(p) { return p + 8; }
  function abs(p) { return p < 0 ? -p : p; }
  var CAN_PROMO = [0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    /*16 騎士*/ 1, /*17 忍*/ 1, /*18 風車飛*/ 0, /*19 風車角*/ 0,
    /*20 弓兵*/ 0, /*21 弓兵*/ 0, /*22 転生兵*/ 1, 0,
    0, 0, 0, 0, 0, 0, 0, 0];

  /* ---------------- 方向テーブル ----------------
   * 0:左上 1:上 2:右上 3:左 4:右 5:左下 6:下 7:右下
   * 画面は先手が下。先手の「前」は上(dy=-1)。
   */
  var DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  var DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  var OPP = [7, 6, 5, 4, 3, 2, 1, 0];
  var MIRROR = [5, 6, 7, 3, 4, 0, 1, 2]; // 上下反転（後手用）

  var GOLD_STEPS = [0, 1, 2, 3, 4, 6];
  var ALL_DIRS = [0, 1, 2, 3, 4, 5, 6, 7];
  var DIAG = [0, 2, 5, 7];
  var ORTH = [1, 3, 4, 6];

  var STEPS = [[], []], RAYS = [[], []];
  var STEPMASK = [new Int32Array(32), new Int32Array(32)];
  var RAYMASK = [new Int32Array(32), new Int32Array(32)];
  /* 跳ぶ駒の相対座標（先手基準の [dx, dy]）。後手は dy を反転して使う */
  var JUMPS = [[], []];
  (function buildTables() {
    var base = { steps: {}, rays: {} };
    base.steps[FU] = [1];
    base.rays[KY] = [1];
    base.steps[KE] = [];               // 桂は特殊処理
    base.steps[GI] = [0, 1, 2, 5, 7];
    base.steps[KI] = GOLD_STEPS;
    base.steps[TO] = GOLD_STEPS;
    base.steps[NY] = GOLD_STEPS;
    base.steps[NK] = GOLD_STEPS;
    base.steps[NG] = GOLD_STEPS;
    base.steps[OU] = ALL_DIRS;
    base.rays[KA] = DIAG;
    base.rays[HI] = ORTH;
    base.rays[UM] = DIAG; base.steps[UM] = ORTH;
    base.rays[RY] = ORTH; base.steps[RY] = DIAG;

    /* ---- 特殊駒 ---- */
    base.steps[NINJA] = [1];                 // 忍：前に1マス（跳びは JUMPS で定義）
    base.steps[P_KNIGHT] = GOLD_STEPS;       // 成騎士＝金
    base.steps[P_NINJA] = GOLD_STEPS;        // 成忍＝金
    base.steps[P_REBORN] = GOLD_STEPS;       // 成転生＝金
    base.steps[REBORN] = [0, 1, 2, 5, 7];    // 転生兵＝銀と同じ
    base.rays[WIND_R] = ORTH;                // 風車（飛モード）
    base.rays[WIND_B] = DIAG;                // 風車（角モード）
    base.steps[ARCHER_S] = DIAG;             // 弓兵の移動＝斜め1マス
    base.steps[ARCHER_M] = DIAG;

    /* 跳ぶ駒（間の駒を飛び越す）。桂も同じ仕組みに載せる */
    var baseJumps = {};
    baseJumps[KE] = [[-1, -2], [1, -2]];
    baseJumps[KNIGHT] = [[-1, -2], [1, -2], [-2, -1], [2, -1],
                         [-2, 1], [2, 1], [-1, 2], [1, 2]];
    baseJumps[NINJA] = [[-2, 2], [2, 2]];    // 斜め後ろへ2マス

    for (var ci = 0; ci < 2; ci++) {
      for (var jp = 0; jp < 32; jp++) {
        var jb = baseJumps[jp];
        JUMPS[ci][jp] = jb ? jb.map(function (d) { return ci === 0 ? d : [d[0], -d[1]]; }) : [];
      }
      for (var p = 0; p < 32; p++) {
        var s = base.steps[p] || [], r = base.rays[p] || [];
        var ms = [], mr = [], i;
        for (i = 0; i < s.length; i++) ms.push(ci === 0 ? s[i] : MIRROR[s[i]]);
        for (i = 0; i < r.length; i++) mr.push(ci === 0 ? r[i] : MIRROR[r[i]]);
        STEPS[ci][p] = ms; RAYS[ci][p] = mr;
        var bm = 0, bmr = 0;
        for (i = 0; i < ms.length; i++) bm |= 1 << ms[i];
        for (i = 0; i < mr.length; i++) bmr |= 1 << mr[i];
        STEPMASK[ci][p] = bm; RAYMASK[ci][p] = bmr;
      }
    }
  })();

  /* ---------------- 指し手エンコード ----------------
   * bit 0-6   : 移動先 (0..80)
   * bit 7-13  : 移動元 (0..80)
   * bit 14    : 成
   * bit 15-18 : 打つ駒種
   * bit 19    : 打つ手フラグ
   */
  function mkMove(from, to, promo) { return to | (from << 7) | (promo ? 1 << 14 : 0); }
  function mkDrop(pt, to) { return to | (pt << 15) | (1 << 19); }
  /* 弓兵の射撃：自分は動かず、離れた駒だけを取る */
  function mkShoot(from, to) { return to | (from << 7) | (1 << 20); }
  function mvIsShoot(m) { return (m >> 20) & 1; }
  function mvTo(m) { return m & 127; }
  function mvFrom(m) { return (m >> 7) & 127; }
  function mvPromo(m) { return (m >> 14) & 1; }
  function mvDropPiece(m) { return (m >> 15) & 15; }
  function mvIsDrop(m) { return (m >> 19) & 1; }

  function sqOf(file, rank) { return (rank - 1) * 9 + (9 - file); }   // 7六 -> sqOf(7,6)
  function fileOf(sq) { return 9 - (sq % 9); }
  function rankOf(sq) { return ((sq / 9) | 0) + 1; }

  /* ---------------- Zobrist ---------------- */
  var ZP = [new Int32Array(64 * 81), new Int32Array(64 * 81)];
  var ZH = [new Int32Array(2 * 8 * 19), new Int32Array(2 * 8 * 19)];
  var ZS = [0, 0];
  (function initZobrist() {
    // 決定的な擬似乱数（xorshift）で再現性を確保
    var s = 88172645463325252 % 2147483647, x = 123456789, y = 362436069, z = 521288629, w = 88675123;
    function rnd() {
      var t = x ^ (x << 11); x = y; y = z; z = w;
      w = (w ^ (w >>> 19) ^ t ^ (t >>> 8)) | 0;
      return w | 0;
    }
    var i;
    for (i = 0; i < ZP[0].length; i++) { ZP[0][i] = rnd(); ZP[1][i] = rnd(); }
    for (i = 0; i < ZH[0].length; i++) { ZH[0][i] = rnd(); ZH[1][i] = rnd(); }
    ZS[0] = rnd(); ZS[1] = rnd();
    void s;
  })();
  function pieceIdx(pc) { return pc > 0 ? pc : 32 + (-pc); }

  /* ================================================================
   *  Position
   * ================================================================ */
  function Position() {
    this.board = new Int8Array(81);
    this.hands = [new Int8Array(8), new Int8Array(8)]; // [0]=先手 [1]=後手
    this.side = BLACK;
    this.ply = 0;
    this.kingSq = [-1, -1];
    this.keyLo = 0; this.keyHi = 0;
    this.rebornLeft = [2, 2];      // 転生兵が生き返れる残り回数（先手, 後手）
    this.undoStack = [];
  }

  Position.prototype.clear = function () {
    this.board.fill(0);
    this.hands[0].fill(0); this.hands[1].fill(0);
    this.side = BLACK; this.ply = 0;
    this.kingSq = [-1, -1];
    this.undoStack.length = 0;
    this.computeKey();
    return this;
  };

  Position.prototype.clone = function () {
    var p = new Position();
    p.board.set(this.board);
    p.hands[0].set(this.hands[0]); p.hands[1].set(this.hands[1]);
    p.side = this.side; p.ply = this.ply;
    p.kingSq = [this.kingSq[0], this.kingSq[1]];
    p.keyLo = this.keyLo; p.keyHi = this.keyHi;
    p.rebornLeft = [this.rebornLeft[0], this.rebornLeft[1]];
    return p;
  };

  Position.prototype.computeKey = function () {
    var lo = 0, hi = 0, i, ci, pt, c;
    for (i = 0; i < 81; i++) {
      var pc = this.board[i];
      if (pc !== 0) { var k = pieceIdx(pc) * 81 + i; lo ^= ZP[0][k]; hi ^= ZP[1][k]; }
    }
    for (ci = 0; ci < 2; ci++) for (pt = 1; pt <= 7; pt++) {
      c = this.hands[ci][pt]; var j = (ci * 8 + pt) * 19 + c;
      lo ^= ZH[0][j]; hi ^= ZH[1][j];
    }
    if (this.side < 0) { lo ^= ZS[0]; hi ^= ZS[1]; }
    this.keyLo = lo | 0; this.keyHi = hi | 0;
    // 玉位置を同期
    this.kingSq = [-1, -1];
    for (i = 0; i < 81; i++) {
      if (this.board[i] === OU) this.kingSq[0] = i;
      else if (this.board[i] === -OU) this.kingSq[1] = i;
    }
    return this;
  };

  Position.prototype.set = function (sq, pc) { this.board[sq] = pc; return this; };

  Position.prototype.handCount = function (side, pt) { return this.hands[side > 0 ? 0 : 1][pt]; };

  /* ---- 局面キー（千日手判定用の完全一致文字列） ---- */
  Position.prototype.posKey = function () {
    var s = '';
    for (var i = 0; i < 81; i++) s += this.board[i] + ',';
    return s + '|' + this.hands[0].join(',') + '|' + this.hands[1].join(',') + '|' + this.side;
  };

  /* ---------------- 攻撃判定 ---------------- */
  Position.prototype.isAttacked = function (sq, by) {
    if (sq < 0) return false;
    var b = this.board, x = sq % 9, y = (sq / 9) | 0, ci = by > 0 ? 0 : 1;
    // 跳ぶ駒（桂・騎士・忍）は、その駒から見た相対位置を逆にたどって調べる
    for (var jp = 0; jp < 32; jp++) {
      var jl = JUMPS[ci][jp];
      for (var ji = 0; ji < jl.length; ji++) {
        var jx = x - jl[ji][0], jy = y - jl[ji][1];
        if (jx < 0 || jx > 8 || jy < 0 || jy > 8) continue;
        if (b[jy * 9 + jx] === jp * by) return true;
      }
    }
    // 弓兵の射撃（縦横2マス先。間の駒は飛び越す）
    for (var ai = 0; ai < 4; ai++) {
      var ad = ORTH[ai];
      var ax = x - DX[ad] * 2, ay = y - DY[ad] * 2;
      if (ax < 0 || ax > 8 || ay < 0 || ay > 8) continue;
      if (b[ay * 9 + ax] === ARCHER_S * by) return true;
    }
    for (var d = 0; d < 8; d++) {
      var nx = x + DX[d], ny = y + DY[d], dist = 1;
      while (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 8) {
        var pc = b[ny * 9 + nx];
        if (pc !== 0) {
          if ((pc > 0) === (by > 0)) {
            var p = pc > 0 ? pc : -pc, od = OPP[d];
            if (dist === 1 && ((STEPMASK[ci][p] >> od) & 1)) return true;
            if ((RAYMASK[ci][p] >> od) & 1) return true;
          }
          break;
        }
        nx += DX[d]; ny += DY[d]; dist++;
      }
    }
    return false;
  };

  Position.prototype.inCheck = function (side) {
    var s = side === undefined ? this.side : side;
    return this.isAttacked(this.kingSq[s > 0 ? 0 : 1], -s);
  };

  /* ---- 王手している駒の升リスト（表示用） ---- */
  Position.prototype.checkers = function (side) {
    var s = side === undefined ? this.side : side;
    var ks = this.kingSq[s > 0 ? 0 : 1], res = [];
    if (ks < 0) return res;
    var ms = [];
    var save = this.side; this.side = -s;
    genMoves(this, ms, false);
    this.side = save;
    for (var i = 0; i < ms.length; i++) {
      if (!mvIsDrop(ms[i]) && mvTo(ms[i]) === ks) res.push(mvFrom(ms[i]));
    }
    return res;
  };

  /* ---------------- 指し手生成 ---------------- */
  function inZone(sq, side) { var y = (sq / 9) | 0; return side > 0 ? y <= 2 : y >= 6; }
  function mustPromote(p, to, side) {
    var y = (to / 9) | 0;
    if (p === FU || p === KY) return side > 0 ? y === 0 : y === 8;
    if (p === KE) return side > 0 ? y <= 1 : y >= 7;
    return false;    // 特殊駒は行き所がなくならないので強制成りは無い
  }

  function addMove(out, from, to, p, side, captured, capturesOnly) {
    var canP = CAN_PROMO[p] && (inZone(from, side) || inZone(to, side));
    if (capturesOnly && captured === 0 && !canP) return;
    if (canP) {
      out.push(mkMove(from, to, 1));
      if (!mustPromote(p, to, side)) out.push(mkMove(from, to, 0));
    } else {
      out.push(mkMove(from, to, 0));
    }
  }

  function nifu(pos, file, side) {
    var pc = FU * side;
    for (var y = 0; y < 9; y++) if (pos.board[y * 9 + file] === pc) return true;
    return false;
  }

  function genMoves(pos, out, capturesOnly) {
    var b = pos.board, side = pos.side, ci = side > 0 ? 0 : 1, blackSide = side > 0;
    for (var sq = 0; sq < 81; sq++) {
      var pc = b[sq];
      if (pc === 0 || (pc > 0) !== blackSide) continue;
      var p = pc > 0 ? pc : -pc;
      var x = sq % 9, y = (sq / 9) | 0, i, d, nx, ny, t, tp;
      var st = STEPS[ci][p];
      for (i = 0; i < st.length; i++) {
        d = st[i]; nx = x + DX[d]; ny = y + DY[d];
        if (nx < 0 || nx > 8 || ny < 0 || ny > 8) continue;
        t = ny * 9 + nx; tp = b[t];
        if (tp !== 0 && (tp > 0) === blackSide) continue;
        addMove(out, sq, t, p, side, tp, capturesOnly);
      }
      var jm = JUMPS[ci][p];
      for (i = 0; i < jm.length; i++) {
        nx = x + jm[i][0]; ny = y + jm[i][1];
        if (nx < 0 || nx > 8 || ny < 0 || ny > 8) continue;
        t = ny * 9 + nx; tp = b[t];
        if (tp !== 0 && (tp > 0) === blackSide) continue;
        addMove(out, sq, t, p, side, tp, capturesOnly);
      }
      var ry = RAYS[ci][p];
      for (i = 0; i < ry.length; i++) {
        d = ry[i]; nx = x + DX[d]; ny = y + DY[d];
        while (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 8) {
          t = ny * 9 + nx; tp = b[t];
          if (tp !== 0 && (tp > 0) === blackSide) break;
          addMove(out, sq, t, p, side, tp, capturesOnly);
          if (tp !== 0) break;
          nx += DX[d]; ny += DY[d];
        }
      }
    }
    // 弓兵の射撃（縦横2マス先の相手の駒を、動かずに取る）
    for (var asq = 0; asq < 81; asq++) {
      if (b[asq] !== ARCHER_S * side) continue;
      var axx = asq % 9, ayy = (asq / 9) | 0;
      for (var oi = 0; oi < 4; oi++) {
        var od = ORTH[oi];
        var tx = axx + DX[od] * 2, ty = ayy + DY[od] * 2;
        if (tx < 0 || tx > 8 || ty < 0 || ty > 8) continue;
        var tsq = ty * 9 + tx, tv = b[tsq];
        if (tv === 0 || (tv > 0) === blackSide) continue;
        out.push(mkShoot(asq, tsq));
      }
    }

    if (capturesOnly) return out;
    var h = pos.hands[ci];
    for (var pt = 1; pt <= 7; pt++) {
      if (h[pt] === 0) continue;
      var pawnFile = null;
      for (var s2 = 0; s2 < 81; s2++) {
        if (b[s2] !== 0) continue;
        var yy = (s2 / 9) | 0;
        if (pt === FU || pt === KY) { if (blackSide ? yy === 0 : yy === 8) continue; }
        else if (pt === KE) { if (blackSide ? yy <= 1 : yy >= 7) continue; }
        if (pt === FU) {
          var f = s2 % 9;
          if (pawnFile === null) pawnFile = {};
          if (pawnFile[f] === undefined) pawnFile[f] = nifu(pos, f, side) ? 1 : 0;
          if (pawnFile[f]) continue;
        }
        out.push(mkDrop(pt, s2));
      }
    }
    return out;
  }

  Position.prototype.genMoves = function (capturesOnly) { return genMoves(this, [], !!capturesOnly); };

  /* ---------------- 着手 / 取消 ---------------- */
  Position.prototype.doMove = function (m) {
    var side = this.side, ci = side > 0 ? 0 : 1;
    var to = mvTo(m), lo = this.keyLo, hi = this.keyHi, k, j;
    var cap = 0, from = -1, movedPiece = 0;

    /* ---- 弓兵の射撃：自分は動かず、相手の駒だけを取る ---- */
    if (mvIsShoot(m)) {
      from = mvFrom(m);
      cap = this.board[to];
      var rebornInfo = this.captureTo(cap, ci, to);
      k = pieceIdx(cap) * 81 + to; lo ^= ZP[0][k]; hi ^= ZP[1][k];
      this.board[to] = 0;
      // 撃った弓兵は「要移動」状態になる
      k = pieceIdx(ARCHER_S * side) * 81 + from; lo ^= ZP[0][k]; hi ^= ZP[1][k];
      this.board[from] = ARCHER_M * side;
      k = pieceIdx(ARCHER_M * side) * 81 + from; lo ^= ZP[0][k]; hi ^= ZP[1][k];
      lo ^= ZS[0]; hi ^= ZS[1];
      this.undoStack.push({ m: m, cap: cap, lo: this.keyLo, hi: this.keyHi,
                            from: from, piece: ARCHER_M * side, reborn: rebornInfo });
      this.keyLo = lo | 0; this.keyHi = hi | 0;
      this.side = -side; this.ply++;
      return this;
    }

    var rebornInfo2 = null;
    if (mvIsDrop(m)) {
      var pt = mvDropPiece(m);
      var c = this.hands[ci][pt];
      j = (ci * 8 + pt) * 19 + c; lo ^= ZH[0][j]; hi ^= ZH[1][j];
      j = (ci * 8 + pt) * 19 + (c - 1); lo ^= ZH[0][j]; hi ^= ZH[1][j];
      this.hands[ci][pt] = c - 1;
      this.board[to] = pt * side;
      k = pieceIdx(pt * side) * 81 + to; lo ^= ZP[0][k]; hi ^= ZP[1][k];
      movedPiece = pt * side;
    } else {
      from = mvFrom(m);
      var pc = this.board[from];
      cap = this.board[to];
      k = pieceIdx(pc) * 81 + from; lo ^= ZP[0][k]; hi ^= ZP[1][k];
      if (cap !== 0) {
        k = pieceIdx(cap) * 81 + to; lo ^= ZP[0][k]; hi ^= ZP[1][k];
        rebornInfo2 = this.captureTo(cap, ci, to);
        if (!rebornInfo2) {
          var rp = handKind(cap < 0 ? -cap : cap);
          var hc = this.hands[ci][rp];
          j = (ci * 8 + rp) * 19 + hc; lo ^= ZH[0][j]; hi ^= ZH[1][j];
          j = (ci * 8 + rp) * 19 + (hc + 1); lo ^= ZH[0][j]; hi ^= ZH[1][j];
          this.hands[ci][rp] = hc + 1;
          if (rp === OU) this.kingSq[ci === 0 ? 1 : 0] = -1;
        }
      }
      var np = mvPromo(m) ? (pc > 0 ? prom(pc) : -prom(-pc)) : pc;
      // 風車は指すたびに飛と角が入れ替わる
      var apc = np > 0 ? np : -np;
      if (apc === WIND_R) np = (np > 0 ? WIND_B : -WIND_B);
      else if (apc === WIND_B) np = (np > 0 ? WIND_R : -WIND_R);
      // 弓兵は動いたら撃てる状態に戻る
      else if (apc === ARCHER_M) np = (np > 0 ? ARCHER_S : -ARCHER_S);
      this.board[from] = 0;
      this.board[to] = np;
      k = pieceIdx(np) * 81 + to; lo ^= ZP[0][k]; hi ^= ZP[1][k];
      if ((pc > 0 ? pc : -pc) === OU) this.kingSq[ci] = to;
      movedPiece = np;
    }
    lo ^= ZS[0]; hi ^= ZS[1];
    this.undoStack.push({ m: m, cap: cap, lo: this.keyLo, hi: this.keyHi,
                          from: from, piece: movedPiece, reborn: rebornInfo2 || null });
    this.keyLo = lo | 0; this.keyHi = hi | 0;
    this.side = -side; this.ply++;
    return this;
  };

  /* 取られた駒を持ち駒にするときの種類（特殊駒は元の普通の駒に戻る） */
  var REVERT = {};
  REVERT[KNIGHT] = KE; REVERT[P_KNIGHT] = KE;
  REVERT[NINJA] = KY; REVERT[P_NINJA] = KY;
  REVERT[WIND_R] = KA; REVERT[WIND_B] = KA;
  REVERT[ARCHER_S] = KE; REVERT[ARCHER_M] = KE;
  REVERT[REBORN] = KI; REVERT[P_REBORN] = KI;
  function handKind(p) { return REVERT[p] !== undefined ? REVERT[p] : raw(p); }

  /* 転生兵が取られたときの復活先（自陣の空きマスを中央寄りから探す） */
  var REBORN_ORDER = [5, 4, 6, 3, 7, 2, 8, 1, 9];
  Position.prototype.rebornSquare = function (side) {
    var ranks = side > 0 ? [9, 8, 7] : [1, 2, 3];
    for (var r = 0; r < 3; r++) {
      for (var f = 0; f < 9; f++) {
        var sq2 = sqOf(REBORN_ORDER[f], ranks[r]);
        if (this.board[sq2] === 0) return sq2;
      }
    }
    return -1;
  };

  /* 駒を取ったときの共通処理。
     転生兵なら相手の持ち駒にせず、自陣に歩として戻す（残り回数がある場合）。
     戻り値は「復活させた」情報（undo 用）。復活しなければ null。 */
  Position.prototype.captureTo = function (cap, ci, toSq) {
    if (cap === 0) return null;
    var owner = cap > 0 ? BLACK : WHITE;      // 取られた側
    var p = cap > 0 ? cap : -cap;
    if (p !== REBORN && p !== P_REBORN) return null;
    var oi = owner > 0 ? 0 : 1;
    if (this.rebornLeft[oi] <= 0) return null;
    var sq2 = this.rebornSquare(owner);
    if (sq2 < 0) return null;
    this.board[sq2] = FU * owner;
    this.rebornLeft[oi]--;
    void ci; void toSq;
    return { sq: sq2, owner: owner };
  };

  /* 手番のみを渡す（null move。探索専用。王手中は使用不可） */
  Position.prototype.doNull = function () {
    this.undoStack.push({ m: 0, cap: 0, lo: this.keyLo, hi: this.keyHi, from: -1, piece: 0, nul: true });
    this.keyLo = (this.keyLo ^ ZS[0]) | 0;
    this.keyHi = (this.keyHi ^ ZS[1]) | 0;
    this.side = -this.side; this.ply++;
    return this;
  };

  Position.prototype.undoMove = function () {
    var u = this.undoStack.pop();
    if (!u) return this;
    if (u.nul) {
      this.side = -this.side; this.ply--;
      this.keyLo = u.lo; this.keyHi = u.hi;
      return this;
    }
    var m = u.m;
    this.side = -this.side; this.ply--;
    var side = this.side, ci = side > 0 ? 0 : 1;
    var to = mvTo(m);

    // 転生兵の復活を取り消す
    if (u.reborn) {
      this.board[u.reborn.sq] = 0;
      this.rebornLeft[u.reborn.owner > 0 ? 0 : 1]++;
    }

    // 弓兵の射撃を取り消す（弓兵は動いていないので、状態だけ戻す）
    if (mvIsShoot(m)) {
      this.board[u.from] = ARCHER_S * side;
      this.board[to] = u.cap;
      if (u.cap !== 0 && !u.reborn) {
        this.hands[ci][handKind(u.cap < 0 ? -u.cap : u.cap)]--;
      }
      this.keyLo = u.lo; this.keyHi = u.hi;
      return this;
    }

    if (mvIsDrop(m)) {
      var pt = mvDropPiece(m);
      this.board[to] = 0;
      this.hands[ci][pt]++;
    } else {
      var from = mvFrom(m);
      var pc = this.board[to];
      var orig = mvPromo(m) ? (pc > 0 ? raw(pc) : -raw(-pc)) : pc;
      // 風車・弓兵は状態が変わっているので元に戻す
      var ao = orig > 0 ? orig : -orig, sgn = orig > 0 ? 1 : -1;
      if (ao === WIND_B) orig = WIND_R * sgn;
      else if (ao === WIND_R) orig = WIND_B * sgn;
      else if (ao === ARCHER_S) orig = ARCHER_M * sgn;
      this.board[from] = orig;
      this.board[to] = u.cap;
      if (u.cap !== 0 && !u.reborn) {
        var rp = handKind(u.cap < 0 ? -u.cap : u.cap);
        this.hands[ci][rp]--;
        if (rp === OU) this.kingSq[ci === 0 ? 1 : 0] = to;
      }
      if ((orig > 0 ? orig : -orig) === OU) this.kingSq[ci] = from;
    }
    this.keyLo = u.lo; this.keyHi = u.hi;
    return this;
  };

  /* ---------------- 合法手 ---------------- */
  Position.prototype.hasEvasionRough = function () {
    // 打ち歩詰め判定の内側で使う軽量版（打ち歩詰めの再帰は考慮しない）
    var ms = genMoves(this, [], false), side = this.side, ki = side > 0 ? 0 : 1;
    for (var i = 0; i < ms.length; i++) {
      this.doMove(ms[i]);
      var ok = !this.isAttacked(this.kingSq[ki], -side);
      this.undoMove();
      if (ok) return true;
    }
    return false;
  };

  Position.prototype.legalMoves = function () {
    var ms = genMoves(this, [], false), out = [], side = this.side, ki = side > 0 ? 0 : 1;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      this.doMove(m);
      var ok = !this.isAttacked(this.kingSq[ki], -side);
      if (ok && mvIsDrop(m) && mvDropPiece(m) === FU) {
        // 打ち歩詰め
        if (this.inCheck(this.side) && !this.hasEvasionRough()) ok = false;
      }
      this.undoMove();
      if (ok) out.push(m);
    }
    return out;
  };

  Position.prototype.isLegal = function (m) {
    var ls = this.legalMoves();
    for (var i = 0; i < ls.length; i++) if (ls[i] === m) return true;
    return false;
  };

  /* ---------------- 反則手（大会ルール用） ----------------
   *  アマチュアの大会では、二歩や打ち歩詰めを「指してしまった時点で負け」
   *  として扱う。そのため、これらの手も「指せる手」として生成し、
   *  指した瞬間に反則負けと判定できるようにする。
   *
   *  なお「行き所のない駒」と「王手放置（自殺手）」は、盤上で物理的に
   *  置けてしまう事故を防ぐため、そもそも指せない扱いにしている。
   */
  function foulDrops(pos) {
    var b = pos.board, side = pos.side, ci = side > 0 ? 0 : 1, out = [];
    var h = pos.hands[ci];
    for (var pt = 1; pt <= 7; pt++) {
      if (h[pt] === 0) continue;
      for (var sq = 0; sq < 81; sq++) {
        if (b[sq] !== 0) continue;
        var y = (sq / 9) | 0;
        // 行き所のない駒は生成しない（＝指せない）
        if (pt === FU || pt === KY) { if (side > 0 ? y === 0 : y === 8) continue; }
        else if (pt === KE) { if (side > 0 ? y <= 1 : y >= 7) continue; }
        if (pt !== FU) continue;                 // 反則になり得る打ち方は歩だけ
        var m = mkDrop(pt, sq);
        var foul = null;
        if (nifu(pos, sq % 9, side)) foul = 'nifu';
        if (!foul) {
          // 打ち歩詰めかどうか
          pos.doMove(m);
          var selfOk = !pos.isAttacked(pos.kingSq[ci], -side);
          var mate = selfOk && pos.inCheck(pos.side) && !pos.hasEvasionRough();
          pos.undoMove();
          if (!selfOk) continue;                 // 自玉が取られる手は生成しない
          if (mate) foul = 'uchifu';
        } else {
          // 二歩の手が自殺手にもなる場合は生成しない
          pos.doMove(m);
          var ok2 = !pos.isAttacked(pos.kingSq[ci], -side);
          pos.undoMove();
          if (!ok2) continue;
        }
        if (foul) out.push({ m: m, foul: foul });
      }
    }
    return out;
  }

  var FOUL_NAME = { nifu: '二歩', uchifu: '打ち歩詰め' };

  /* 合法手＋（大会ルール時の）反則手 */
  Position.prototype.movesForInput = function (allowFouls) {
    var legal = this.legalMoves();
    var out = [];
    for (var i = 0; i < legal.length; i++) out.push({ m: legal[i], foul: null });
    if (allowFouls) {
      var f = foulDrops(this);
      for (var j = 0; j < f.length; j++) out.push(f[j]);
    }
    return out;
  };

  /* ---------------- 持将棋（24点法・アマチュア大会ルール） ----------------
   *  自分の駒（盤上のすべて＋持駒、玉を除く）を
   *  飛角竜馬＝5点、その他＝1点 で数える。合計54点。
   *  双方24点以上なら持将棋（引き分け）、24点未満の側は負け。
   */
  function points24(pos, side) {
    var pt = 0, sq, pc, p;
    for (sq = 0; sq < 81; sq++) {
      pc = pos.board[sq];
      if (pc === 0 || (pc > 0) !== (side > 0)) continue;
      p = pc > 0 ? pc : -pc;
      if (p === OU) continue;
      pt += (p === KA || p === HI || p === UM || p === RY) ? 5 : 1;
    }
    var ci = side > 0 ? 0 : 1;
    for (var t = 1; t <= 7; t++) {
      var n = pos.hands[ci][t];
      if (n) pt += n * ((t === KA || t === HI) ? 5 : 1);
    }
    return pt;
  }

  /* 双方入玉しているか（両方の玉が敵陣3段目以内） */
  Position.prototype.bothEnteredCamp = function () {
    var bk = this.kingSq[0], wk = this.kingSq[1];
    if (bk < 0 || wk < 0) return false;
    return inZone(bk, BLACK) && inZone(wk, WHITE);
  };

  /* 24点法の判定結果 */
  Position.prototype.jishogiCheck = function () {
    var b = points24(this, BLACK), w = points24(this, WHITE);
    var res = { black: b, white: w, need: 24, both: this.bothEnteredCamp(), winner: 0, text: '' };
    if (b >= 24 && w >= 24) { res.winner = 0; res.text = '持将棋（引き分け）先手' + b + '点 / 後手' + w + '点'; }
    else if (b < 24 && w < 24) {
      // どちらも足りない場合は点数の多い方の勝ち（大会での慣例に合わせる）
      res.winner = b === w ? 0 : (b > w ? BLACK : WHITE);
      res.text = res.winner === 0 ? '同点により引き分け（先手' + b + '点 / 後手' + w + '点）'
        : (res.winner > 0 ? '先手' : '後手') + 'の勝ち（点数勝ち 先手' + b + '点 / 後手' + w + '点）';
    } else if (b < 24) { res.winner = WHITE; res.text = '後手の勝ち（先手' + b + '点で24点未満 / 後手' + w + '点）'; }
    else { res.winner = BLACK; res.text = '先手の勝ち（後手' + w + '点で24点未満 / 先手' + b + '点）'; }
    return res;
  };

  /* ---------------- 入玉宣言法（27点法） ---------------- */
  Position.prototype.declarationCheck = function (side) {
    var s = side === undefined ? this.side : side;
    var ci = s > 0 ? 0 : 1;
    var res = { ok: false, reasons: [], point: 0, need: s > 0 ? 28 : 27, inCamp: 0 };
    var ks = this.kingSq[ci];
    if (ks < 0) { res.reasons.push('玉がない'); return res; }
    if (!inZone(ks, s)) res.reasons.push('玉が敵陣3段目以内にいない');
    if (this.inCheck(s)) res.reasons.push('王手がかかっている');
    var pts = 0, cnt = 0;
    for (var sq = 0; sq < 81; sq++) {
      var pc = this.board[sq];
      if (pc === 0 || (pc > 0) !== (s > 0)) continue;
      var p = pc > 0 ? pc : -pc;
      if (p === OU) continue;
      if (inZone(sq, s)) {
        cnt++;
        pts += (p === KA || p === HI || p === UM || p === RY) ? 5 : 1;
      }
    }
    for (var pt = 1; pt <= 7; pt++) {
      var n = this.hands[ci][pt];
      if (n) pts += n * ((pt === KA || pt === HI) ? 5 : 1);
    }
    res.point = pts; res.inCamp = cnt;
    if (cnt < 10) res.reasons.push('敵陣の駒が10枚未満（' + cnt + '枚）');
    if (pts < res.need) res.reasons.push('点数不足（' + pts + '点 / ' + res.need + '点）');
    res.ok = res.reasons.length === 0;
    return res;
  };

  /* ---------------- SFEN ---------------- */
  function fromSfen(sfen) {
    var pos = new Position();
    var parts = String(sfen).trim().split(/\s+/);
    if (parts[0] === 'startpos') return startpos();
    var rows = parts[0].split('/');
    for (var y = 0; y < 9; y++) {
      var x = 0, r = rows[y] || '9', i = 0;
      while (i < r.length && x < 9) {
        var c = r[i];
        if (/[0-9]/.test(c)) { x += parseInt(c, 10); i++; continue; }
        var promoted = false;
        if (c === '+') { promoted = true; i++; c = r[i]; }
        var up = c.toUpperCase();
        var pt = USI_TO_PIECE[up];
        if (pt) {
          var v = promoted ? prom(pt) : pt;
          pos.board[y * 9 + x] = (c === up) ? v : -v;
        }
        x++; i++;
      }
    }
    pos.side = (parts[1] === 'w') ? WHITE : BLACK;
    var hand = parts[2] || '-';
    if (hand !== '-') {
      var num = 0;
      for (var j = 0; j < hand.length; j++) {
        var ch = hand[j];
        if (/[0-9]/.test(ch)) { num = num * 10 + parseInt(ch, 10); continue; }
        var u = ch.toUpperCase(), p2 = USI_TO_PIECE[u];
        if (p2) pos.hands[ch === u ? 0 : 1][p2] += (num || 1);
        num = 0;
      }
    }
    var mn = parseInt(parts[3], 10);
    pos.ply = isFinite(mn) ? Math.max(0, mn - 1) : 0;
    pos.computeKey();
    return pos;
  }

  Position.prototype.toSfen = function () {
    var s = '', y, x;
    for (y = 0; y < 9; y++) {
      var empty = 0;
      for (x = 0; x < 9; x++) {
        var pc = this.board[y * 9 + x];
        if (pc === 0) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        var p = pc > 0 ? pc : -pc;
        var isProm = (p >= 9 && p <= 15) || p >= 24;
        var str = (isProm ? '+' : '') + USI_CHAR[raw(p)];
        s += pc > 0 ? str : str.toLowerCase();
      }
      if (empty) s += empty;
      if (y < 8) s += '/';
    }
    s += ' ' + (this.side > 0 ? 'b' : 'w') + ' ';
    var h = '';
    for (var ci = 0; ci < 2; ci++) {
      for (var i = 0; i < HAND_ORDER.length; i++) {
        var pt = HAND_ORDER[i], n = this.hands[ci][pt];
        if (!n) continue;
        h += (n > 1 ? n : '') + (ci === 0 ? USI_CHAR[pt] : USI_CHAR[pt].toLowerCase());
      }
    }
    s += (h || '-') + ' ' + (this.ply + 1);
    return s;
  };

  function startpos() {
    var pos = new Position();
    var back = [KY, KE, GI, KI, OU, KI, GI, KE, KY];
    for (var x = 0; x < 9; x++) {
      pos.board[0 * 9 + x] = -back[x];
      pos.board[8 * 9 + x] = back[x];
      pos.board[2 * 9 + x] = -FU;
      pos.board[6 * 9 + x] = FU;
    }
    pos.board[1 * 9 + 1] = -HI; pos.board[1 * 9 + 7] = -KA;
    pos.board[7 * 9 + 1] = KA; pos.board[7 * 9 + 7] = HI;
    pos.side = BLACK;
    pos.computeKey();
    return pos;
  }

  /* ---------------- USI 手表記 ---------------- */
  function moveToUsi(m) {
    var to = mvTo(m);
    var tstr = fileOf(to) + String.fromCharCode(97 + ((to / 9) | 0));
    if (mvIsDrop(m)) return USI_CHAR[mvDropPiece(m)] + '*' + tstr;
    var from = mvFrom(m);
    var fstr = '' + fileOf(from) + String.fromCharCode(97 + ((from / 9) | 0));
    if (mvIsShoot(m)) return fstr + tstr + '!';        // 弓兵の射撃
    return fstr + tstr + (mvPromo(m) ? '+' : '');
  }

  function usiToMove(pos, s) {
    s = String(s).trim();
    if (!s) return 0;
    if (s[1] === '*') {
      var pt = USI_TO_PIECE[s[0].toUpperCase()];
      var f = parseInt(s[2], 10), r = s.charCodeAt(3) - 97;
      return mkDrop(pt, r * 9 + (9 - f));
    }
    var f1 = parseInt(s[0], 10), r1 = s.charCodeAt(1) - 97;
    var f2 = parseInt(s[2], 10), r2 = s.charCodeAt(3) - 97;
    var fq = r1 * 9 + (9 - f1), tq = r2 * 9 + (9 - f2);
    if (s[4] === '!') return mkShoot(fq, tq);
    return mkMove(fq, tq, s[4] === '+' ? 1 : 0);
  }

  /* ---------------- 日本語表記 ----------------
   * pos: 着手前の局面 / prevTo: 直前手の移動先（「同」判定用）
   */
  function moveToJa(pos, m, prevTo, opt) {
    opt = opt || {};
    var zen = !!opt.zenkaku;
    var side = pos.side;
    var mark = side > 0 ? '▲' : '△';
    var to = mvTo(m);
    var sqStr;
    if (prevTo === to) sqStr = '同';
    else sqStr = (zen ? ZEN_NUM[fileOf(to)] : String(fileOf(to))) + KANJI_NUM[rankOf(to)];
    if (mvIsDrop(m)) {
      return (opt.noMark ? '' : mark) + sqStr + PIECE_NAME[mvDropPiece(m)] + '打';
    }
    if (mvIsShoot(m)) {
      return (opt.noMark ? '' : mark) + sqStr + '弓射';
    }
    var from = mvFrom(m);
    var pc = pos.board[from], p = pc > 0 ? pc : -pc;
    var name = PIECE_NAME[p];
    var suffix = '';
    if (mvPromo(m)) suffix = '成';
    else if (CAN_PROMO[p] && (inZone(from, side) || inZone(to, side))) suffix = '不成';
    // 同一升に動ける同種駒があるか（相対表記の簡易版：元位置を括弧で示す）
    var amb = false;
    var all = genMoves(pos, [], false);
    for (var i = 0; i < all.length; i++) {
      var o = all[i];
      if (mvIsDrop(o) || mvTo(o) !== to || mvFrom(o) === from) continue;
      var opc = pos.board[mvFrom(o)];
      if ((opc > 0 ? opc : -opc) === p) { amb = true; break; }
    }
    return (opt.noMark ? '' : mark) + sqStr + name + suffix +
      (amb || opt.alwaysFrom ? '(' + fileOf(from) + rankOf(from) + ')' : '');
  }

  /* KIF形式の1手（常に移動元を付ける） */
  function moveToKif(pos, m) {
    var to = mvTo(m);
    var sqStr = ZEN_NUM[fileOf(to)] + KANJI_NUM[rankOf(to)];
    if (mvIsDrop(m)) return sqStr + PIECE_NAME[mvDropPiece(m)] + '打';
    if (mvIsShoot(m)) return sqStr + '弓射(' + fileOf(mvFrom(m)) + rankOf(mvFrom(m)) + ')';
    var from = mvFrom(m);
    var pc = pos.board[from], p = pc > 0 ? pc : -pc;
    var suffix = mvPromo(m) ? '成' : '';
    return sqStr + PIECE_NAME[p] + suffix + '(' + fileOf(from) + rankOf(from) + ')';
  }

  /* ---------------- 局面判定 ---------------- */
  function gameStatus(pos) {
    var ls = pos.legalMoves();
    if (ls.length === 0) return pos.inCheck() ? 'mate' : 'nomove';
    return 'ok';
  }

  return {
    // 定数
    EMPTY: EMPTY, FU: FU, KY: KY, KE: KE, GI: GI, KI: KI, KA: KA, HI: HI, OU: OU,
    TO: TO, NY: NY, NK: NK, NG: NG, UM: UM, RY: RY, BLACK: BLACK, WHITE: WHITE,
    PIECE_NAME: PIECE_NAME, PIECE_CHAR: PIECE_CHAR, USI_CHAR: USI_CHAR,
    KANJI_NUM: KANJI_NUM, ZEN_NUM: ZEN_NUM, HAND_ORDER: HAND_ORDER,
    CAN_PROMO: CAN_PROMO,
    // クラス/生成
    Position: Position, startpos: startpos, fromSfen: fromSfen,
    // 手の操作
    mkMove: mkMove, mkDrop: mkDrop,
    mvTo: mvTo, mvFrom: mvFrom, mvPromo: mvPromo, mvDropPiece: mvDropPiece, mvIsDrop: mvIsDrop,
    moveToUsi: moveToUsi, usiToMove: usiToMove, moveToJa: moveToJa, moveToKif: moveToKif,
    // ユーティリティ
    raw: raw, prom: prom, inZone: inZone, mustPromote: mustPromote,
    KNIGHT: KNIGHT, NINJA: NINJA, WIND_R: WIND_R, WIND_B: WIND_B,
    ARCHER_S: ARCHER_S, ARCHER_M: ARCHER_M, REBORN: REBORN,
    P_KNIGHT: P_KNIGHT, P_NINJA: P_NINJA, P_REBORN: P_REBORN,
    isSpecial: isSpecial, baseKind: baseKind, handKind: handKind,
    mkShoot: mkShoot, mvIsShoot: mvIsShoot,
    foulDrops: foulDrops, FOUL_NAME: FOUL_NAME, points24: points24,
    sqOf: sqOf, fileOf: fileOf, rankOf: rankOf, gameStatus: gameStatus,
    genMoves: genMoves
  };
});
