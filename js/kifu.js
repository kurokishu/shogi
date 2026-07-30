/* ==========================================================================
 * kifu.js — 棋譜の入出力（KIF形式 / SFEN・USI / localStorage 保存）
 *   依存: shogi.js
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./shogi.js'));
  else root.Kifu = factory(root.Shogi);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  var ZEN2HAN = { '１': 1, '２': 2, '３': 3, '４': 4, '５': 5, '６': 6, '７': 7, '８': 8, '９': 9 };
  var KAN2NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var NAME2PIECE = {
    '歩': S.FU, '香': S.KY, '桂': S.KE, '銀': S.GI, '金': S.KI, '角': S.KA, '飛': S.HI,
    '玉': S.OU, '王': S.OU,
    'と': S.TO, '成香': S.NY, '杏': S.NY, '成桂': S.NK, '圭': S.NK, '成銀': S.NG, '全': S.NG,
    '馬': S.UM, '竜': S.RY, '龍': S.RY
  };
  // 長い名前を先に試す
  var NAME_KEYS = Object.keys(NAME2PIECE).sort(function (a, b) { return b.length - a.length; });

  var END_WORDS = ['投了', '中断', '千日手', '持将棋', '切れ負け', '反則勝ち', '反則負け', '入玉宣言', '詰み', '不詰', 'time', 'resign'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(d) {
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function fmtSec(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }
  function fmtHms(s) {
    s = Math.max(0, Math.round(s));
    return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
  }

  /* ------------------------------------------------------------------
   *  KIF 書き出し
   *  game: {startSfen, moves:[{usi, sec}], black, white, result, startedAt}
   * ------------------------------------------------------------------ */
  function toKif(game) {
    var lines = [];
    lines.push('#KIF version=2.0 encoding=UTF-8');
    lines.push('# 将棋アプリで作成');
    lines.push('開始日時：' + fmtDate(game.startedAt ? new Date(game.startedAt) : new Date()));
    var isStart = !game.startSfen || game.startSfen === S.startpos().toSfen();
    if (isStart) lines.push('手合割：平手');
    else lines.push('後手の持駒：（SFEN）' + game.startSfen);
    lines.push('先手：' + (game.black || '先手'));
    lines.push('後手：' + (game.white || '後手'));
    lines.push('手数----指手---------消費時間--');

    var pos = isStart ? S.startpos() : S.fromSfen(game.startSfen);
    var total = [0, 0];
    for (var i = 0; i < game.moves.length; i++) {
      var mv = game.moves[i];
      var m = S.usiToMove(pos, mv.usi);
      var ja = S.moveToKif(pos, m);
      var ci = pos.side > 0 ? 0 : 1;
      var sec = mv.sec || 0;
      total[ci] += sec;
      lines.push(' ' + rpad(String(i + 1), 4) + ' ' + rpad(ja, 14) +
        '(' + lpad(fmtSec(sec), 5) + '/' + fmtHms(total[ci]) + ')');
      pos.doMove(m);
    }
    if (game.result && game.result.kif) {
      lines.push(' ' + rpad(String(game.moves.length + 1), 4) + ' ' + game.result.kif);
    }
    if (game.result && game.result.text) lines.push('*' + game.result.text);
    return lines.join('\n') + '\n';
  }
  function rpad(s, n) { while (s.length < n) s += ' '; return s; }
  function lpad(s, n) { while (s.length < n) s = ' ' + s; return s; }

  /* ------------------------------------------------------------------
   *  KIF 読み込み（best effort）
   *  → {black, white, startSfen, moves:[{usi, sec}], result, header}
   * ------------------------------------------------------------------ */
  function parseKif(text) {
    var lines = String(text).replace(/\r/g, '').split('\n');
    var header = {}, moves = [], startSfen = null, result = null;
    var pos = null, prevTo = -1;
    var pendingSfen = null;

    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (!line) continue;
      var t = line.trim();
      if (!t) continue;
      if (t[0] === '#') continue;
      if (t[0] === '*') { continue; }              // コメント
      if (/^[|+]/.test(t)) continue;              // 盤面図はスキップ

      // ヘッダ
      var hm = t.match(/^([^：:0-9\s][^：:]*)[：:](.*)$/);
      if (hm && !/^\s*\d/.test(t)) {
        var key = hm[1].trim(), val = hm[2].trim();
        header[key] = val;
        if (key === '先手' || key === '下手') header.black = val;
        if (key === '後手' || key === '上手') header.white = val;
        var sf = val.match(/([1-9lnsgkrbpLNSGKRBP+\/]{10,})\s+[bw]\s+\S+(\s+\d+)?/);
        if (sf) pendingSfen = sf[0];
        continue;
      }

      // 指し手行
      var mm = t.match(/^(\d+)\s+(.+)$/);
      if (!mm) continue;
      var body = mm[2].trim();
      // 消費時間部分を除去
      var timeSec = 0;
      var tm = body.match(/\(\s*(\d+):(\d+)\s*\//);
      if (tm) timeSec = parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10);
      body = body.replace(/\(\s*\d+:\d+.*$/, '').trim();

      if (!pos) { startSfen = pendingSfen; pos = startSfen ? S.fromSfen(startSfen) : S.startpos(); }

      var isEnd = false;
      for (var e = 0; e < END_WORDS.length; e++) {
        if (body.indexOf(END_WORDS[e]) === 0) {
          result = { kif: END_WORDS[e], text: END_WORDS[e] };
          isEnd = true; break;
        }
      }
      if (isEnd) break;

      var mv = parseJaMove(pos, body, prevTo);
      if (mv === 0) continue;
      moves.push({ usi: S.moveToUsi(mv), sec: timeSec });
      prevTo = S.mvTo(mv);
      pos.doMove(mv);
    }
    if (!pos) { startSfen = pendingSfen; }
    return {
      black: header.black || '先手', white: header.white || '後手',
      startSfen: startSfen, moves: moves, result: result, header: header
    };
  }

  /* 日本語表記1手 → 指し手 */
  function parseJaMove(pos, tok, prevTo) {
    var s = tok.replace(/[ 　]/g, '');
    var to = -1, i = 0;
    if (s.indexOf('同') === 0) { to = prevTo; i = 1; }
    else {
      var f = ZEN2HAN[s[0]] || (/[1-9]/.test(s[0]) ? parseInt(s[0], 10) : 0);
      var r = KAN2NUM[s[1]] || (/[1-9]/.test(s[1]) ? parseInt(s[1], 10) : 0);
      if (!f || !r) return 0;
      to = S.sqOf(f, r); i = 2;
    }
    if (to < 0) return 0;
    // 駒名
    var pt = 0, rest = s.slice(i);
    for (var k = 0; k < NAME_KEYS.length; k++) {
      if (rest.indexOf(NAME_KEYS[k]) === 0) { pt = NAME2PIECE[NAME_KEYS[k]]; rest = rest.slice(NAME_KEYS[k].length); break; }
    }
    if (!pt) return 0;
    var promo = 0, isDrop = false;
    if (rest.indexOf('不成') === 0) rest = rest.slice(2);
    else if (rest.indexOf('成') === 0) { promo = 1; rest = rest.slice(1); }
    if (rest.indexOf('打') === 0) { isDrop = true; rest = rest.slice(1); }
    var om = rest.match(/^\(?(\d)(\d)\)?/);
    var legal = pos.legalMoves(), j;
    if (om) {
      var from = S.sqOf(parseInt(om[1], 10), parseInt(om[2], 10));
      var want = S.mkMove(from, to, promo);
      for (j = 0; j < legal.length; j++) if (legal[j] === want) return want;
      // 成駒名で書かれている場合など
      want = S.mkMove(from, to, promo ? 0 : 1);
      for (j = 0; j < legal.length; j++) if (legal[j] === want) return want;
      return 0;
    }
    if (isDrop || true) {
      var rawPt = S.raw(pt);
      var drop = S.mkDrop(rawPt, to);
      for (j = 0; j < legal.length; j++) if (legal[j] === drop) return drop;
    }
    // 移動元不明：条件に合う手が一つだけならそれを採用
    var cands = [];
    for (j = 0; j < legal.length; j++) {
      var m = legal[j];
      if (S.mvTo(m) !== to) continue;
      if (S.mvIsDrop(m)) { if (S.mvDropPiece(m) === S.raw(pt)) cands.push(m); continue; }
      var pc = pos.board[S.mvFrom(m)], ap = pc > 0 ? pc : -pc;
      var after = S.mvPromo(m) ? S.prom(ap) : ap;
      if (after === pt || (ap === pt && !S.mvPromo(m)) || (promo && ap === pt)) cands.push(m);
    }
    if (cands.length === 1) return cands[0];
    for (j = 0; j < cands.length; j++) if (!!S.mvPromo(cands[j]) === !!promo) return cands[j];
    return cands.length ? cands[0] : 0;
  }

  /* ------------------------------------------------------------------
   *  SFEN / USI テキストの読み込み
   *  "position startpos moves 7g7f 3c3d" / "sfen ... moves ..." / USIの羅列
   * ------------------------------------------------------------------ */
  function parseUsiText(text) {
    var t = String(text).replace(/\s+/g, ' ').trim();
    t = t.replace(/^position\s+/, '');
    var startSfen = null, movePart = t;
    if (t.indexOf('startpos') === 0) {
      movePart = t.slice(8);
    } else if (t.indexOf('sfen ') === 0) {
      var rest = t.slice(5), mi = rest.indexOf(' moves ');
      if (mi >= 0) { startSfen = rest.slice(0, mi); movePart = rest.slice(mi); }
      else { startSfen = rest; movePart = ''; }
    } else {
      var m2 = t.match(/^([1-9a-zA-Z+\/]{10,})\s+([bw])\s+(\S+)(\s+\d+)?/);
      if (m2) {
        startSfen = m2[0];
        movePart = t.slice(m2[0].length);
      }
    }
    movePart = movePart.replace(/^\s*moves\s*/, '').trim();
    var toks = movePart ? movePart.split(' ') : [];
    var moves = [];
    for (var i = 0; i < toks.length; i++) {
      if (/^([1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/.test(toks[i])) moves.push({ usi: toks[i], sec: 0 });
    }
    return { black: '先手', white: '後手', startSfen: startSfen, moves: moves, result: null, header: {} };
  }

  function parseAny(text) {
    var t = String(text);
    if (/手数----|^\s*\d+\s+[１-９1-9同]/m.test(t) || /先手：|後手：/.test(t)) return parseKif(t);
    return parseUsiText(t);
  }

  /* ------------------------------------------------------------------
   *  localStorage
   * ------------------------------------------------------------------ */
  var LS_KEY = 'shogi_kifu_v1';
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveAll(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  function save(rec) {
    var list = loadAll();
    rec.id = rec.id || ('k' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36));
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === rec.id) idx = i;
    if (idx >= 0) list[idx] = rec; else list.unshift(rec);
    while (list.length > 60) list.pop();
    saveAll(list);
    return rec.id;
  }
  function remove(id) {
    var list = loadAll().filter(function (r) { return r.id !== id; });
    saveAll(list);
  }
  function get(id) {
    var list = loadAll();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  return {
    toKif: toKif, parseKif: parseKif, parseUsiText: parseUsiText, parseAny: parseAny,
    parseJaMove: parseJaMove,
    loadAll: loadAll, save: save, remove: remove, get: get, download: download,
    fmtDate: fmtDate, fmtSec: fmtSec
  };
});
