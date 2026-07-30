/* ==========================================================================
 * app.js — アプリ本体（対局進行 / CP制御 / 段位測定 / 棋譜解析）
 *   依存: shogi.js, engine.js, kifu.js, ui.js
 * ========================================================================== */
(function () {
  'use strict';
  var S = window.Shogi, E = window.Engine, K = window.Kifu, U = window.UI,
    St = window.Strategy, T = window.Tactics;
  var $ = U.$, el = U.el;

  /* ==================================================================
   *  エンジンクライアント（Worker があれば別スレッド、無ければ同スレッド）
   * ================================================================== */
  function EngineClient() {
    this.mode = 'sync';
    this.worker = null;
    this.seq = 0;
    this.cur = null;
    this.aborted = false;
  }

  EngineClient.prototype.init = function () {
    var self = this;
    return new Promise(function (resolve) {
      var w;
      try { w = new Worker('js/worker.js'); }
      catch (e) { self.mode = 'sync'; return resolve('sync'); }
      var settled = false;
      function fallback() {
        if (settled) return;
        settled = true; self.mode = 'sync';
        try { w.terminate(); } catch (e) { }
        resolve('sync');
      }
      w.onerror = fallback;
      w.onmessage = function (ev) {
        if (!settled && ev.data && ev.data.type === 'pong') {
          settled = true;
          self.mode = 'worker'; self.worker = w;
          w.onmessage = function (e2) { self._onMessage(e2.data); };
          w.onerror = function (e2) { console.error('worker error', e2); };
          return resolve('worker');
        }
      };
      try { w.postMessage({ cmd: 'ping' }); } catch (e) { return fallback(); }
      setTimeout(fallback, 2000);
    });
  };

  EngineClient.prototype._onMessage = function (d) {
    if (!d || !this.cur || d.id !== this.cur.id) return;
    if (d.type === 'info') { if (this.cur.onInfo) this.cur.onInfo(d); return; }
    if (d.type === 'error') { console.error('engine:', d.message); }
    var cur = this.cur; this.cur = null;
    cur.resolve(d.type === 'bestmove' ? d : { move: '', best: '', score: 0, depth: 0, nodes: 0, pv: [] });
  };

  /* opt: {level, timeMs, depth, deterministic, onInfo} */
  EngineClient.prototype.go = function (sfen, opt) {
    var self = this;
    opt = opt || {};
    this.aborted = false;
    if (this.mode === 'worker') {
      var id = ++this.seq;
      return new Promise(function (resolve) {
        self.cur = { id: id, resolve: resolve, onInfo: opt.onInfo };
        self.worker.postMessage({
          cmd: 'go', id: id, sfen: sfen, level: opt.level, timeMs: opt.timeMs,
          depth: opt.depth, deterministic: !!opt.deterministic,
          useBook: opt.useBook !== false
        });
      });
    }
    // 同スレッド版（UI が一瞬固まるので思考時間を抑える）
    return new Promise(function (resolve) {
      setTimeout(function () {
        var pos = (!sfen || sfen === 'startpos') ? S.startpos() : S.fromSfen(sfen);
        var lv = E.level(opt.level || 6);
        var t = Math.min(opt.timeMs || lv.time, 1400);
        var r = E.think(pos, {
          level: opt.level, timeMs: t, depth: opt.depth, deterministic: !!opt.deterministic,
          useBook: opt.useBook !== false,
          abort: function () { return self.aborted; },
          onInfo: opt.onInfo ? function (info) {
            opt.onInfo({
              depth: info.depth, score: info.score, nodes: info.nodes, time: info.time,
              pv: info.pv.map(S.moveToUsi)
            });
          } : null
        });
        resolve({
          move: r.move ? S.moveToUsi(r.move) : '', best: r.best ? S.moveToUsi(r.best) : '',
          score: r.score, depth: r.depth, nodes: r.nodes, time: r.time,
          pv: (r.pv || []).map(S.moveToUsi), book: !!r.book
        });
      }, 24);
    });
  };

  EngineClient.prototype.stop = function () {
    this.aborted = true;
    E.stop();
    if (this.mode === 'worker' && this.worker) this.worker.postMessage({ cmd: 'stop' });
  };

  var engine = new EngineClient();

  /* ==================================================================
   *  状態
   * ================================================================== */
  var START_SFEN = S.startpos().toSfen();

  var G = {
    mode: 'play',
    startSfen: START_SFEN,
    moves: [],          // {usi, m, ja, sec}
    keys: [],           // 各手数後の局面キー（千日手判定）
    checks: [],         // 各手が王手だったか
    pos: null,
    cursor: 0,
    players: {
      1: { type: 'human', name: 'あなた', level: 0 },
      '-1': { type: 'cp', name: 'CP', level: 4 }
    },
    flip: false, autoFlip: false,
    finished: null,     // {winner, text, kif}
    thinking: false,
    clocks: { 1: 0, '-1': 0 },
    lastMoveAt: 0,
    cpcp: { running: false, timer: null, speed: 400 },
    measure: null,      // 段位測定
    analysis: null,
    analyzing: false,
    startedAt: Date.now(),
    kifuId: null
  };

  var sel = { sq: -1, hand: null, dests: [], entries: [] };
  var analyzeDepthMs = 700;
  var rankGames = 5;
  var mySideSetting = 1;
  var netSideSetting = 0;
  /* 戦法（先手／後手）。'auto' は指定なし */
  var STRAT = { 1: 'auto', '-1': 'auto' };
  function stratOf(side) { return STRAT[side > 0 ? 1 : '-1'] || 'auto'; }

  /* 大会ルール設定  time: 持ち時間(秒, 0で無制限) / byoyomi: 秒読み(秒) */
  var RULES = { foulLoss: true, maxMoves: 256, time: 0, byoyomi: 0 };

  /* 表示設定（形勢を見せるかどうか。記録自体は常に行う） */
  var VIEW_KEY = 'shogi_view_v1';
  var VIEW = { showEval: true, theme: 'light', koma: 'kaisho' };
  (function loadView() {
    try {
      var v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      if (v && typeof v.showEval === 'boolean') VIEW.showEval = v.showEval;
      if (v && v.theme) VIEW.theme = v.theme;
      if (v && v.koma) VIEW.koma = v.koma;
    } catch (e) { }
  })();
  function saveView() {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(VIEW)); } catch (e) { }
  }

  /* 形勢に関わる表示のオン・オフをまとめて切り替える */
  function applyViewSetting() {
    var on = VIEW.showEval;
    $('evalWrap').style.display = on ? '' : 'none';
    $('engScore').textContent = on ? $('engScore').textContent : '—';
    var pv = $('engPv');
    if (!on) pv.textContent = '（形勢をかくす設定です）';
    var segs = document.querySelectorAll('[data-evalshow]');
    for (var i = 0; i < segs.length; i++) {
      segs[i].classList.toggle('on', (segs[i].dataset.evalshow === '1') === on);
    }
    // 配色
    document.documentElement.setAttribute('data-theme', VIEW.theme);
    var ts = document.querySelectorAll('[data-theme][class*="seg-btn"]');
    for (var j = 0; j < ts.length; j++) ts[j].classList.toggle('on', ts[j].dataset.theme === VIEW.theme);
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', VIEW.theme === 'dark' ? '#14161c' : '#f4f1ea');
    // 駒の書体
    document.documentElement.setAttribute('data-koma', VIEW.koma);
    var ks = document.querySelectorAll('[data-koma][class*="seg-btn"]');
    for (var k = 0; k < ks.length; k++) ks[k].classList.toggle('on', ks[k].dataset.koma === VIEW.koma);
  }

  /* 2台対戦 */
  var NET = { on: false, room: null, token: null, side: 0, version: 0, names: {}, aborter: null };

  function P(side) { return G.players[side > 0 ? 1 : '-1']; }

  /* ---------------- 戦法・囲い・手筋の成立を知らせる ---------------- */
  var acTimer = null;
  function showAchieve(kind, name, note) {
    var box = $('achieve');
    if (!box) return;
    $('acKind').textContent = kind;
    $('acName').textContent = name;
    $('acNote').textContent = note || '';
    box.classList.add('on');
    clearTimeout(acTimer);
    acTimer = setTimeout(function () { box.classList.remove('on'); }, 2400);
  }

  /* 直前の一手で新しく成立したものを調べ、記録して知らせる */
  function checkAchievements(before, m, after) {
    if (!T) return;
    var side = before.side;
    var who = side > 0 ? '先手' : '後手';
    if (!G.tags) G.tags = { strategy: [], castle: [], technique: [] };
    var seen = G.seenTags || (G.seenTags = {});
    var n = G.moves.length;

    function push(kind, key, item) {
      var k = kind + ':' + who + ':' + item.name;
      if (seen[k]) return;
      seen[k] = true;
      G.tags[key].push({ name: item.name, side: side, ply: n });
      var label = kind === 'strategy' ? '戦法' : kind === 'castle' ? '囲い' : '手筋';
      showAchieve(who + 'の' + label, item.name, item.note);
    }
    var st = T.detectStrategy(after, side);
    if (st) push('strategy', 'strategy', st);
    var ca = T.detectCastle(after, side);
    if (ca) push('castle', 'castle', ca);
    var te = T.detectTechnique(before, m, after);
    if (te) {
      // 手筋は何度出てもよいが、通知は同じ名前を続けて出さない
      var k2 = 'technique:' + who + ':' + te.name + ':' + n;
      if (!seen['t' + te.name + who] || n - (seen['t' + te.name + who] || -99) > 8) {
        seen['t' + te.name + who] = n;
        G.tags.technique.push({ name: te.name, side: side, ply: n });
        showAchieve(who + 'の手筋', te.name, te.note);
      }
      void k2;
    }
  }

  /* 保存・絞り込み用に、重複を除いた名前の一覧にする */
  function tagNames(tags) {
    var out = [];
    if (!tags) return out;
    ['strategy', 'castle', 'technique'].forEach(function (k) {
      (tags[k] || []).forEach(function (t) {
        var label = (t.side > 0 ? '▲' : '△') + t.name;
        if (out.indexOf(label) < 0) out.push(label);
      });
    });
    return out;
  }

  /* ==================================================================
   *  盤面ユーティリティ
   * ================================================================== */
  function posAt(n) {
    var p = (G.startSfen === START_SFEN) ? S.startpos() : S.fromSfen(G.startSfen);
    for (var i = 0; i < n; i++) p.doMove(G.moves[i].m);
    return p;
  }
  function atLive() { return G.cursor === G.moves.length; }
  function clearSel() { sel.sq = -1; sel.hand = null; sel.dests = []; sel.entries = []; }

  /* 入力用の手（大会ルールのときは二歩・打ち歩詰めも「指せる手」に含める） */
  function inputMoves() {
    return G.pos.movesForInput(RULES.foulLoss);
  }

  function lastMoveInfo() {
    if (G.cursor === 0) return null;
    var mv = G.moves[G.cursor - 1];
    return { from: S.mvIsDrop(mv.m) ? -1 : S.mvFrom(mv.m), to: S.mvTo(mv.m) };
  }

  function humanTurn() {
    if (G.finished || !atLive()) return false;
    if (G.mode === 'net') return NET.on && G.pos.side === NET.side;
    return P(G.pos.side).type === 'human';
  }

  /* ==================================================================
   *  描画
   * ================================================================== */
  function refresh() {
    if (G.mode === 'human' && G.autoFlip && !G.finished) G.flip = G.pos.side < 0;
    var handEnabled = {};
    var canInput = humanTurn();
    handEnabled[1] = canInput && G.pos.side > 0;
    handEnabled[-1] = canInput && G.pos.side < 0;
    U.render(G.pos, {
      flip: G.flip, selSq: sel.sq, selHand: sel.hand, dests: sel.dests,
      last: lastMoveInfo(), checkSide: G.pos.inCheck() ? G.pos.side : 0,
      handEnabled: handEnabled
    });
    renderBars();
    renderMoveList();
    renderStatus();
    updateEvalBar();
    if ($('graphSheet') && $('graphSheet').classList.contains('on')) renderLiveGraph();
  }

  function renderBars() {
    var topSide = G.flip ? 1 : -1;
    var map = [
      { bar: 'barWhite', name: 'nameWhite', who: 'whoWhite', clock: 'clockWhite', cap: 'clockCapWhite', av: 'avatarWhite', side: topSide },
      { bar: 'barBlack', name: 'nameBlack', who: 'whoBlack', clock: 'clockBlack', cap: 'clockCapBlack', av: 'avatarBlack', side: -topSide }
    ];
    var timed = !!(RULES.time || RULES.byoyomi);
    map.forEach(function (o) {
      var p = P(o.side);
      // 名前（CPは強さの呼称、人は入力された名前）
      $(o.name).textContent = p.type === 'cp' ? E.level(p.level).name : p.name;
      // 先手／後手のピル
      var sb = $(o.bar === 'barBlack' ? 'sideBlack' : 'sideWhite');
      if (sb) {
        sb.textContent = o.side > 0 ? '先手' : '後手';
        sb.className = 'side-badge ' + (o.side > 0 ? 'sente' : 'gote');
      }
      // レーティング
      var rate = '';
      if (p.type === 'cp') rate = 'R ' + E.level(p.level).rating;
      else {
        var st = loadRating();
        rate = (st && st.rating && p.name.indexOf('あなた') >= 0) ? 'R ' + st.rating : '';
      }
      $(o.who).textContent = rate;

      var cl = $(o.clock);
      cl.textContent = clockText(o.side);
      var r = remainOf(o.side);
      var byo = timed && inByoNow(o.side);
      cl.className = 'clock' + (byo ? ' byo' : (timed && r !== null && r < 60 ? ' low' : ''));
      if ($(o.cap)) $(o.cap).textContent = timed ? (byo ? '' : '残り') : '消費';

      var active = !G.finished && G.pos.side === o.side;
      $(o.bar).className = 'player-bar' + (active ? ' active' : '');
    });
  }
  function fmtClock(s) {
    s = Math.floor(s);
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  /* ---------------- 持ち時間 ----------------
   * 実際の時刻から計算するので、スマホで画面を切り替えても狂わない。
   */
  function resetClocks() {
    G.time = {
      1: { main: RULES.time, inByo: RULES.time === 0 && RULES.byoyomi > 0 },
      '-1': { main: RULES.time, inByo: RULES.time === 0 && RULES.byoyomi > 0 }
    };
    G.turnStart = Date.now();
  }

  function timeUsedNow() { return (Date.now() - (G.turnStart || Date.now())) / 1000; }

  function clockRunning(side) {
    return !G.finished && atLive() && G.mode !== 'view' && G.pos.side === side;
  }

  /* 手番側の残り時間（秒）。持ち時間なしなら null
   * 本時間を使い切ったら、その場で秒読みに移る（負けにはしない） */
  function remainOf(side) {
    if (!RULES.time && !RULES.byoyomi) return null;
    var st = G.time[side > 0 ? 1 : '-1'];
    if (!st) return null;
    var used = clockRunning(side) ? timeUsedNow() : 0;
    if (st.inByo) return Math.max(0, RULES.byoyomi - used);
    var left = st.main - used;
    if (left > 0) return left;
    if (RULES.byoyomi > 0) return Math.max(0, RULES.byoyomi + left);
    return 0;
  }

  /* いま秒読みに入っているか（表示用） */
  function inByoNow(side) {
    var st = G.time[side > 0 ? 1 : '-1'];
    if (!st) return false;
    if (st.inByo) return true;
    if (!RULES.byoyomi) return false;
    var used = clockRunning(side) ? timeUsedNow() : 0;
    return st.main - used <= 0;
  }

  /* 着手時に持ち時間を確定させる */
  function consumeTime(side) {
    if (!RULES.time && !RULES.byoyomi) { G.turnStart = Date.now(); return; }
    var st = G.time[side > 0 ? 1 : '-1'];
    var used = timeUsedNow();
    if (!st.inByo) {
      st.main -= used;
      if (st.main <= 0) { st.main = 0; st.inByo = RULES.byoyomi > 0; }
    }
    G.turnStart = Date.now();
  }

  function clockText(side) {
    var r = remainOf(side);
    if (r === null) return fmtClock(G.clocks[side > 0 ? 1 : '-1']);
    if (inByoNow(side)) return '秒読み ' + Math.ceil(r) + '秒';
    return fmtClock(r);
  }

  function checkTimeout() {
    if (G.finished || !atLive()) return;
    if (!RULES.time && !RULES.byoyomi) return;
    var side = G.pos.side;
    if (G.mode === 'net' && NET.on && side !== NET.side) return;  // 自分の時計だけを見る
    if (remainOf(side) > 0) return;
    var w = -side;
    onGameEnd({
      winner: w, text: (side > 0 ? '先手' : '後手') + 'の時間切れ負け',
      kif: '切れ負け', reason: 'timeout'
    });
  }

  /* ---------------- 形勢の推移（対局中も記録する） ----------------
   * 対局中は簡易評価、解析後は正確な評価に置き換わる。
   */
  function recordEval() {
    if (!G.evalHist) G.evalHist = [];
    var n = G.moves.length;
    // CPの読みがあればそれを、無ければ簡易評価を使う
    if (shownEvalPly === n && Math.abs(shownEval) < E.MATE) G.evalHist[n] = shownEval;
    else if (G.evalHist[n] === undefined) G.evalHist[n] = E.evaluate(G.pos);
  }

  function evalSeries() {
    if (G.analysis && G.analysis.blackScore && G.analysis.blackScore.length > 1) {
      return { data: G.analysis.blackScore, exact: true };
    }
    return { data: G.evalHist || [], exact: false };
  }

  function renderLiveGraph() {
    var box = $('liveGraph');
    if (!box) return;
    if (!VIEW.showEval) {
      box.innerHTML = '<div class="notice">形勢を「かくす」設定です。メニューの「表示」で戻せます（記録は続いています）。</div>';
      $('graphNote').textContent = '';
      return;
    }
    var s = evalSeries();
    if (!s.data || s.data.length < 2) {
      box.innerHTML = '<div class="hint">まだ記録がありません。数手指すとグラフが出ます。</div>';
      $('graphNote').textContent = '';
      return;
    }
    box.innerHTML = evalGraph(s.data, G.cursor);
    var cur = s.data[G.cursor];
    var mv = G.cursor > 0 && G.moves[G.cursor - 1] ? G.moves[G.cursor - 1].ja : '開始局面';
    $('graphNote').innerHTML = mv + '（' + G.cursor + '手目）　<b>' +
      (cur > 0 ? '+' : '') + Math.round(cur) + '</b>　' + evalWord(cur) + '<br>' +
      (s.exact ? '解析済みの正確な評価値です。' : '対局中の簡易評価です。「棋譜・解析」を実行すると正確な値に置き換わります。');
  }

  function renderMoveList() {
    var box = $('moveList');
    var html = '';
    html += '<div class="mv' + (G.cursor === 0 ? ' cur' : '') + '" data-n="0"><span class="n">-</span><span>開始局面</span><span class="ev"></span></div>';
    var p = (G.startSfen === START_SFEN) ? S.startpos() : S.fromSfen(G.startSfen);
    var prevTo = -1;
    for (var i = 0; i < G.moves.length; i++) {
      var mv = G.moves[i];
      var ja = mv.ja || S.moveToJa(p, mv.m, prevTo, {});
      mv.ja = ja;
      var ev = '', tag = '';
      if (VIEW.showEval && G.analysis && G.analysis.acc && G.analysis.acc[i] !== undefined) {
        var sc = G.analysis.blackScore[i + 1];
        ev = (sc > 0 ? '+' : '') + sc;
        var t = G.analysis.tags[i];
        if (t) tag = '<span class="tag ' + t.cls + '">' + t.label + '</span>';
      }
      html += '<div class="mv' + (G.cursor === i + 1 ? ' cur' : '') + '" data-n="' + (i + 1) + '">' +
        '<span class="n">' + (i + 1) + '</span><span>' + ja + tag + '</span>' +
        '<span class="ev">' + ev + '</span></div>';
      prevTo = S.mvTo(mv.m);
      p.doMove(mv.m);
    }
    if (G.finished) {
      html += '<div class="mv"><span class="n"></span><span style="color:var(--accent2)">' + G.finished.text + '</span><span class="ev"></span></div>';
    }
    box.innerHTML = html;
    $('kifuCount').textContent = G.moves.length + '手';
    // ページ全体がスクロールしないよう、リスト内だけを動かす
    var cur = box.querySelector('.mv.cur');
    if (cur) {
      var top = cur.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2;
      box.scrollTop = Math.max(0, top);
    }
  }

  /* 自分の手番かどうか（画面下側の人が「自分」） */
  function isMyTurnView() {
    if (G.finished || !atLive()) return false;
    if (G.mode === 'net' && NET.on) return G.pos.side === NET.side;
    if (G.mode === 'play') return P(G.pos.side).type === 'human';
    return false;
  }

  function renderStatus() {
    var s = '', mine = false;
    if (G.finished) s = '対局終了：' + G.finished.text;
    else if (!atLive()) s = '検討中（' + G.cursor + '手目）— ▶| で最新へ';
    else {
      mine = isMyTurnView();
      if (mine) s = '<b style="color:var(--good)">あなたの番です</b>';
      else if (G.thinking) s = (G.pos.side > 0 ? '先手' : '後手') + 'が考えています <span class="thinking"><i></i><i></i><i></i></span>';
      else {
        var pn = P(G.pos.side), lbl = G.pos.side > 0 ? '▲先手' : '△後手';
        var nm = pn.type === 'cp' ? E.level(pn.level).name : pn.name;
        s = lbl + (nm && nm !== '先手' && nm !== '後手' ? '（' + nm + '）' : '') + 'の手番';
      }
      if (G.pos.inCheck()) s = '<b>王手！</b> ' + s;
      // 戦法を指定していれば、次の一手を助言する
      if (mine && St) {
        var sug = St.nextMove(G.pos, stratOf(G.pos.side));
        if (sug) s += '<span class="sub">' + St.get(stratOf(G.pos.side)).name +
          '：' + S.moveToJa(G.pos, sug, -1, {}) + '</span>';
      }
      // 直前の手を文字で出す
      if (G.moves.length) {
        var lm = G.moves[G.cursor - 1] || G.moves[G.moves.length - 1];
        if (lm) s += '<span class="sub">直前：' + lm.ja + '</span>';
      }
    }
    if (G.measure) {
      s = '【測定 ' + (G.measure.index + 1) + '/' + G.measure.total + '局・相手' +
        E.level(G.measure.level).name + '】' + s;
    }
    var sr = document.querySelector('.status-row');
    if (sr) sr.className = 'status-row' + (mine ? ' mine' : '');
    if (G.mode === 'net' && NET.on && !G.finished) {
      s = '【2台対戦 部屋' + NET.room + '】あなたは' + (NET.side > 0 ? '先手' : '後手') + '　' + s;
    }
    $('statusLine').innerHTML = s;
    var netOn = G.mode === 'net' && NET.on;
    $('btnUndo').disabled = !!G.measure || netOn || G.moves.length === 0;
    $('btnHint').disabled = !!G.measure || netOn || !!G.finished;
    $('btnResign').disabled = !!G.finished;
    $('btnJishogi').disabled = !!G.finished;
    $('btnDeclare').disabled = !!G.finished;
  }

  /* 形勢を言葉にする */
  function evalWord(cp) {
    var a = Math.abs(cp), who = cp > 0 ? '先手' : '後手';
    if (a < 120) return '互角';
    if (a < 400) return 'やや' + who;
    if (a < 900) return who + '優勢';
    if (a < 2000) return who + '有利';
    return who + '勝勢';
  }

  var shownEval = 0, shownEvalPly = -1;

  /* 現在表示中の局面の形勢（先手視点） */
  function currentEval() {
    if (G.analysis && G.analysis.blackScore && G.analysis.blackScore[G.cursor] !== undefined) {
      return G.analysis.blackScore[G.cursor];             // 解析済みの正確な値
    }
    if (atLive() && shownEvalPly === G.moves.length) return shownEval;   // 直前のCPの読み
    if (G.evalHist && G.evalHist[G.cursor] !== undefined) return G.evalHist[G.cursor];
    return E.evaluate(G.pos);                             // 簡易（静的）評価
  }

  function updateEvalBar() {
    var sc = currentEval();
    // 盤の下は小さな折れ線グラフだけにする（棒グラフは廃止）
    var mini = $('miniGraph');
    if (mini) {
      if (!VIEW.showEval) mini.innerHTML = '';
      else {
        var ser = evalSeries();
        mini.innerHTML = (ser.data && ser.data.length > 1)
          ? evalGraph(ser.data, G.cursor)
          : '<div class="hint" style="margin:0">数手指すと推移が出ます</div>';
      }
    }
    var mate = null;
    if (Math.abs(sc) > E.MATE - 500) mate = (sc > 0 ? '先手' : '後手') + 'の詰み';
    U.setEval(sc, mate, evalWord(sc));
    if ($('evalWord')) $('evalWord').textContent = VIEW.showEval ? evalWord(sc) : '';
  }

  function setEngineInfo(d, label) {
    if (label) $('engState').textContent = label;
    if (!d) return;
    if (d.depth !== undefined) $('engDepth').textContent = d.depth + (d.seldepth ? '/' + d.seldepth : '');
    if (d.nodes !== undefined) {
      var nps = d.time ? Math.round(d.nodes / d.time * 1000) : 0;
      $('engNodes').textContent = d.nodes.toLocaleString() + ' 手' + (nps ? '（' + Math.round(nps / 1000) + 'k/秒）' : '');
    }
    if (d.score !== undefined) {
      if (!VIEW.showEval) $('engScore').textContent = '—';
      else {
        var s = d.score;
        var txt = Math.abs(s) > E.MATE - 500 ? (s > 0 ? '詰みあり' : '詰まされる') : ((s > 0 ? '+' : '') + s);
        $('engScore').textContent = txt + '（手番側から見て）';
      }
    }
    if (d.pv && d.pv.length) {
      $('engPv').textContent = VIEW.showEval ? pvToJa(d.pv) : '（形勢をかくす設定です）';
    }
  }

  function pvToJa(usiList) {
    var p = G.cursor === G.moves.length ? G.pos.clone() : posAt(G.moves.length);
    var prevTo = G.moves.length ? S.mvTo(G.moves[G.moves.length - 1].m) : -1;
    var out = [];
    for (var i = 0; i < usiList.length && i < 8; i++) {
      var m = S.usiToMove(p, usiList[i]);
      if (!m || !p.isLegal(m)) break;
      out.push(S.moveToJa(p, m, prevTo, {}));
      prevTo = S.mvTo(m);
      p.doMove(m);
    }
    return out.join(' ') || '-';
  }

  /* ==================================================================
   *  対局進行
   * ================================================================== */
  function newGame(opts) {
    opts = opts || {};
    stopCpLoop();
    engine.stop();
    G.mode = opts.mode || G.mode;
    G.startSfen = opts.startSfen || START_SFEN;
    G.moves = []; G.keys = []; G.checks = [];
    G.cursor = 0;
    G.finished = null;
    G.thinking = false;
    G.clocks = { 1: 0, '-1': 0 };
    resetClocks();
    G.analysis = null;
    G.evalHist = [];
    G.tags = { strategy: [], castle: [], technique: [] };
    G.seenTags = {};
    G.startedAt = Date.now();
    G.kifuId = null;
    G.lastMoveAt = Date.now();
    G.netApplying = false;
    shownEval = 0;
    if (opts.players) G.players = opts.players;
    G.pos = posAt(0);
    G.keys[0] = G.pos.posKey();
    clearSel();
    setEngineInfo({ depth: 0, nodes: 0, score: 0, pv: [] }, '待機中');
    $('engPv').textContent = '-';
    refresh();
    maybeCpMove();
  }

  function pushMove(m) {
    var now = Date.now();
    var sec = Math.min(3600, (now - G.lastMoveAt) / 1000);
    G.lastMoveAt = now;
    var prevTo = G.moves.length ? S.mvTo(G.moves[G.moves.length - 1].m) : -1;
    var ja = S.moveToJa(G.pos, m, prevTo, {});
    var side = G.pos.side;
    consumeTime(side);
    G.moves.push({ usi: S.moveToUsi(m), m: m, ja: ja, sec: sec });
    G.pos.doMove(m);
    G.cursor = G.moves.length;
    G.keys[G.cursor] = G.pos.posKey();
    G.checks[G.cursor - 1] = G.pos.inCheck() ? side : 0;
    G.clocks[side > 0 ? 1 : '-1'] += sec;
    recordEval();
    clearSel();
  }

  /* 反則手を指してしまった（大会ルール：指した時点で負け） */
  function doFoulMove(m, foul, fromNet) {
    truncateIfBrowsing();
    var ply = G.moves.length;
    var before = G.pos.clone();
    pushMove(m);
    checkAchievements(before, m, G.pos);
    if (G.mode === 'net' && NET.on && !fromNet) netSendMove(m, ply);
    var loser = -G.pos.side, winner = G.pos.side;
    refresh();
    var name = S.FOUL_NAME[foul] || '反則';
    onGameEnd({
      winner: winner,
      text: (loser > 0 ? '先手' : '後手') + 'の反則負け（' + name + '）',
      kif: '反則負け', reason: 'foul', foul: foul
    }, fromNet);
  }

  function truncateIfBrowsing() {
    if (atLive()) return;
    // 過去の局面から指した場合は、その手数以降を破棄して分岐
    G.moves.length = G.cursor;
    G.keys.length = G.cursor + 1;
    G.checks.length = G.cursor;
    G.pos = posAt(G.cursor);
    G.analysis = null;
  }

  /* 手を指す（人間・CP共通） */
  function doMove(m) {
    if (G.finished) return;
    truncateIfBrowsing();
    var ply = G.moves.length;
    var before = G.pos.clone();
    pushMove(m);
    checkAchievements(before, m, G.pos);
    if (G.mode === 'net' && NET.on && !G.netApplying) netSendMove(m, ply);
    var end = detectEnd();
    refresh();
    if (end) { onGameEnd(end); return; }
    scheduleNext();
  }

  /* 次の手番へ（CP対CP のときは指す間隔をあける） */
  function scheduleNext() {
    if (G.cpcp.timer) { clearTimeout(G.cpcp.timer); G.cpcp.timer = null; }
    if (G.mode === 'cpcp') {
      if (!G.cpcp.running) return;
      G.cpcp.timer = setTimeout(function () { G.cpcp.timer = null; maybeCpMove(); }, G.cpcp.speed);
      return;
    }
    maybeCpMove();
  }

  /* 終局判定 */
  function detectEnd() {
    var st = S.gameStatus(G.pos);
    var winner = -G.pos.side;
    if (st === 'mate') return { winner: winner, text: (winner > 0 ? '先手' : '後手') + 'の勝ち（詰み）', kif: '詰み', reason: 'mate' };
    if (st === 'nomove') return { winner: winner, text: (winner > 0 ? '先手' : '後手') + 'の勝ち（手詰まり）', kif: '詰み', reason: 'nomove' };
    // 千日手（同一局面4回）
    var key = G.keys[G.cursor], cnt = 0, prevIdx = -1;
    for (var i = 0; i <= G.cursor; i++) if (G.keys[i] === key) { cnt++; if (i < G.cursor) prevIdx = i; }
    if (cnt >= 4) {
      // 連続王手の千日手 → 王手をかけ続けた側の負け
      var checker = perpetualChecker(prevIdx);
      if (checker) {
        return {
          winner: -checker, text: (checker > 0 ? '後手' : '先手') + 'の勝ち（連続王手の千日手）',
          kif: '反則勝ち', reason: 'perpetual'
        };
      }
      return { winner: 0, text: '千日手（引き分け）', kif: '千日手', reason: 'sennichite' };
    }
    if (G.moves.length >= RULES.maxMoves) {
      // 手数上限：双方入玉していれば24点法で決着、そうでなければ引き分け
      if (G.pos.bothEnteredCamp()) {
        var j = G.pos.jishogiCheck();
        return {
          winner: j.winner, text: RULES.maxMoves + '手到達：' + j.text,
          kif: j.winner === 0 ? '持将棋' : '入玉宣言', reason: 'jishogi'
        };
      }
      return { winner: 0, text: RULES.maxMoves + '手に達したため引き分け', kif: '中断', reason: 'maxmoves' };
    }
    return null;
  }

  function perpetualChecker(prevIdx) {
    if (prevIdx < 0) return 0;
    var bAll = true, wAll = true, bN = 0, wN = 0;
    for (var i = prevIdx; i < G.cursor; i++) {
      var c = G.checks[i] || 0;
      var mover = (i % 2 === 0) ? startSide() : -startSide();
      if (mover > 0) { bN++; if (c <= 0) bAll = false; }
      else { wN++; if (c >= 0) wAll = false; }
    }
    if (bN > 0 && bAll) return 1;
    if (wN > 0 && wAll) return -1;
    return 0;
  }
  function startSide() {
    var p = (G.startSfen === START_SFEN) ? S.startpos() : S.fromSfen(G.startSfen);
    return p.side;
  }

  function onGameEnd(end, fromNet) {
    if (G.finished) return;
    G.finished = end;
    stopCpLoop();
    engine.stop();
    G.thinking = false;
    refresh();
    setEngineInfo(null, '終局');
    if (G.mode === 'net' && NET.on && !fromNet) netSendEnd(end);
    if (G.measure) return onMeasureGameEnd(end);
    var body = end.text + '<br>' + G.moves.length + '手';
    U.dialog('対局終了', body, [
      { label: '棋譜を保存', cls: '', value: 'save' },
      { label: '解析する', cls: '', value: 'analyze' },
      { label: '閉じる', cls: 'primary', value: 'close' }
    ]).then(function (v) {
      if (v === 'save') saveCurrentKifu();
      if (v === 'analyze') { switchTab('kifu'); analyzeGame(); }
    });
  }

  /* ---------------- CP の手番 ---------------- */
  function maybeCpMove() {
    if (G.finished || !atLive() || G.thinking) return;
    var p = P(G.pos.side);
    if (p.type !== 'cp') return;
    if (G.mode === 'cpcp' && !G.cpcp.running) return;
    thinkAndMove(p.level);
  }

  function thinkAndMove(level) {
    // 戦法が指定されていれば、その手順を優先する
    var sm = St ? St.nextMove(G.pos, stratOf(G.pos.side)) : 0;
    if (sm) {
      G.thinking = true;
      renderStatus();
      setEngineInfo(null, '戦法どおりに指します（' + St.get(stratOf(G.pos.side)).name + '）');
      var myPly0 = G.moves.length;
      setTimeout(function () {
        G.thinking = false;
        if (G.finished || myPly0 !== G.moves.length) { renderStatus(); return; }
        $('engDepth').textContent = '戦法'; $('engNodes').textContent = '—';
        doMove(sm);
      }, G.mode === 'cpcp' ? 10 : 350);
      return;
    }
    G.thinking = true;
    renderStatus();
    setEngineInfo(null, '考慮中（' + E.level(level).name + '）');
    var sfen = G.pos.toSfen();
    var myPly = G.moves.length;
    engine.go(sfen, {
      level: level,
      onInfo: function (d) { setEngineInfo(d); }
    }).then(function (r) {
      G.thinking = false;
      if (G.finished || myPly !== G.moves.length) { renderStatus(); return; }
      setEngineInfo(r, r.book ? '定跡どおりに指しました' : '待機中');
      if (r.book) { $('engDepth').textContent = '定跡'; $('engNodes').textContent = '—'; }
      if (Math.abs(r.score) < E.MATE - 500) shownEval = r.score * G.pos.side;
      else shownEval = (r.score > 0 ? 1 : -1) * G.pos.side * E.MATE;
      shownEvalPly = G.moves.length + 1;   // この手を指した後の局面に対する評価
      if (!r.move) {
        // 指す手が無い＝詰み（保険）
        var w = -G.pos.side;
        onGameEnd({ winner: w, text: (w > 0 ? '先手' : '後手') + 'の勝ち（詰み）', kif: '詰み', reason: 'mate' });
        return;
      }
      var m = S.usiToMove(G.pos, r.move);
      if (!m || !G.pos.isLegal(m)) {
        console.error('CPが非合法手を返しました', r.move);
        var ls = G.pos.legalMoves();
        m = ls[Math.floor(Math.random() * ls.length)];
      }
      doMove(m);
    });
  }

  function stopCpLoop() {
    G.cpcp.running = false;
    if (G.cpcp.timer) { clearTimeout(G.cpcp.timer); G.cpcp.timer = null; }
  }

  /* ==================================================================
   *  入力（盤クリック）
   * ================================================================== */
  function canInputNow() {
    if (G.finished) { U.toast('対局は終了しています'); return false; }
    if (G.thinking) return false;
    if (G.mode === 'net') {
      if (!NET.on) return false;
      if (!atLive()) { U.toast('最新の局面に戻してから指してください'); return false; }
      if (G.pos.side !== NET.side) { U.toast('相手の手番です'); return false; }
      return true;
    }
    if (!atLive() && G.measure) { U.toast('測定中は局面を戻して指せません'); return false; }
    if (P(G.pos.side).type !== 'human') { U.toast('CPの手番です'); return false; }
    return true;
  }

  function playEntry(e) {
    clearSel();
    if (e.foul) doFoulMove(e.m, e.foul);
    else doMove(e.m);
  }

  function onCell(sq) {
    if (!canInputNow()) return;
    var entries = inputMoves();

    // 移動先として選ばれた
    if (sel.sq >= 0 || sel.hand) {
      var cands = entries.filter(function (e) {
        if (S.mvTo(e.m) !== sq) return false;
        if (sel.hand) return S.mvIsDrop(e.m) && S.mvDropPiece(e.m) === sel.hand.pt;
        return !S.mvIsDrop(e.m) && S.mvFrom(e.m) === sel.sq;
      });
      if (cands.length === 1) { playEntry(cands[0]); return; }
      if (cands.length >= 2) {
        // 成り／不成の選択
        var pc = G.pos.board[sel.sq];
        var pt = pc > 0 ? pc : -pc;
        U.askPromote(pt).then(function (yes) {
          if (yes === null) { refresh(); return; }
          for (var i = 0; i < cands.length; i++) {
            if (!!S.mvPromo(cands[i].m) === !!yes) { playEntry(cands[i]); return; }
          }
          refresh();
        });
        return;
      }
    }

    // 自分の駒を選択
    var pc2 = G.pos.board[sq];
    if (pc2 !== 0 && (pc2 > 0) === (G.pos.side > 0)) {
      clearSel();
      sel.sq = sq;
      // 印を出すのは合法手だけ（反則になる場所は印を出さないが、置くことはできる）
      sel.dests = entries.filter(function (e) { return !e.foul && !S.mvIsDrop(e.m) && S.mvFrom(e.m) === sq; })
        .map(function (e) { return S.mvTo(e.m); });
      if (!sel.dests.length) U.toast('その駒はそこから動けません');
      refresh();
      return;
    }
    clearSel();
    refresh();
  }

  function onHand(side, pt) {
    if (side !== G.pos.side) return;
    if (!canInputNow()) return;
    if (sel.hand && sel.hand.pt === pt && sel.hand.side === side) { clearSel(); refresh(); return; }
    var entries = inputMoves();
    clearSel();
    sel.hand = { side: side, pt: pt };
    // 印を出すのは合法な打ち場所だけ（二歩になる場所には印を出さない）
    sel.dests = entries.filter(function (e) { return !e.foul && S.mvIsDrop(e.m) && S.mvDropPiece(e.m) === pt; })
      .map(function (e) { return S.mvTo(e.m); });
    if (!sel.dests.length) U.toast('その駒は打てる場所がありません');
    refresh();
  }

  /* ==================================================================
   *  ナビゲーション
   * ================================================================== */
  function goto(n) {
    n = Math.max(0, Math.min(G.moves.length, n));
    G.cursor = n;
    G.pos = posAt(n);
    clearSel();
    refresh();
  }

  /* ==================================================================
   *  操作ボタン
   * ================================================================== */
  function undo() {
    if (G.measure) return;
    if (G.mode === 'net' && NET.on) { U.toast('2台対戦では「待った」は使えません'); return; }
    stopCpLoop();
    engine.stop();
    G.thinking = false;
    var back = 1;
    if (G.mode === 'play' && G.moves.length >= 2 && P(-G.pos.side).type === 'cp') back = 2;
    if (G.moves.length < back) back = G.moves.length;
    if (!back) return;
    G.moves.length -= back;
    G.keys.length = G.moves.length + 1;
    G.checks.length = G.moves.length;
    G.cursor = G.moves.length;
    G.pos = posAt(G.cursor);
    G.finished = null;
    G.analysis = null;
    clearSel();
    refresh();
    U.toast(back + '手戻しました');
    maybeCpMove();
  }

  function hint() {
    if (G.finished) return;
    setEngineInfo(null, 'ヒント検討中');
    var sfen = G.pos.toSfen();
    engine.go(sfen, { level: 9, timeMs: 1200, deterministic: true, onInfo: setEngineInfo })
      .then(function (r) {
        setEngineInfo(r, '待機中');
        if (!r.best) { U.toast('候補手が見つかりません'); return; }
        var m = S.usiToMove(G.pos, r.best);
        var ja = S.moveToJa(G.pos, m, -1, {});
        sel.sq = S.mvIsDrop(m) ? -1 : S.mvFrom(m);
        sel.hand = S.mvIsDrop(m) ? { side: G.pos.side, pt: S.mvDropPiece(m) } : null;
        sel.dests = [S.mvTo(m)];
        refresh();
        U.toast('ヒント：' + ja);
      });
  }

  /* 投了するのは「手番側」ではなく「投了ボタンを押した人」 */
  function resignSide() {
    if (G.mode === 'net' && NET.on) return NET.side;
    if (G.mode === 'play') return P(1).type === 'human' ? 1 : -1;  // 対CPでは人間側
    return G.pos.side;                                            // 対人・観戦は手番側
  }

  function resign() {
    if (G.finished) return;
    var side = resignSide();
    U.dialog('投了しますか？', (side > 0 ? '先手' : '後手') + '（' + P(side).name + '）の投了として記録します。', [
      { label: 'やめる', value: false }, { label: '投了する', cls: 'danger', value: true }
    ]).then(function (yes) {
      if (!yes) return;
      var w = -side;
      onGameEnd({ winner: w, text: (w > 0 ? '先手' : '後手') + 'の勝ち（投了）', kif: '投了', reason: 'resign' });
    });
  }

  /* 持将棋（24点法・アマチュア大会ルール） */
  function jishogi() {
    if (G.finished) return;
    var j = G.pos.jishogiCheck();
    var detail = '先手 ' + j.black + '点 ／ 後手 ' + j.white + '点（飛角＝5点、その他＝1点、玉は数えない）';
    if (!j.both) {
      U.dialog('持将棋の判定（24点法）',
        '双方の玉が敵陣（3段目以内）に入っていないため、まだ持将棋の判定はできません。<br><br>' +
        '現在の点数：' + detail,
        [{ label: 'OK', cls: 'primary', value: 1 }]);
      return;
    }
    U.dialog('持将棋の判定（24点法）',
      detail + '<br><br><b>' + j.text + '</b><br><br>' +
      'この結果で終局にしますか？（双方が合意したときに押してください）',
      [{ label: 'やめる', value: false }, { label: 'この結果で終局', cls: 'primary', value: true }])
      .then(function (yes) {
        if (!yes) return;
        onGameEnd({
          winner: j.winner, text: j.text,
          kif: j.winner === 0 ? '持将棋' : '入玉宣言', reason: 'jishogi'
        });
      });
  }

  function declare() {
    if (G.finished) return;
    if (G.mode === 'net' && NET.on && G.pos.side !== NET.side) {
      U.toast('入玉宣言は自分の手番で行います');
      return;
    }
    var r = G.pos.declarationCheck();
    var side = G.pos.side;
    if (!r.ok) {
      U.dialog('入玉宣言（27点法）', '宣言できません。<br>・' + r.reasons.join('<br>・') +
        '<br><br>現在の点数：' + r.point + '点（必要 ' + r.need + '点） / 敵陣の駒：' + r.inCamp + '枚');
      return;
    }
    onGameEnd({
      winner: side, text: (side > 0 ? '先手' : '後手') + 'の勝ち（入玉宣言 ' + r.point + '点）',
      kif: '入玉宣言', reason: 'declare'
    });
  }

  /* ==================================================================
   *  2台で対戦（同じWi-Fi内のサーバー経由）
   * ================================================================== */
  var NET_KEY = 'shogi_net_v1';
  var NET_SERVER_KEY = 'shogi_net_server_v1';

  /* 対戦サーバーのURL（空ならいま開いているサーバー） */
  function netBase() {
    var v = '';
    try { v = localStorage.getItem(NET_SERVER_KEY) || ''; } catch (e) { }
    return v.replace(/\/+$/, '');
  }
  function setNetBase(v) {
    v = String(v || '').trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
    try { v ? localStorage.setItem(NET_SERVER_KEY, v) : localStorage.removeItem(NET_SERVER_KEY); } catch (e) { }
    return v;
  }

  function api(path, body, timeoutMs) {
    var opt = { method: body ? 'POST' : 'GET', cache: 'no-store' };
    if (body) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify(body); }
    // 応答が返らないまま止まらないよう、必ず打ち切る
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    if (ctl) {
      opt.signal = ctl.signal;
      timer = setTimeout(function () { try { ctl.abort(); } catch (e) { } }, timeoutMs || 15000);
    }
    return fetch(netBase() + path, opt).then(function (r) {
      if (timer) clearTimeout(timer);
      return r;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j && j.error ? j.error : ('通信エラー ' + r.status));
        return j;
      });
    });
  }

  function netAvailable() {
    return api('/api/info').then(function (j) { return j; }).catch(function () { return null; });
  }

  function netStartGame(side, state) {
    NET.on = true; NET.side = side; NET.version = 0;
    var me = { type: 'human', name: 'あなた', level: 0 };
    var you = { type: 'human', name: '相手', level: 0 };
    var players = {};
    players[side > 0 ? 1 : '-1'] = me;
    players[side > 0 ? '-1' : 1] = you;
    G.measure = null;
    G.flip = side < 0;
    newGame({ mode: 'net', players: players });
    try { localStorage.setItem(NET_KEY, JSON.stringify({ room: NET.room, token: NET.token, side: side })); } catch (e) { }
    if (state) applyNetState(state);
    netPoll();
    renderNetPanel();
  }

  function netApplyNames(st) {
    if (st.black) G.players[1].name = (NET.side > 0 ? 'あなた（' + st.black + '）' : st.black);
    if (st.white) G.players['-1'].name = (NET.side < 0 ? 'あなた（' + st.white + '）' : st.white);
  }

  function applyNetState(st) {
    if (!NET.on || st.room !== NET.room) return;
    NET.version = st.version;
    netApplyNames(st);
    if (st.rules) {
      // 部屋を作った側のルールに合わせる
      var changed = false;
      if (typeof st.rules.foulLoss === 'boolean' && st.rules.foulLoss !== RULES.foulLoss) { RULES.foulLoss = st.rules.foulLoss; changed = true; }
      if (st.rules.maxMoves && st.rules.maxMoves !== RULES.maxMoves) { RULES.maxMoves = st.rules.maxMoves; changed = true; }
      if (st.rules.time !== undefined && st.rules.time !== RULES.time) { RULES.time = st.rules.time; changed = true; }
      if (st.rules.byoyomi !== undefined && st.rules.byoyomi !== RULES.byoyomi) { RULES.byoyomi = st.rules.byoyomi; changed = true; }
      if (changed) { syncRuleButtons(); if (!G.moves.length) resetClocks(); }
    }
    // 相手の手を取り込む
    if (st.moves.length > G.moves.length) {
      if (G.cursor !== G.moves.length) { G.cursor = G.moves.length; G.pos = posAt(G.cursor); }
      G.netApplying = true;
      for (var i = G.moves.length; i < st.moves.length; i++) {
        var usi = st.moves[i].usi;
        var m = S.usiToMove(G.pos, usi);
        var entries = inputMoves(), hit = null;
        for (var k = 0; k < entries.length; k++) if (entries[k].m === m) { hit = entries[k]; break; }
        if (!hit) { console.warn('同期できない手:', usi); break; }
        G.netApplying = false;
        if (hit.foul) { doFoulMove(hit.m, hit.foul, true); return; }
        G.netApplying = true;
        doMove(hit.m);
        if (G.finished) break;
      }
      G.netApplying = false;
    }
    if (st.result && !G.finished) {
      onGameEnd({ winner: st.result.winner, text: st.result.text, kif: st.result.kif || '' }, true);
    }
    renderNetPanel();
    refresh();
  }

  function netPoll() {
    if (!NET.on) return;
    api('/api/state?room=' + encodeURIComponent(NET.room) + '&v=' + NET.version, null, 35000)
      .then(function (st) {
        if (!NET.on) return;
        applyNetState(st);
        netPoll();
      })
      .catch(function (e) {
        if (!NET.on) return;
        $('netStatus').innerHTML = '接続が切れました。再接続しています…（' + esc(e.message) + '）';
        setTimeout(netPoll, 2500);
      });
  }

  function netSendMove(m, ply) {
    api('/api/move', { room: NET.room, token: NET.token, usi: S.moveToUsi(m), ply: ply, sec: 0 })
      .then(function (st) { NET.version = st.version; })
      .catch(function (e) {
        U.toast('送信できませんでした：' + e.message);
        // サーバーの状態に合わせ直す
        api('/api/state?room=' + encodeURIComponent(NET.room) + '&v=0').then(netResync).catch(function () { });
      });
  }

  function netResync(st) {
    G.moves.length = 0; G.keys.length = 0; G.checks.length = 0;
    G.cursor = 0; G.finished = null;
    G.pos = posAt(0); G.keys[0] = G.pos.posKey();
    NET.version = 0;
    applyNetState(st);
  }

  function netSendEnd(end) {
    api('/api/end', {
      room: NET.room, token: NET.token,
      winner: end.winner || 0, text: end.text, kif: end.kif || ''
    }).catch(function () { });
  }

  function netLeave() {
    NET.on = false; NET.room = null; NET.token = null; NET.side = 0;
    try { localStorage.removeItem(NET_KEY); } catch (e) { }
    renderNetPanel();
    refresh();
  }

  /* 画面を閉じてしまっても、同じ端末なら続きから指せるようにする */
  function restoreNetSession() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(NET_KEY) || 'null'); } catch (e) { }
    if (!saved || !saved.room) return;
    checkNetServer().then(function (info) {
      if (!info) return;
      return api('/api/join', { room: saved.room, token: saved.token, name: 'あなた' })
        .then(function (j) {
          NET.room = j.room; NET.token = j.token;
          netStartGame(j.side, j.state);
          switchTab('net');
          U.toast('前回の2台対戦（部屋' + j.room + '）に戻りました');
        });
    }).catch(function () {
      try { localStorage.removeItem(NET_KEY); } catch (e) { }
    });
  }

  function renderNetPanel() {
    var setup = $('netSetup'), active = $('netActive');
    if (NET.on) {
      setup.style.display = 'none'; active.style.display = '';
      $('netRoomNo').textContent = NET.room;
      var waiting = !(G.players[1].name && G.players['-1'].name);
      var oppName = NET.side > 0 ? G.players['-1'].name : G.players[1].name;
      var s = 'あなたは<b>' + (NET.side > 0 ? '先手' : '後手') + '</b>';
      if (oppName === '相手') s += ' ／ 相手の参加を待っています…';
      else s += ' ／ 対戦相手：' + esc(oppName);
      if (G.finished) s += '<br>' + esc(G.finished.text);
      else s += '<br>' + (G.pos.side === NET.side ? '<b style="color:var(--good)">あなたの手番です</b>' : '相手の手番です');
      $('netStatus').innerHTML = s;
      void waiting;
    } else {
      setup.style.display = ''; active.style.display = 'none';
    }
  }

  /* ==================================================================
   *  段位測定
   * ================================================================== */
  var RATING_KEY = 'shogi_rating_v1';
  function loadRating() {
    try { return JSON.parse(localStorage.getItem(RATING_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveRating(o) {
    try { localStorage.setItem(RATING_KEY, JSON.stringify(o)); } catch (e) { }
  }

  function levelForRating(r) {
    var best = 1, bd = 1e9;
    for (var i = 0; i < E.LEVELS.length; i++) {
      var d = Math.abs(E.LEVELS[i].rating - r);
      if (d < bd) { bd = d; best = E.LEVELS[i].id; }
    }
    return best;
  }

  function startMeasure() {
    var st = loadRating();
    var base = st && st.rating ? st.rating : 1100;
    G.measure = {
      total: rankGames, index: 0, results: [], rating: base,
      startRating: base, level: levelForRating(base), history: []
    };
    nextMeasureGame();
  }

  function nextMeasureGame() {
    var M = G.measure;
    M.level = levelForRating(M.rating);
    var mySide = (M.index % 2 === 0) ? 1 : -1;   // 先後を交互に
    var players = {};
    players[mySide > 0 ? 1 : '-1'] = { type: 'human', name: 'あなた', level: 0 };
    players[mySide > 0 ? '-1' : 1] = { type: 'cp', name: 'CP', level: M.level };
    G.flip = mySide < 0;
    newGame({ mode: 'play', players: players });
    renderRankPanel();
    U.toast('第' + (M.index + 1) + '局：あなたは' + (mySide > 0 ? '先手' : '後手') + '／相手は' + E.level(M.level).name);
  }

  function onMeasureGameEnd(end) {
    var M = G.measure;
    var mySide = P(1).type === 'human' ? 1 : -1;
    var s = end.winner === 0 ? 0.5 : (end.winner === mySide ? 1 : 0);
    var oppR = E.level(M.level).rating;
    var expct = 1 / (1 + Math.pow(10, (oppR - M.rating) / 400));
    var Kf = M.index === 0 ? 120 : 90;
    M.rating = Math.round(M.rating + Kf * (s - expct));
    M.rating = Math.max(50, Math.min(3200, M.rating));
    M.results.push(s);
    M.history.push({ level: M.level, s: s, rating: M.rating });
    M.index++;
    renderRankPanel();
    var resText = s === 1 ? 'あなたの勝ち' : s === 0 ? 'あなたの負け' : '引き分け';
    if (M.index >= M.total) {
      var final = M.rating;
      var rec = {
        rating: final, rank: E.rankName(final), date: Date.now(),
        games: M.history, total: M.total
      };
      saveRating(rec);
      G.measure = null;
      renderRankPanel();
      updateRankBadge();
      U.dialog('段位測定 結果', resText + '（第' + M.total + '局）<br><br>' +
        '<b style="font-size:22px">推定棋力：' + rec.rank + '</b><br>' +
        '推定レーティング：' + final + '<br><br>' +
        '<span style="font-size:12px;color:var(--fg-dim)">' +
        '※このアプリ内のCPの強さを基準にした推定値です。実際の大会・道場の段級位とは差が出ることがあります。</span>',
        [{ label: 'OK', cls: 'primary', value: 1 }]);
      return;
    }
    U.dialog('第' + M.index + '局 終了', end.text + '（' + resText + '）<br>' +
      '現在の推定レーティング：' + M.rating + '（' + E.rankName(M.rating) + '）<br><br>' +
      '次は第' + (M.index + 1) + '局：相手は' + E.level(levelForRating(M.rating)).name + 'です。',
      [{ label: '中止', value: 'stop' }, { label: '次の対局へ', cls: 'primary', value: 'next' }])
      .then(function (v) {
        if (v === 'next') nextMeasureGame();
        else { G.measure = null; renderRankPanel(); refresh(); }
      });
  }

  function renderRankPanel() {
    var st = loadRating();
    var M = G.measure;
    if (M) {
      $('rankBig').textContent = E.rankName(M.rating);
      $('rankSub').textContent = '測定中：' + (M.index) + '/' + M.total + '局終了　推定R' + M.rating;
    } else if (st) {
      $('rankBig').textContent = st.rank;
      $('rankSub').textContent = 'レーティング ' + st.rating + '（' + new Date(st.date).toLocaleDateString('ja-JP') + ' 測定）';
    } else {
      $('rankBig').textContent = '未測定';
      $('rankSub').textContent = 'CPと対局して棋力を推定します';
    }
    var dots = '';
    var n = M ? M.total : (st ? st.total || st.games.length : 0);
    var hist = M ? M.history : (st ? st.games : []);
    for (var i = 0; i < n; i++) {
      var h = hist[i];
      var cls = h ? (h.s === 1 ? 'w' : h.s === 0 ? 'l' : 'd') : '';
      if (M && i === M.index) cls += ' now';
      dots += '<span class="' + cls + '">' + (h ? (h.s === 1 ? '勝' : h.s === 0 ? '負' : '分') : (i + 1)) + '</span>';
    }
    $('rankDots').innerHTML = dots;
    if (hist && hist.length) {
      var lines = hist.map(function (h, i) {
        return '第' + (i + 1) + '局 ' + E.level(h.level).name + ' → ' + (h.s === 1 ? '勝ち' : h.s === 0 ? '負け' : '分') + '（R' + h.rating + '）';
      });
      $('rankHistory').innerHTML = lines.join('<br>');
    } else $('rankHistory').innerHTML = '';
    $('btnRankStart').textContent = M ? '測定中…' : '測定を開始';
    $('btnRankStart').disabled = !!M;
  }

  function updateRankBadge() {
    var st = loadRating();
    $('myRankBadge').textContent = st ? st.rank + '・R' + st.rating : '棋力未測定';
    $('myRankBadge').className = 'badge' + (st ? ' on' : '');
  }

  /* ==================================================================
   *  棋譜解析
   * ================================================================== */
  var analyzeAbort = false;

  function analyzeGame() {
    if (G.analyzing) return;
    if (!G.moves.length) { U.toast('解析する棋譜がありません'); return; }
    G.analyzing = true; analyzeAbort = false;
    $('btnAnalyze').disabled = true;
    $('btnAnalyzeStop').disabled = false;
    var N = G.moves.length;
    var sc = new Array(N + 1);         // 各局面の手番側評価値
    var bestList = new Array(N + 1);
    var positions = [];
    var p = posAt(0);
    positions.push(p.toSfen());
    for (var i = 0; i < N; i++) { p.doMove(G.moves[i].m); positions.push(p.toSfen()); }

    var idx = 0;
    function step() {
      if (analyzeAbort || idx > N) return finish();
      $('analyzeProg').style.width = Math.round(idx / (N + 1) * 100) + '%';
      setEngineInfo(null, '解析中 ' + idx + '/' + (N + 1));
      engine.go(positions[idx], {
        level: 10, timeMs: analyzeDepthMs, deterministic: true, useBook: false
      }).then(function (r) {
        sc[idx] = clampScore(r.score);
        bestList[idx] = r.best;
        idx++;
        setTimeout(step, 0);
      });
    }
    function finish() {
      G.analyzing = false;
      $('btnAnalyze').disabled = false;
      $('btnAnalyzeStop').disabled = true;
      $('analyzeProg').style.width = '100%';
      setEngineInfo(null, '待機中');
      buildAnalysis(sc, bestList, positions);
      refresh();
    }
    step();
  }

  function clampScore(s) {
    var lim = 3000;
    if (s > E.MATE - 500) return lim;
    if (s < -E.MATE + 500) return -lim;
    return Math.max(-lim, Math.min(lim, s));
  }

  function buildAnalysis(sc, bestList, positions) {
    var N = G.moves.length;
    var blackScore = [], loss = [], drop = [], acc = [], tags = [], matched = [];
    var sideAt = [];
    var p0 = posAt(0);
    var side = p0.side;
    for (var i = 0; i <= N; i++) { sideAt[i] = side; side = -side; }
    for (i = 0; i <= N; i++) {
      blackScore[i] = (sc[i] === undefined ? 0 : sc[i]) * sideAt[i];
    }
    for (i = 0; i < N; i++) {
      if (sc[i] === undefined || sc[i + 1] === undefined) {
        loss[i] = 0; drop[i] = 0; acc[i] = 100; tags[i] = null; continue;
      }
      // 勝率の落ち込み（決着済みの局面で数値が暴れないようにする）
      var d = Math.max(0, E.winProb(sc[i]) - E.winProb(-sc[i + 1]));
      drop[i] = d;
      acc[i] = E.moveAccuracy(d);
      // 評価値の損失は「互角に近い局面」だけを集計対象にする
      var l = sc[i] + sc[i + 1];
      loss[i] = Math.abs(sc[i]) <= 1500 ? Math.max(0, Math.min(800, l)) : null;
      matched[i] = (bestList[i] === G.moves[i].usi);
      if (matched[i] || d <= 0.02) tags[i] = { cls: 'good', label: '最善' };
      else if (d <= 0.10) tags[i] = null;
      else if (d <= 0.20) tags[i] = { cls: 'dubious', label: '疑問手' };
      else if (d <= 0.30) tags[i] = { cls: 'mistake', label: '悪手' };
      else tags[i] = { cls: 'blunder', label: '大悪手' };
    }
    G.analysis = {
      sc: sc, blackScore: blackScore, loss: loss, drop: drop, acc: acc,
      tags: tags, best: bestList, matched: matched
    };
    renderAnalysisOut();
  }

  function renderAnalysisOut() {
    var A = G.analysis;
    if (!A) { $('analyzeOut').innerHTML = ''; return; }
    if (!VIEW.showEval) {
      $('analyzeOut').innerHTML = '<div class="notice">形勢を「かくす」設定のため、解析結果は表示していません。' +
        '<b>解析結果は保存済み</b>なので、「表示」を「表示する」に戻すとそのまま見られます。</div>';
      return;
    }
    var N = G.moves.length;
    function blank() { return { n: 0, accSum: 0, lossSum: 0, lossN: 0, match: 0, bad: 0, blunder: 0 }; }
    var stats = { 1: blank(), '-1': blank() };
    var p0 = posAt(0), side = p0.side;
    for (var i = 0; i < N; i++) {
      var st = stats[side > 0 ? 1 : '-1'];
      st.n++;
      st.accSum += A.acc[i];
      if (A.loss[i] !== null) { st.lossSum += A.loss[i]; st.lossN++; }
      if (A.matched[i]) st.match++;
      if (A.tags[i] && A.tags[i].cls === 'mistake') st.bad++;
      if (A.tags[i] && A.tags[i].cls === 'blunder') st.blunder++;
      side = -side;
    }
    function fin(st) {
      st.accuracy = st.n ? st.accSum / st.n : 0;
      st.avg = st.lossN ? st.lossSum / st.lossN : 0;
      st.rating = E.ratingFromAccuracy(st.accuracy);
      st.rank = E.rankName(st.rating);
      st.matchRate = st.n ? st.match / st.n * 100 : 0;
      return st;
    }
    var b = fin(stats[1]), w = fin(stats['-1']);

    var html = '';
    html += '<div class="stat-grid">';
    html += statBox('先手 精度', b.accuracy.toFixed(1), '%');
    html += statBox('後手 精度', w.accuracy.toFixed(1), '%');
    html += statBox('先手 平均損失', Math.round(b.avg), '点');
    html += statBox('後手 平均損失', Math.round(w.avg), '点');
    // 括弧書きは枠に収まらないので、統計欄では短い表記にする
    var shortRank = function (r) { return String(r).replace(/（.*）/, ''); };
    html += statBox('先手 推定棋力', shortRank(b.rank), '');
    html += statBox('後手 推定棋力', shortRank(w.rank), '');
    html += '</div>';
    html += evalGraph(A.blackScore);
    html += '<div class="hint" style="margin-top:6px">' +
      '最善手一致率：先手 ' + b.matchRate.toFixed(0) + '% ／ 後手 ' + w.matchRate.toFixed(0) + '%<br>' +
      '悪手：先手 ' + b.bad + '回 ／ 後手 ' + w.bad + '回　　大悪手：先手 ' + b.blunder + '回 ／ 後手 ' + w.blunder + '回<br>' +
      '平均損失は「勝敗が決まっていない局面」だけを集計しています。<br>' +
      'グラフは先手視点の評価値（上が先手有利）。棋譜の各手をクリックするとその局面に飛べます。<br>' +
      '<b>推定棋力は1局だけだと大きくぶれます</b>（静かな将棋だと高く出る）。正確に測るなら「段位測定」タブへ。' +
      '</div>';
    $('analyzeOut').innerHTML = html;
  }

  function statBox(l, v, unit) {
    return '<div class="stat"><div class="l">' + l + '</div><div class="v">' + v +
      (unit ? '<small>' + unit + '</small>' : '') + '</div></div>';
  }

  /* 形勢の推移グラフ（先手視点。上が先手優勢） */
  function evalGraph(blackScore, cursor) {
    var W = 320, H = 150, lim = 1500, pad = 6;
    var n = blackScore.length;
    if (n < 2) return '';
    var mid = H / 2;
    function xy(i) {
      var v = Math.max(-lim, Math.min(lim, blackScore[i] || 0));
      return [(i / (n - 1)) * W, mid - (v / lim) * (mid - pad)];
    }
    var up = [], dn = [], line = [];
    for (var i = 0; i < n; i++) {
      var p = xy(i);
      line.push(p[0].toFixed(1) + ',' + p[1].toFixed(1));
    }
    var area = 'M0,' + mid + ' L' + line.join(' L') + ' L' + W + ',' + mid + ' Z';
    var svg = '<svg class="graph" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">';
    // 目盛り
    svg += '<rect x="0" y="0" width="' + W + '" height="' + mid + '" fill="rgba(37,99,235,.05)"/>';
    svg += '<rect x="0" y="' + mid + '" width="' + W + '" height="' + mid + '" fill="rgba(220,38,38,.05)"/>';
    svg += '<line x1="0" y1="' + mid + '" x2="' + W + '" y2="' + mid + '" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>';
    svg += '<path d="' + area + '" fill="rgba(37,99,235,.16)"/>';
    svg += '<polyline points="' + line.join(' ') + '" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/>';
    // 現在位置
    if (cursor !== undefined && cursor >= 0 && cursor < n) {
      var c = xy(cursor);
      svg += '<line x1="' + c[0].toFixed(1) + '" y1="0" x2="' + c[0].toFixed(1) + '" y2="' + H + '" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="3 3"/>';
      svg += '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="4" fill="#fff" stroke="#2563eb" stroke-width="2"/>';
    }
    svg += '</svg>';
    svg += '<div class="graph-legend"><span>先手優勢 ↑</span><span>' + (n - 1) + '手</span><span>↓ 後手優勢</span></div>';
    void up; void dn;
    return svg;
  }

  /* ==================================================================
   *  棋譜の保存・読み込み
   * ================================================================== */
  function currentGameObj() {
    return {
      startSfen: G.startSfen,
      moves: G.moves.map(function (m) { return { usi: m.usi, sec: m.sec }; }),
      black: P(1).name + (P(1).type === 'cp' ? '(CP:' + E.level(P(1).level).name + ')' : ''),
      white: P(-1).name + (P(-1).type === 'cp' ? '(CP:' + E.level(P(-1).level).name + ')' : ''),
      result: G.finished, startedAt: G.startedAt
    };
  }

  function saveCurrentKifu() {
    if (!G.moves.length) { U.toast('保存する手がありません'); return; }
    var g = currentGameObj();
    var rec = {
      id: G.kifuId, title: g.black + ' vs ' + g.white,
      date: G.startedAt, black: g.black, white: g.white,
      startSfen: g.startSfen, moves: g.moves,
      result: G.finished ? G.finished.text : '未終局',
      tags: tagNames(G.tags),
      analysis: G.analysis ? { blackScore: G.analysis.blackScore, loss: G.analysis.loss } : null
    };
    G.kifuId = K.save(rec);
    renderKifuList();
    U.toast('棋譜を保存しました');
  }

  var kifuFilter = '';
  function renderKifuList() {
    var list = K.loadAll();
    var box = $('kifuList'), fbox = $('kifuFilter');

    // 絞り込みチップ（保存されている戦法・囲い・手筋から作る）
    if (fbox) {
      var counts = {};
      list.forEach(function (r) {
        (r.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      });
      var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
      var fh = '<span class="chip' + (kifuFilter ? '' : ' on') + '" data-tag="">すべて<span class="n">' + list.length + '</span></span>';
      keys.forEach(function (k) {
        fh += '<span class="chip' + (kifuFilter === k ? ' on' : '') + '" data-tag="' + esc(k) + '">' +
          esc(k) + '<span class="n">' + counts[k] + '</span></span>';
      });
      fbox.innerHTML = fh;
    }

    var shown = kifuFilter ? list.filter(function (r) { return (r.tags || []).indexOf(kifuFilter) >= 0; }) : list;
    if (!shown.length) {
      box.innerHTML = '<div class="kifu-item"><span class="t">' +
        (list.length ? 'この条件に合う棋譜はありません' : '保存された棋譜はありません') + '</span></div>';
      return;
    }
    var html = '';
    shown.forEach(function (r) {
      var tags = (r.tags || []).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('');
      html += '<div class="kifu-item" data-id="' + r.id + '">' +
        '<div class="t"><b>' + esc(r.title || '棋譜') + '</b>' +
        '<span>' + new Date(r.date).toLocaleString('ja-JP') + '　' + r.moves.length + '手　' + esc(r.result || '') + '</span>' +
        (tags ? '<div class="tags">' + tags + '</div>' : '') + '</div>' +
        '<button class="btn" data-act="load">開く</button>' +
        '<button class="btn danger" data-act="del">削除</button>' +
        '</div>';
    });
    box.innerHTML = html;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function loadKifuRecord(rec) {
    stopCpLoop(); engine.stop();
    G.mode = 'view';
    G.startSfen = rec.startSfen || START_SFEN;
    G.players = {
      1: { type: 'human', name: rec.black || '先手', level: 0 },
      '-1': { type: 'human', name: rec.white || '後手', level: 0 }
    };
    G.moves = [];
    G.keys = []; G.checks = [];
    var p = posAt(0);
    G.keys[0] = p.posKey();
    for (var i = 0; i < rec.moves.length; i++) {
      var u = rec.moves[i].usi || rec.moves[i];
      var m = S.usiToMove(p, u);
      // 二歩などの反則手で終わっている棋譜も読めるようにする
      var okMove = false, cand = m ? p.movesForInput(true) : [];
      for (var ci = 0; ci < cand.length; ci++) if (cand[ci].m === m) { okMove = true; break; }
      if (!okMove) { console.warn('棋譜の', i + 1, '手目が読み込めません:', u); break; }
      var prevTo = i ? S.mvTo(G.moves[i - 1].m) : -1;
      G.moves.push({ usi: u, m: m, ja: S.moveToJa(p, m, prevTo, {}), sec: rec.moves[i].sec || 0 });
      p.doMove(m);
      G.keys.push(p.posKey());
      G.checks.push(p.inCheck() ? -p.side : 0);
    }
    G.finished = rec.result && rec.result !== '未終局' ? { winner: 0, text: rec.result, kif: '' } : null;
    G.analysis = null;
    G.kifuId = rec.id || null;
    G.startedAt = rec.date || Date.now();
    G.clocks = { 1: 0, '-1': 0 };
    goto(G.moves.length);
    U.toast(G.moves.length + '手の棋譜を読み込みました');
  }

  /* ==================================================================
   *  UI 配線
   * ================================================================== */
  function fillLevelSelect(id, def) {
    var s = $(id);
    s.innerHTML = '';
    // 強い順に並べる
    for (var i = E.LEVELS.length - 1; i >= 0; i--) {
      var lv = E.LEVELS[i];
      var o = el('option', null, lv.name + '（' + E.rankName(lv.rating) + '）');
      o.value = lv.id;
      s.appendChild(o);
    }
    s.value = def;
  }

  function switchTab(name) {
    var btns = $('tabs').querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].dataset.tab === name);
    ['play', 'cpcp', 'human', 'net', 'rank', 'kifu'].forEach(function (t) {
      $('panel-' + t).classList.toggle('on', t === name);
    });
    if (name === 'kifu') renderKifuList();
    if (name === 'rank') renderRankPanel();
    if (name === 'net') { renderNetPanel(); checkNetServer(); }
  }

  var netServerInfo = null;
  function checkNetServer(force) {
    if (netServerInfo !== null && !force) return Promise.resolve(netServerInfo);
    return netAvailable().then(function (info) {
      netServerInfo = info || false;
      $('netOffline').style.display = info ? 'none' : '';
      $('netSetup').style.display = (info && !NET.on) ? '' : 'none';
      if (info) {
        var base = netBase();
        var urls = base
          ? ['<b>' + esc(base) + '</b>']
          : (info.ips || []).map(function (ip) { return '<b>http://' + ip + ':' + info.port + '/</b>'; });
        $('netUrls').innerHTML = urls.length
          ? '相手の端末で開くアドレス：<br>' + urls.join('<br>')
          : 'アドレスが取得できませんでした。';
      }
      return netServerInfo;
    });
  }

  function syncRuleButtons() {
    var f = document.querySelectorAll('[data-foul]');
    for (var i = 0; i < f.length; i++) f[i].classList.toggle('on', (f[i].dataset.foul === '1') === RULES.foulLoss);
    var m = document.querySelectorAll('[data-maxmoves]');
    for (var j = 0; j < m.length; j++) m[j].classList.toggle('on', parseInt(m[j].dataset.maxmoves, 10) === RULES.maxMoves);
    var tc = document.querySelectorAll('[data-tc]');
    var cur = RULES.byoyomi ? (RULES.time + ':' + RULES.byoyomi) : String(RULES.time);
    for (var k = 0; k < tc.length; k++) tc[k].classList.toggle('on', tc[k].dataset.tc === cur);
  }

  function bind() {
    U.initBoard({ cell: onCell, hand: onHand });

    $('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (b) switchTab(b.dataset.tab);
    });

    // セグメントボタン共通
    document.body.addEventListener('click', function (e) {
      var t = e.target.closest('.seg-btn');
      if (!t) return;
      var parent = t.parentElement;
      var sibs = parent.querySelectorAll('.seg-btn');
      for (var i = 0; i < sibs.length; i++) sibs[i].classList.remove('on');
      t.classList.add('on');
      if (t.dataset.myside !== undefined) mySideSetting = parseInt(t.dataset.myside, 10);
      if (t.dataset.autoflip !== undefined) G.autoFlip = t.dataset.autoflip === '1';
      if (t.dataset.rankgames !== undefined) rankGames = parseInt(t.dataset.rankgames, 10);
      if (t.dataset.adepth !== undefined) analyzeDepthMs = parseInt(t.dataset.adepth, 10);
      if (t.dataset.netside !== undefined) netSideSetting = parseInt(t.dataset.netside, 10);
      if (t.dataset.foul !== undefined) { RULES.foulLoss = t.dataset.foul === '1'; clearSel(); refresh(); }
      if (t.dataset.maxmoves !== undefined) RULES.maxMoves = parseInt(t.dataset.maxmoves, 10);
      if (t.dataset.koma !== undefined && t.classList.contains('seg-btn')) {
        VIEW.koma = t.dataset.koma; saveView(); applyViewSetting();
        U.toast('駒の書体を変えました');
      }
      if (t.dataset.theme !== undefined && t.classList.contains('seg-btn')) {
        VIEW.theme = t.dataset.theme; saveView(); applyViewSetting();
      }
      if (t.dataset.evalshow !== undefined) {
        VIEW.showEval = t.dataset.evalshow === '1';
        saveView();
        applyViewSetting();
        renderMoveList();
        renderAnalysisOut();
        renderLiveGraph();
        U.toast(VIEW.showEval ? '形勢を表示します' : '形勢をかくします（記録は続けています）');
      }
      if (t.dataset.tc !== undefined) {
        var parts = String(t.dataset.tc).split(':');
        RULES.time = parseInt(parts[0], 10) || 0;
        RULES.byoyomi = parts[1] ? parseInt(parts[1], 10) : 0;
        resetClocks();
        refresh();
        U.toast(RULES.time || RULES.byoyomi
          ? '持ち時間を設定しました（次の対局から有効）' : '持ち時間なしにしました');
      }
    });

    /* ---- 2台で対戦 ---- */
    $('netServer').value = netBase();
    $('btnNetServerSave').addEventListener('click', function () {
      var v = setNetBase($('netServer').value);
      $('netServer').value = v;
      netServerInfo = null;
      checkNetServer(true).then(function (info) {
        U.toast(info ? '対戦サーバーにつながりました' : 'つながりませんでした。URLを確認してください');
      });
    });

    $('btnNetCreate').addEventListener('click', function () {
      checkNetServer().then(function (info) {
        if (!info) { U.toast('サーバーに接続できません'); return; }
        return api('/api/create', {
          name: $('netName').value || '対局者', side: netSideSetting,
          rules: {
            foulLoss: RULES.foulLoss, maxMoves: RULES.maxMoves,
            time: RULES.time, byoyomi: RULES.byoyomi
          }
        }).then(function (j) {
          NET.room = j.room; NET.token = j.token;
          netStartGame(j.side, j.state);
          U.toast('部屋 ' + j.room + ' を作りました。あなたは' + (j.side > 0 ? '先手' : '後手') + 'です');
        });
      }).catch(function (e) { U.dialog('エラー', esc(e.message)); });
    });

    $('btnNetJoin').addEventListener('click', function () {
      var room = ($('netRoom').value || '').trim();
      if (!/^\d{4}$/.test(room)) { U.toast('4桁の部屋番号を入れてください'); return; }
      api('/api/join', { room: room, name: $('netName').value || '対局者' })
        .then(function (j) {
          NET.room = j.room; NET.token = j.token;
          netStartGame(j.side, j.state);
          U.toast('部屋 ' + j.room + ' に参加しました。あなたは' + (j.side > 0 ? '先手' : '後手') + 'です');
        })
        .catch(function (e) { U.dialog('参加できません', esc(e.message)); });
    });

    $('btnNetLeave').addEventListener('click', function () {
      U.dialog('対戦をやめる', '2台対戦から抜けます（棋譜は残ります）。',
        [{ label: 'やめる', value: false }, { label: '抜ける', cls: 'danger', value: true }])
        .then(function (yes) { if (yes) { netLeave(); U.toast('2台対戦から抜けました'); } });
    });

    $('btnNetCopy').addEventListener('click', function () {
      var info = netServerInfo || {};
      var ip = (info.ips && info.ips[0]) || location.hostname;
      var text = 'http://' + ip + ':' + (info.port || location.port) + '/　部屋番号：' + NET.room;
      U.textDialog('もう1台の端末で開く', 'このアドレスを開いて、部屋番号を入力してください。', text, { copy: true });
    });

    // 戦法の選択肢
    function fillStrat(id, side) {
      var sel = $(id);
      if (!sel || !St) return;
      sel.innerHTML = '';
      St.LIST.forEach(function (st) {
        var o = el('option', null, st.name);
        o.value = st.id;
        sel.appendChild(o);
      });
      sel.value = 'auto';
      sel.addEventListener('change', function () {
        STRAT[side > 0 ? 1 : '-1'] = sel.value;
        updateStratNote();
      });
    }
    fillStrat('stratB', 1);
    fillStrat('stratW', -1);
    updateStratNote();

    fillLevelSelect('cpLevel', 4);
    fillLevelSelect('cpLevelB', 8);
    fillLevelSelect('cpLevelW', 5);
    updateLevelNote();
    $('cpLevel').addEventListener('change', updateLevelNote);

    $('btnStartPlay').addEventListener('click', function () {
      var lv = parseInt($('cpLevel').value, 10);
      var mySide = mySideSetting === 0 ? (Math.random() < .5 ? 1 : -1) : mySideSetting;
      var players = {};
      players[mySide > 0 ? 1 : '-1'] = { type: 'human', name: 'あなた', level: 0 };
      players[mySide > 0 ? '-1' : 1] = { type: 'cp', name: 'CP', level: lv };
      G.measure = null;
      G.flip = mySide < 0;
      newGame({ mode: 'play', players: players });
      $('menuSheet').classList.remove('on');
      U.toast('あなたは' + (mySide > 0 ? '先手' : '後手') + 'です');
    });

    $('cpSpeed').addEventListener('input', function () {
      G.cpcp.speed = parseInt(this.value, 10);
      $('cpSpeedVal').textContent = (G.cpcp.speed / 1000).toFixed(1) + '秒';
    });

    $('btnCpStart').addEventListener('click', function () {
      G.measure = null;
      var players = {
        1: { type: 'cp', name: 'CP先手', level: parseInt($('cpLevelB').value, 10) },
        '-1': { type: 'cp', name: 'CP後手', level: parseInt($('cpLevelW').value, 10) }
      };
      newGame({ mode: 'cpcp', players: players });
      $('menuSheet').classList.remove('on');
      G.cpcp.running = true;
      $('btnCpPause').textContent = '一時停止';
      maybeCpMove();
    });
    $('btnCpPause').addEventListener('click', function () {
      if (G.cpcp.running) {
        stopCpLoop(); engine.stop(); G.thinking = false;
        U.toast('一時停止しました'); $('btnCpPause').textContent = '再開';
      } else {
        G.cpcp.running = true; $('btnCpPause').textContent = '一時停止';
        maybeCpMove();
      }
      renderStatus();
    });
    $('btnCpStep').addEventListener('click', function () {
      if (G.finished || G.thinking) return;
      var p = P(G.pos.side);
      if (p.type !== 'cp') { U.toast('CPの手番ではありません'); return; }
      stopCpLoop();
      thinkAndMove(p.level);
    });

    $('btnStartHuman').addEventListener('click', function () {
      G.measure = null;
      var players = {
        1: { type: 'human', name: $('nameInB').value || '先手', level: 0 },
        '-1': { type: 'human', name: $('nameInW').value || '後手', level: 0 }
      };
      newGame({ mode: 'human', players: players });
      $('menuSheet').classList.remove('on');
    });

    $('btnRankStart').addEventListener('click', function () {
      switchTab('rank');
      U.dialog('段位測定', rankGames + '局続けて対局し、勝敗から棋力を推定します。<br>' +
        '・相手の強さは結果に応じて自動で変わります<br>' +
        '・先手／後手は交互になります<br>' +
        '・測定中は「待った」「ヒント」は使えません',
        [{ label: 'やめる', value: false }, { label: '開始', cls: 'primary', value: true }])
        .then(function (yes) { if (yes) startMeasure(); });
    });
    $('btnRankReset').addEventListener('click', function () {
      U.dialog('記録のリセット', '測定した棋力の記録を消します。よろしいですか？',
        [{ label: 'やめる', value: false }, { label: '消す', cls: 'danger', value: true }])
        .then(function (yes) {
          if (!yes) return;
          try { localStorage.removeItem(RATING_KEY); } catch (e) { }
          G.measure = null; renderRankPanel(); updateRankBadge(); U.toast('リセットしました');
        });
    });

    $('btnAnalyze').addEventListener('click', analyzeGame);
    $('btnAnalyzeStop').addEventListener('click', function () {
      analyzeAbort = true; engine.stop(); U.toast('解析を中止しました');
    });

    $('btnSaveKifu').addEventListener('click', saveCurrentKifu);
    $('btnExportKif').addEventListener('click', function () {
      if (!G.moves.length) { U.toast('書き出す手がありません'); return; }
      var text = K.toKif(currentGameObj());
      U.textDialog('KIF形式の棋譜', 'ファイル保存もできます。', text, { copy: true, okLabel: '閉じる' });
      K.download('kifu_' + new Date(G.startedAt).toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.kif', text);
    });
    $('btnCopySfen').addEventListener('click', function () {
      var sfen = G.pos.toSfen();
      var usi = 'position ' + (G.startSfen === START_SFEN ? 'startpos' : 'sfen ' + G.startSfen) +
        (G.moves.length ? ' moves ' + G.moves.map(function (m) { return m.usi; }).join(' ') : '');
      U.textDialog('SFEN / USI', '上：現在局面のSFEN　下：USI形式の棋譜', sfen + '\n\n' + usi, { copy: true });
    });
    $('btnImportKif').addEventListener('click', function () {
      U.textDialog('棋譜の読み込み', 'KIF形式・SFEN・USI（position ... moves ...）を貼り付けるか、ファイルを選んでください。',
        '', { file: true, okLabel: '読み込む', cancel: true })
        .then(function (text) {
          if (!text) return;
          var g;
          try { g = K.parseAny(text); }
          catch (e) { U.toast('読み込めませんでした'); return; }
          if (!g.moves.length && !g.startSfen) { U.toast('棋譜が見つかりませんでした'); return; }
          loadKifuRecord({
            black: g.black, white: g.white, startSfen: g.startSfen || START_SFEN,
            moves: g.moves, result: g.result ? g.result.text : '未終局', date: Date.now()
          });
          switchTab('kifu');
        });
    });

    $('kifuFilter').addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      kifuFilter = c.dataset.tag || '';
      renderKifuList();
    });

    $('kifuList').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var item = e.target.closest('.kifu-item');
      var rec = K.get(item.dataset.id);
      if (!rec) return;
      if (btn.dataset.act === 'load') { loadKifuRecord(rec); }
      if (btn.dataset.act === 'del') {
        K.remove(rec.id); renderKifuList(); U.toast('削除しました');
      }
    });

    $('moveList').addEventListener('click', function (e) {
      var mv = e.target.closest('.mv');
      if (!mv || mv.dataset.n === undefined) return;
      goto(parseInt(mv.dataset.n, 10));
    });

    $('btnFirst').addEventListener('click', function () { goto(0); });
    $('btnPrev').addEventListener('click', function () { goto(G.cursor - 1); });
    $('btnNext').addEventListener('click', function () { goto(G.cursor + 1); });
    $('btnLast').addEventListener('click', function () { goto(G.moves.length); });

    /* ---- シート（メニュー・グラフ）---- */
    function openSheet(id) { $(id).classList.add('on'); }
    function closeSheet(id) { $(id).classList.remove('on'); }
    $('btnMenu').addEventListener('click', function () { openSheet('menuSheet'); });
    $('btnMenuClose').addEventListener('click', function () { closeSheet('menuSheet'); });
    $('menuSheet').addEventListener('click', function (e) { if (e.target === this) closeSheet('menuSheet'); });
    $('btnGraph').addEventListener('click', function () { renderLiveGraph(); openSheet('graphSheet'); });
    $('btnGraphClose').addEventListener('click', function () { closeSheet('graphSheet'); });
    $('graphSheet').addEventListener('click', function (e) { if (e.target === this) closeSheet('graphSheet'); });
    $('btnEvalHide').addEventListener('click', function () {
      VIEW.showEval = false; saveView(); applyViewSetting(); renderMoveList(); renderAnalysisOut();
      U.toast('形勢をかくしました（メニューの「表示」で戻せます）');
    });

    $('btnUndo').addEventListener('click', undo);
    $('btnHint').addEventListener('click', hint);
    $('btnFlip').addEventListener('click', function () { G.flip = !G.flip; refresh(); });
    $('btnDeclare').addEventListener('click', declare);
    $('btnJishogi').addEventListener('click', jishogi);
    $('btnResign').addEventListener('click', resign);
    $('btnNew').addEventListener('click', function () {
      var netOn = G.mode === 'net' && NET.on;
      U.dialog('新規対局',
        netOn ? '2台対戦から抜けて、1台での対局に戻ります。' : '現在の対局を破棄して初期局面に戻します。',
        [{ label: 'やめる', value: false }, { label: 'はじめる', cls: 'primary', value: true }])
        .then(function (yes) {
          if (!yes) return;
          G.measure = null;
          if (netOn) netLeave();
          G.mode = 'human';
          newGame({ startSfen: START_SFEN });
        });
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { goto(G.cursor - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { goto(G.cursor + 1); e.preventDefault(); }
      if (e.key === 'Home') goto(0);
      if (e.key === 'End') goto(G.moves.length);
      if (e.key === 'f') { G.flip = !G.flip; refresh(); }
    });

    // 時計（0.5秒ごとに表示を更新し、秒読みの見た目を滑らかにする）
    setInterval(function () {
      if (G.finished || !atLive() || G.mode === 'view') return;
      var topSide = G.flip ? 1 : -1;
      $('clockWhite').textContent = clockText(topSide);
      $('clockBlack').textContent = clockText(-topSide);
      checkTimeout();
    }, 500);
  }

  function updateStratNote() {
    if (!$('stratNote') || !St) return;
    var b = St.get(stratOf(1)), w = St.get(stratOf(-1));
    var parts = [];
    if (b.id !== 'auto') parts.push('先手 ' + b.name + '：' + b.note);
    if (w.id !== 'auto') parts.push('後手 ' + w.name + '：' + w.note);
    $('stratNote').innerHTML = parts.length
      ? parts.join('<br>') + '<br>序盤24手までその形に組みます。相手に妨げられたら通常の読みに戻ります。'
      : '「おまかせ」は定跡と読みにまかせます。戦法を選ぶと、CPはその形に組みます（あなたの手番なら次の一手を助言します）。';
  }

  function updateLevelNote() {
    var lv = E.level(parseInt($('cpLevel').value, 10));
    $('cpLevelNote').textContent = lv.name + '：' + lv.note + '（目安 ' + E.rankName(lv.rating) + '／内部R' + lv.rating + '）';
  }

  /* ==================================================================
   *  起動
   * ================================================================== */
  /* ---------------- オフライン対応（サービスワーカー） ----------------
   * https:// か localhost で開いたときだけ登録できる。
   * 登録できれば、次からは通信が無くても起動する。
   */
  function setupOffline() {
    var badge = $('offlineBadge');
    if (!('serviceWorker' in navigator)) {
      // iPhoneのChrome/Firefox/Edgeはオフライン保存に対応していない
      var ua = navigator.userAgent;
      if (/CriOS|FxiOS|EdgiOS/.test(ua)) {
        badge.textContent = 'Safariで開く';
        badge.title = 'iPhoneでは Safari で開くと、オフライン保存とホーム画面への追加ができます';
        badge.style.borderColor = 'rgba(255,184,77,.6)';
        badge.style.color = 'var(--accent2)';
      } else {
        badge.textContent = '保存不可';
        badge.title = 'このブラウザはオフライン保存に対応していません';
      }
      return;
    }
    if (location.protocol === 'file:') {
      badge.textContent = '保存なし';
      badge.title = 'ファイルを直接開いているため、オフライン保存は使えません';
      return;
    }
    navigator.serviceWorker.register('sw.js').then(function () {
      return navigator.serviceWorker.ready;
    }).then(function () {
      badge.textContent = '保存済み';
      badge.className = 'badge on';
      badge.title = 'アプリを端末に保存しました。圏内でなくても遊べます';
    }).catch(function () {
      badge.textContent = '保存不可';
      badge.title = 'httpsで開くとオフライン保存が有効になります';
    });
  }

  function boot() {
    bind();
    G.pos = posAt(0);
    G.keys[0] = G.pos.posKey();
    resetClocks();
    syncRuleButtons();
    applyViewSetting();
    refresh();
    updateRankBadge();
    renderKifuList();
    renderRankPanel();
    restoreNetSession();
    setupOffline();

    engine.init().then(function (mode) {
      var b = $('engineBadge');
      if (mode === 'worker') {
        b.textContent = '別スレッド';
        b.className = 'badge on';
      } else {
        b.textContent = '簡易モード';
        b.className = 'badge';
        b.title = 'file:// で開いているため Worker が使えません。ローカルサーバー経由で開くと思考が速くなります。';
        var note = el('div', 'notice');
        note.innerHTML = 'いまブラウザの制限で<b>簡易モード</b>（思考が浅く、考慮中は画面が一瞬止まります）。' +
          '同梱の <b>start.command</b> をダブルクリックして開くと、本来の強さで動きます。';
        var panel = $('panel-play');
        panel.insertBefore(note, panel.firstChild);
      }
      maybeCpMove();
    });
  }

  /* 動作確認用のフック（ブラウザのコンソールから状態を見たいとき用） */
  window.shogiDebug = {
    RULES: RULES, G: G, NET: NET,
    resetClocks: resetClocks, refresh: refresh, remainOf: remainOf
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
