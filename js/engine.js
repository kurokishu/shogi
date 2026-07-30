/* ==========================================================================
 * engine.js — 思考エンジン（評価関数 + αβ探索 + 強さレベル）
 *   依存: shogi.js
 *   評価値は「先手から見た点数」（歩1枚 ≒ 100）
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shogi.js'));
  else root.Engine = factory(root.Shogi);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  var FU = S.FU, KY = S.KY, KE = S.KE, GI = S.GI, KI = S.KI, KA = S.KA, HI = S.HI, OU = S.OU;
  var TO = S.TO, NY = S.NY, NK = S.NK, NG = S.NG, UM = S.UM, RY = S.RY;
  var mvTo = S.mvTo, mvFrom = S.mvFrom, mvPromo = S.mvPromo, mvIsDrop = S.mvIsDrop, mvDropPiece = S.mvDropPiece;

  var MATE = 32000, INF = 1000000;

  /* ---------------- 定跡（オープニングブック） ----------------
   * tools/build-book.js が作った js/book.js を読み込む。
   * 無くても動く（そのまま探索する）。
   */
  var BOOK = null;
  (function loadBook() {
    try {
      if (typeof module === 'object' && module.exports) {
        try { BOOK = require('./book.js'); } catch (e) { BOOK = null; }
      } else {
        BOOK = (typeof self !== 'undefined' ? self : this).OpeningBook || null;
      }
    } catch (e) { BOOK = null; }
  })();
  function setBook(b) { BOOK = b || null; }
  function bookKey(pos) { return pos.toSfen().replace(/\s+\d+$/, ''); }
  function bookEntry(pos) {
    if (!BOOK || !BOOK.entries) return null;
    var e = BOOK.entries[bookKey(pos)];
    return (e && e.length) ? e : null;
  }
  function bookSize() { return BOOK && BOOK.entries ? BOOK.positions || Object.keys(BOOK.entries).length : 0; }

  /* 定跡から指し手を選ぶ。
   * 強いレベルほど「最善に近い手」だけを選び、弱いレベルは候補の中から広く選ぶ。 */
  function pickFromBook(pos, lv, rng, deterministic) {
    var e = bookEntry(pos);
    if (!e) return 0;
    var best = e[0][1];
    var cands = [];
    var allow = lv.temp <= 10 ? 15 : Math.min(70, 15 + lv.temp / 6);
    for (var i = 0; i < e.length; i++) {
      if (best - e[i][1] <= allow) cands.push(e[i]);
    }
    if (!cands.length) cands = [e[0]];
    var pickIdx = (deterministic || cands.length === 1) ? 0 : Math.floor(rng() * cands.length);
    var m = S.usiToMove(pos, cands[pickIdx][0]);
    // 念のため合法性を確認
    var legal = pos.legalMoves();
    for (var j = 0; j < legal.length; j++) if (legal[j] === m) return m;
    return 0;
  }

  /* ---------------- 強さレベル ----------------
   * depth   : 反復深化の最大深さ
   * time    : 1手の思考時間(ms)
   * temp    : 手選択のばらつき（大きいほど弱手も選ぶ / 単位は評価値）
   * blunder : ランダムな見落ちを起こす確率
   * rating  : 段位換算用の内部レーティング目安
   */
  var LEVELS = [
    { id: 1, name: 'アマ入門', note: '駒の取り合いが分かる程度。かなり見落とす', bookPly: 4, depth: 1, time: 50, temp: 900, blunder: 0.30, rating: 150 },
    { id: 2, name: 'アマ初級', note: '1手先は見る。大きな見落ちがときどき出る', bookPly: 8, depth: 1, time: 120, temp: 550, blunder: 0.18, rating: 500 },
    { id: 3, name: 'アマ中級', note: '駒の損得に敏感。簡単な詰みは見える', bookPly: 12, depth: 2, time: 250, temp: 380, blunder: 0.10, rating: 800 },
    { id: 4, name: 'アマ上級', note: '囲いを作り、寄せの形が分かる', bookPly: 16, depth: 3, time: 450, temp: 240, blunder: 0.05, rating: 1100 },
    { id: 5, name: 'アマ有段者', note: '中盤で大きく間違えない', bookPly: 20, depth: 4, time: 800, temp: 150, blunder: 0.025, rating: 1350 },
    { id: 6, name: 'アマ強豪', note: '終盤が正確。緩手を突いてくる', bookPly: 24, depth: 5, time: 1300, temp: 90, blunder: 0.010, rating: 1700 },
    { id: 7, name: 'アマトップ', note: '県代表クラス。ほぼ間違えない', bookPly: 999, depth: 6, time: 2000, temp: 50, blunder: 0.004, rating: 2200 },
    { id: 8, name: 'プロ', note: '深く読む。少しの緩みも見逃さない', bookPly: 999, depth: 7, time: 3000, temp: 22, blunder: 0.0015, rating: 2500 },
    { id: 9, name: 'プロトップ', note: 'タイトル保持者クラスを想定', bookPly: 999, depth: 8, time: 4500, temp: 8, blunder: 0, rating: 2750 },
    { id: 10, name: '電脳戦', note: 'プロ以上。手加減なしの全力（時間も長い）', bookPly: 999, depth: 12, time: 7000, temp: 0, blunder: 0, rating: 3000 }
  ];
  function level(id) { return LEVELS[Math.max(1, Math.min(LEVELS.length, id | 0)) - 1]; }

  /* ---------------- 手の精度（棋譜解析用の指標） ----------------
   * 評価値をそのまま引き算すると、勝敗が決まった局面での大きな振れが
   * 平均を壊してしまう。勝率に変換してから比べることで、
   * 「互角の局面での間違い」を正しく重く評価する。
   */
  function winProb(cp) {
    var c = Math.max(-4000, Math.min(4000, cp));
    return 1 / (1 + Math.exp(-c / 600));
  }
  /* 勝率の落ち込み(0..1) → 1手の精度(0..100) */
  function moveAccuracy(lossWp) {
    var a = 103.1668 * Math.exp(-4.354 * Math.max(0, lossWp)) - 3.1669;
    return Math.max(0, Math.min(100, a));
  }
  /* 平均精度 → 推定レーティング（このアプリのCPを基準に校正） */
  var ACC_TABLE = [
    [52, 150], [60, 400], [66, 650], [72, 900], [78, 1150],
    [83, 1450], [87, 1800], [91, 2150], [95, 2550], [98, 2900]
  ];
  function ratingFromAccuracy(acc) {
    if (acc <= ACC_TABLE[0][0]) return ACC_TABLE[0][1];
    for (var i = 1; i < ACC_TABLE.length; i++) {
      if (acc <= ACC_TABLE[i][0]) {
        var a0 = ACC_TABLE[i - 1][0], a1 = ACC_TABLE[i][0];
        var r0 = ACC_TABLE[i - 1][1], r1 = ACC_TABLE[i][1];
        return Math.round(r0 + (acc - a0) / (a1 - a0) * (r1 - r0));
      }
    }
    return 3000;
  }

  /* 内部レーティング → 段級位 */
  var RANK_TABLE = [
    [-9999, '15級'], [200, '12級'], [320, '10級'], [440, '8級'], [560, '7級'], [660, '6級'],
    [760, '5級'], [860, '4級'], [960, '3級'], [1060, '2級'], [1160, '1級'],
    [1260, '初段'], [1400, '二段'], [1550, '三段'], [1700, '四段'], [1850, '五段'],
    [2000, '六段（県代表クラス）'], [2200, 'アマ七段（アマトップ）'], [2400, 'プロ級'],
    [2600, 'プロ上位'], [2850, 'プロトップ超（電脳戦クラス）']
  ];
  function rankName(rating) {
    var name = RANK_TABLE[0][1];
    for (var i = 0; i < RANK_TABLE.length; i++) if (rating >= RANK_TABLE[i][0]) name = RANK_TABLE[i][1];
    return name;
  }

  /* ---------------- 駒の価値 ---------------- */
  //           空  歩  香  桂  銀  金   角  飛   玉    と  杏   圭   全   -    馬    竜
  var V = [0, 100, 350, 420, 550, 600, 820, 980, 20000, 610, 560, 560, 610, 0, 1080, 1250];
  var VH = [0, 118, 400, 470, 610, 660, 920, 1090, 0]; // 持駒（打てる分だけ価値が高い）
  // 玉への接近ボーナス（攻め）
  var ATT = [0, 3, 4, 5, 7, 8, 8, 10, 0, 8, 6, 6, 8, 0, 12, 14];
  // 自玉の守りボーナス（囲いを作る動機づけ。金銀を高めにしてある）
  var DEF = [0, 7, 4, 5, 17, 19, 4, 4, 0, 12, 9, 9, 12, 0, 6, 6];

  /* ---------------- 駒別位置評価（先手視点） ---------------- */
  var PST = [];
  var MIRROR_SQ = new Int32Array(81);
  (function buildPst() {
    for (var i = 0; i < 81; i++) MIRROR_SQ[i] = 80 - i;
    var center = [0, 3, 6, 9, 12, 9, 6, 3, 0];
    var kingY = [-95, -78, -60, -40, -18, 2, 16, 26, 22];
    var kingX = [10, 16, 20, 10, -12, 10, 20, 16, 10];
    for (var p = 0; p <= 15; p++) {
      var t = new Int32Array(81);
      for (var sq = 0; sq < 81; sq++) {
        var x = sq % 9, y = (sq / 9) | 0, adv = 6 - y, v = 0;
        switch (p) {
          case FU: v = adv * 9 + (y <= 2 ? 24 : 0); break;
          case KY: v = adv * 3; break;
          case KE: v = adv * 7 + ((x === 0 || x === 8) ? -22 : 0); break;
          case GI: v = adv * 6 + center[x]; break;
          case KI: v = (7 - y) * 5 + center[x]; break;
          case KA: v = center[x] * 2 + adv * 3; break;
          case HI: v = adv * 4 + center[x]; break;
          case OU: v = kingY[y] + kingX[x]; break;
          case TO: case NG: v = (7 - y) * 6 + center[x] + 12; break;
          case NY: case NK: v = (7 - y) * 6 + center[x] + 8; break;
          case UM: v = center[x] * 2 + 24; break;
          case RY: v = center[x] * 2 + adv * 3 + 24; break;
        }
        t[sq] = v;
      }
      PST[p] = t;
    }
  })();

  function cheb(a, b) {
    var dx = (a % 9) - (b % 9), dy = ((a / 9) | 0) - ((b / 9) | 0);
    if (dx < 0) dx = -dx; if (dy < 0) dy = -dy;
    return dx > dy ? dx : dy;
  }

  var DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  var DY = [-1, -1, -1, 0, 0, 1, 1, 1];
  var DIAG = [0, 2, 5, 7], ORTH = [1, 3, 4, 6];

  function mobility(board, sq, dirs) {
    var x = sq % 9, y = (sq / 9) | 0, n = 0;
    for (var i = 0; i < dirs.length; i++) {
      var d = dirs[i], nx = x + DX[d], ny = y + DY[d];
      while (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 8) {
        n++;
        if (board[ny * 9 + nx] !== 0) break;
        nx += DX[d]; ny += DY[d];
      }
    }
    return n;
  }

  /* ---------------- 評価関数（先手視点） ---------------- */
  function evaluate(pos) {
    var b = pos.board, s = 0, sq, pc, p;
    var bk = pos.kingSq[0], wk = pos.kingSq[1];
    for (sq = 0; sq < 81; sq++) {
      pc = b[sq];
      if (pc === 0) continue;
      if (pc > 0) {
        p = pc;
        s += V[p] + PST[p][sq];
        if (p !== OU) {
          if (wk >= 0) { var d1 = 6 - cheb(sq, wk); if (d1 > 0) s += ATT[p] * d1; }
          if (bk >= 0) { var d2 = 3 - cheb(sq, bk); if (d2 > 0) s += DEF[p] * d2; }
        }
      } else {
        p = -pc;
        s -= V[p] + PST[p][MIRROR_SQ[sq]];
        if (p !== OU) {
          if (bk >= 0) { var d3 = 6 - cheb(sq, bk); if (d3 > 0) s -= ATT[p] * d3; }
          if (wk >= 0) { var d4 = 3 - cheb(sq, wk); if (d4 > 0) s -= DEF[p] * d4; }
        }
      }
      // 大駒の利きの広さ
      if (p === HI || p === RY) s += (pc > 0 ? 1 : -1) * mobility(b, sq, ORTH) * 4;
      if (p === KA || p === UM) s += (pc > 0 ? 1 : -1) * mobility(b, sq, DIAG) * 4;
    }
    for (var pt = 1; pt <= 7; pt++) {
      var n0 = pos.hands[0][pt], n1 = pos.hands[1][pt];
      if (n0) s += VH[pt] * n0;
      if (n1) s -= VH[pt] * n1;
    }
    // 玉が動かされている（囲いが崩れている）ペナルティは PST で表現済み
    return s;
  }

  /* ================================================================
   *  探索
   * ================================================================ */
  var TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  var ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE);
  var ttScore = new Int32Array(TT_SIZE), ttInfo = new Int32Array(TT_SIZE);
  var ttGen = 0;

  var killers = new Int32Array(128 * 2);
  var history = new Int32Array(32 * 81);

  var nodes = 0, startTime = 0, timeLimit = 0, stopped = false, abortFlag = null;
  var seldepth = 0;

  function clearTT() { ttKey.fill(0); ttMove.fill(0); ttScore.fill(0); ttInfo.fill(0); ttGen = 0; }
  function newSearch() {
    killers.fill(0);
    for (var i = 0; i < history.length; i++) history[i] = (history[i] / 8) | 0;
    nodes = 0; stopped = false; seldepth = 0; ttGen++;
  }

  function now() { return Date.now(); }
  function timeUp() {
    if (stopped) return true;
    if (abortFlag && abortFlag()) { stopped = true; return true; }
    if (now() - startTime >= timeLimit) { stopped = true; return true; }
    return false;
  }

  function histIdx(pos, m) {
    var to = mvTo(m);
    if (mvIsDrop(m)) return (16 + mvDropPiece(m)) * 81 + to;
    var pc = pos.board[mvFrom(m)];
    return (pc > 0 ? pc : -pc) * 81 + to;
  }

  function orderMoves(pos, ms, scores, ttm, ply) {
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i], sc;
      if (m === ttm) { scores[i] = 1 << 27; continue; }
      var to = mvTo(m), cap = pos.board[to];
      if (cap !== 0) {
        var cp = cap > 0 ? cap : -cap;
        var mp = mvIsDrop(m) ? 0 : (pos.board[mvFrom(m)] > 0 ? pos.board[mvFrom(m)] : -pos.board[mvFrom(m)]);
        sc = (1 << 22) + V[cp] * 8 - V[mp];
      } else if (m === killers[ply * 2] || m === killers[ply * 2 + 1]) {
        sc = 1 << 21;
      } else {
        sc = history[histIdx(pos, m)];
        if (sc > (1 << 20)) sc = 1 << 20;
      }
      if (mvPromo(m)) sc += 4000;
      scores[i] = sc;
    }
  }

  function pickBest(ms, scores, from) {
    var bi = from, bs = scores[from];
    for (var i = from + 1; i < ms.length; i++) if (scores[i] > bs) { bs = scores[i]; bi = i; }
    if (bi !== from) {
      var tm = ms[from]; ms[from] = ms[bi]; ms[bi] = tm;
      var ts = scores[from]; scores[from] = scores[bi]; scores[bi] = ts;
    }
    return ms[from];
  }

  /* 静止探索 */
  function qsearch(pos, alpha, beta, ply, qd) {
    nodes++;
    if ((nodes & 1023) === 0 && timeUp()) return 0;
    if (ply > seldepth) seldepth = ply;
    var side = pos.side, ki = side > 0 ? 0 : 1;
    var inChk = pos.isAttacked(pos.kingSq[ki], -side);
    var stand = -INF;
    if (!inChk) {
      stand = evaluate(pos) * side;
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      if (qd <= 0) return alpha;
    } else if (qd <= -4) {
      return evaluate(pos) * side;
    }
    var ms = pos.genMoves(!inChk);
    if (!ms.length) return inChk ? -MATE + ply : alpha;
    var scores = new Int32Array(ms.length);
    orderMoves(pos, ms, scores, 0, Math.min(ply, 127));
    var best = stand, legal = 0;
    for (var i = 0; i < ms.length; i++) {
      var m = pickBest(ms, scores, i);
      var cap = mvIsDrop(m) ? 0 : pos.board[mvTo(m)];
      // デルタ枝刈り
      if (!inChk && stand > -INF && cap !== 0) {
        var cv = V[cap > 0 ? cap : -cap];
        if (stand + cv + 180 < alpha) continue;
      }
      pos.doMove(m);
      if (pos.isAttacked(pos.kingSq[ki], -side)) { pos.undoMove(); continue; }
      legal++;
      var sc = -qsearch(pos, -beta, -alpha, ply + 1, qd - 1);
      pos.undoMove();
      if (stopped) return 0;
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) return alpha;
    }
    if (inChk && legal === 0) return -MATE + ply;
    return best === -INF ? alpha : best;
  }

  /* 主探索 */
  function alphabeta(pos, depth, alpha, beta, ply, canNull) {
    if (stopped) return 0;
    nodes++;
    if ((nodes & 1023) === 0 && timeUp()) return 0;

    var idx = (pos.keyLo & TT_MASK) >>> 0, ttm = 0;
    if (ttKey[idx] === pos.keyHi && ttKey[idx] !== 0) {
      var info = ttInfo[idx], td = info & 255, fl = (info >> 8) & 3;
      ttm = ttMove[idx];
      var tsc = ttScore[idx];
      if (ply > 0 && td >= depth && tsc > -MATE + 1000 && tsc < MATE - 1000) {
        if (fl === 1) return tsc;
        if (fl === 3 && tsc >= beta) return tsc;
        if (fl === 2 && tsc <= alpha) return tsc;
      }
    }

    var side = pos.side, ki = side > 0 ? 0 : 1;
    var inChk = pos.isAttacked(pos.kingSq[ki], -side);
    if (inChk && depth < 1) depth = 1;                 // 王手されていれば必ず1手は読む
    if (depth <= 0) return qsearch(pos, alpha, beta, ply, 8);

    // ヌルムーブ枝刈り
    if (canNull && !inChk && depth >= 3 && ply > 0 && beta < MATE - 1000) {
      var ev = evaluate(pos) * side;
      if (ev >= beta) {
        var R = depth > 6 ? 3 : 2;
        pos.doNull();
        var ns = -alphabeta(pos, depth - 1 - R, -beta, -beta + 1, ply + 1, false);
        pos.undoMove();
        if (stopped) return 0;
        if (ns >= beta) return beta;
      }
    }

    var ms = pos.genMoves(false);
    var scores = new Int32Array(ms.length);
    var pl = Math.min(ply, 127);
    orderMoves(pos, ms, scores, ttm, pl);

    var best = -INF, bestMove = 0, legal = 0, origAlpha = alpha;
    for (var i = 0; i < ms.length; i++) {
      var m = pickBest(ms, scores, i);
      var isCap = !mvIsDrop(m) && pos.board[mvTo(m)] !== 0;
      pos.doMove(m);
      if (pos.isAttacked(pos.kingSq[ki], -side)) { pos.undoMove(); continue; }
      if (mvIsDrop(m) && mvDropPiece(m) === FU) {
        // 打ち歩詰め
        if (pos.isAttacked(pos.kingSq[ki === 0 ? 1 : 0], side) && !pos.hasEvasionRough()) { pos.undoMove(); continue; }
      }
      legal++;
      var givesCheck = pos.isAttacked(pos.kingSq[ki === 0 ? 1 : 0], side);
      var nd = depth - 1;
      if (givesCheck && ply + depth < 40) nd = depth;                     // 王手延長
      else if (depth >= 3 && legal > 4 && !isCap && !mvPromo(m)) nd = depth - 2; // LMR

      var sc;
      if (legal === 1) {
        sc = -alphabeta(pos, nd, -beta, -alpha, ply + 1, true);
      } else {
        sc = -alphabeta(pos, nd, -alpha - 1, -alpha, ply + 1, true);
        if (sc > alpha && sc < beta) sc = -alphabeta(pos, depth - 1 + (givesCheck && ply + depth < 40 ? 1 : 0), -beta, -alpha, ply + 1, true);
      }
      pos.undoMove();
      if (stopped) return 0;

      if (sc > best) { best = sc; bestMove = m; }
      if (sc > alpha) {
        alpha = sc;
        if (alpha >= beta) {
          if (!isCap) {
            if (killers[pl * 2] !== m) { killers[pl * 2 + 1] = killers[pl * 2]; killers[pl * 2] = m; }
            history[histIdx(pos, m)] += depth * depth;
          }
          break;
        }
      }
    }

    if (legal === 0) return -MATE + ply;   // 詰み（または手詰まり）＝負け

    var flag = alpha >= beta ? 3 : (best > origAlpha ? 1 : 2);
    ttKey[idx] = pos.keyHi; ttMove[idx] = bestMove;
    ttScore[idx] = best; ttInfo[idx] = (depth & 255) | (flag << 8);
    return best;
  }

  /* TT から読み筋を復元 */
  function extractPv(pos, firstMove, maxLen) {
    var pv = [], done = [];
    var m = firstMove;
    for (var i = 0; i < (maxLen || 10); i++) {
      if (!m) break;
      var legal = pos.legalMoves(), ok = false;
      for (var j = 0; j < legal.length; j++) if (legal[j] === m) { ok = true; break; }
      if (!ok) break;
      pv.push(m);
      pos.doMove(m); done.push(1);
      var idx = (pos.keyLo & TT_MASK) >>> 0;
      m = (ttKey[idx] === pos.keyHi && ttKey[idx] !== 0) ? ttMove[idx] : 0;
    }
    for (var k = 0; k < done.length; k++) pos.undoMove();
    return pv;
  }

  /* ---------------- ルート探索 ---------------- */
  /* opt: {level, timeMs, depth, onInfo, deterministic, abort, rng} */
  function think(pos, opt) {
    opt = opt || {};
    var lv = level(opt.level || 6);
    var maxDepth = opt.depth || lv.depth;
    timeLimit = opt.timeMs || lv.time;
    abortFlag = opt.abort || null;
    startTime = now();
    newSearch();

    var roots = pos.legalMoves();
    if (!roots.length) {
      return { move: 0, score: -MATE, depth: 0, nodes: 0, pv: [], mate: true, roots: [] };
    }

    // 定跡にある局面ならそこから指す（研究済みの手なので読み直さない）
    // 弱いレベルは早めに定跡を離れる（序盤だけ強いのは不自然なため）
    var bookLimit = lv.bookPly === undefined ? 999 : lv.bookPly;
    if (opt.useBook !== false && pos.ply < bookLimit) {
      var bm = pickFromBook(pos, lv, opt.rng || Math.random, opt.deterministic);
      if (bm) {
        var be = bookEntry(pos);
        return {
          move: bm, best: S.usiToMove(pos, be[0][0]), score: be[0][1], depth: 0,
          nodes: 0, time: 0, pv: [bm], book: true,
          roots: be.map(function (x) { return { m: S.usiToMove(pos, x[0]), score: x[1] }; })
        };
      }
    }
    var results = [];
    for (var i = 0; i < roots.length; i++) results.push({ m: roots[i], score: -INF });

    var completed = 0, bestPv = [], bestScore = 0;
    for (var d = 1; d <= maxDepth; d++) {
      var best = -INF, bestMove = 0;
      for (var r = 0; r < results.length; r++) {
        var rm = results[r];
        pos.doMove(rm.m);
        var sc;
        if (r === 0) {
          sc = -alphabeta(pos, d - 1, -INF, INF, 1, true);
        } else {
          var lo = best - 420;
          sc = -alphabeta(pos, d - 1, -INF, -lo, 1, true);
          if (sc > lo && d >= 2) sc = -alphabeta(pos, d - 1, -INF, INF, 1, true);
        }
        pos.undoMove();
        if (stopped) break;
        rm.newScore = sc;
        if (sc > best) { best = sc; bestMove = rm.m; }
      }
      if (stopped) break;
      for (var q = 0; q < results.length; q++) {
        if (results[q].newScore !== undefined) results[q].score = results[q].newScore;
      }
      results.sort(function (a, b) { return b.score - a.score; });
      completed = d;
      bestScore = best;
      bestPv = extractPv(pos, bestMove, 12);
      if (opt.onInfo) {
        opt.onInfo({
          depth: d, seldepth: seldepth, score: best, nodes: nodes,
          time: now() - startTime, pv: bestPv.slice()
        });
      }
      if (best >= MATE - 200 || best <= -MATE + 200) break;   // 詰みが確定
      if (now() - startTime > timeLimit * 0.55) break;         // 次の反復は間に合わない
    }
    if (completed === 0) {
      // 時間が極端に短い場合の保険（1手だけ静的評価で選ぶ）
      for (var z = 0; z < results.length; z++) {
        pos.doMove(results[z].m);
        results[z].score = -(evaluate(pos) * pos.side); // 指した側から見た評価値
        pos.undoMove();
      }
      results.sort(function (a, b) { return b.score - a.score; });
      completed = 1; bestScore = results[0].score;
    }

    var chosen = opt.deterministic ? results[0].m : pickMove(results, lv, opt.rng || Math.random, pos.ply, pos);
    return {
      move: chosen, best: results[0].m, score: bestScore, depth: completed, seldepth: seldepth,
      nodes: nodes, time: now() - startTime, pv: bestPv,
      roots: results.map(function (r) { return { m: r.m, score: r.score }; })
    };
  }

  /* 序盤の「手らしさ」補正
   * 定跡を持っていないため、序盤は候補手の評価値がほぼ横並びになり、
   * 香を上がる・玉を前に出す・飛車を下段で振り回すといった不自然な手が
   * 選ばれてしまう。序盤16手だけ、人が指しそうな手に軽い下駄をはかせる。
   * （評価値で明確に差がつく手は覆らない程度の大きさにしてある）
   */
  function openingBonus(pos, m) {
    if (mvIsDrop(m)) return 0;
    var from = mvFrom(m), to = mvTo(m);
    var pc = pos.board[from];
    if (!pc) return 0;
    var p = pc > 0 ? pc : -pc, side = pc > 0 ? 1 : -1;
    var fy = (from / 9) | 0, ty = (to / 9) | 0;
    var forward = side > 0 ? ty < fy : ty > fy;
    var b = 0;
    if (p === KY) b -= 90;                                   // 序盤に香を動かすことはほぼ無い
    else if (p === KE) b -= 20;                              // 桂もまだ跳ねない
    else if (p === OU) { b -= 12; if (forward) b -= 60; }     // 玉は囲いに入るだけ
    else if (p === FU) b += 25;                              // 歩を突くのは自然
    else if (p === GI || p === KI) { if (forward) b += 15; }   // 金銀は前へ
    else if (p === HI && fy === (side > 0 ? 7 : 1) && ty === fy) b -= 40; // 下段での振り回し
    return b;
  }

  /* 強さレベルに応じた手の選び方（弱いレベルはわざと精度を落とす） */
  function pickMove(results, lv, rng, ply, pos) {
    if (results.length === 1) return results[0].m;
    var opening = ply < 16;
    if (opening && pos) {
      // 序盤の手らしさを score に織り込んでから選ぶ
      results = results.map(function (r) {
        return { m: r.m, score: r.score + openingBonus(pos, r.m) };
      }).sort(function (a, b) { return b.score - a.score; });
    }
    // 明らかな見落ち（序盤は起こしにくくする）
    var blunder = opening ? lv.blunder * 0.35 : lv.blunder;
    if (blunder > 0 && rng() < blunder) {
      var k = Math.floor(rng() * results.length);
      // 詰まされる手だけは避ける（レベル1でも自玉を即詰みにはしない）
      if (results[k].score > -MATE + 300) return results[k].m;
    }
    var temp = lv.temp;
    // 序盤は「上位レベルでも少しばらつかせ」「下位レベルでも無茶をしない」
    // ようにする。弱さは中盤以降で出したほうが人間らしい。
    if (opening) temp = Math.min(Math.max(temp, 28), 110);
    if (temp <= 0) return results[0].m;
    var top = results[0].score;
    // 詰みが見えているときは最善を選ぶ
    if (top >= MATE - 200) return results[0].m;
    var weights = [], total = 0;
    for (var i = 0; i < results.length; i++) {
      var diff = top - results[i].score;
      if (diff > temp * 4) break;
      var w = Math.exp(-diff / temp);
      weights.push(w); total += w;
    }
    var t = rng() * total;
    for (var j = 0; j < weights.length; j++) { t -= weights[j]; if (t <= 0) return results[j].m; }
    return results[0].m;
  }

  /* 解析用：最善手と評価値だけを求める（手加減なし） */
  function analyze(pos, opt) {
    opt = opt || {};
    return think(pos, {
      level: 10, depth: opt.depth || 8, timeMs: opt.timeMs || 600,
      deterministic: true, abort: opt.abort, onInfo: opt.onInfo
    });
  }

  return {
    LEVELS: LEVELS, level: level, rankName: rankName, RANK_TABLE: RANK_TABLE,
    MATE: MATE, V: V, VH: VH,
    winProb: winProb, moveAccuracy: moveAccuracy, ratingFromAccuracy: ratingFromAccuracy,
    setBook: setBook, bookSize: bookSize, bookEntry: bookEntry,
    evaluate: evaluate, think: think, analyze: analyze, clearTT: clearTT,
    stop: function () { stopped = true; }
  };
});
