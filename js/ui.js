/* ==========================================================================
 * ui.js — 盤面描画・入力・共通ダイアログ
 *   依存: shogi.js
 * ========================================================================== */
(function (root) {
  'use strict';
  var S = root.Shogi;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var cells = [];
  var handlers = { cell: null, hand: null };

  /* ---------------- 盤の生成 ---------------- */
  function initBoard(h) {
    handlers = h || handlers;
    var board = $('board');
    board.innerHTML = '';
    cells = [];
    for (var i = 0; i < 81; i++) {
      var c = el('div', 'cell');
      c.dataset.idx = i;
      c.addEventListener('click', onCellClick);
      board.appendChild(c);
      cells.push(c);
    }
    $('handBlack').addEventListener('click', onHandClick);
    $('handWhite').addEventListener('click', onHandClick);
  }

  var curFlip = false;

  function dispToSq(idx) { return curFlip ? 80 - idx : idx; }
  function sqToDisp(sq) { return curFlip ? 80 - sq : sq; }

  function onCellClick(ev) {
    var idx = parseInt(ev.currentTarget.dataset.idx, 10);
    if (handlers.cell) handlers.cell(dispToSq(idx));
  }
  function onHandClick(ev) {
    var t = ev.target.closest ? ev.target.closest('.hand-piece') : null;
    if (!t || !handlers.hand) return;
    handlers.hand(parseInt(t.dataset.side, 10), parseInt(t.dataset.pt, 10));
  }

  /* ---------------- ラベル ---------------- */
  function renderLabels() {
    var fl = $('fileLabels'), rl = $('rankLabels');
    fl.innerHTML = ''; rl.innerHTML = '';
    for (var i = 0; i < 9; i++) {
      fl.appendChild(el('div', null, String(curFlip ? i + 1 : 9 - i)));
      rl.appendChild(el('div', null, S.KANJI_NUM[curFlip ? 9 - i : i + 1]));
    }
  }

  /* ---------------- 駒 ---------------- */
  function pieceEl(pc) {
    var p = pc > 0 ? pc : -pc;
    var ch = S.PIECE_CHAR[p];
    var e = el('div', 'piece' + (pc < 0 ? ' gote' : '') + (p >= 9 ? ' promo' : ''), ch);
    return e;
  }

  /* ---------------- 全体描画 ----------------
   * state: {flip, selSq, selHand:{side,pt}, dests:[], last:{from,to}, checkSide,
   *         handEnabled:{1:bool,-1:bool}}
   */
  function render(pos, state) {
    state = state || {};
    var needLabels = curFlip !== !!state.flip;
    curFlip = !!state.flip;
    if (needLabels || !$('fileLabels').children.length) renderLabels();

    var destSet = {};
    if (state.dests) for (var i = 0; i < state.dests.length; i++) destSet[state.dests[i]] = 1;

    var checkSq = -1;
    if (state.checkSide) checkSq = pos.kingSq[state.checkSide > 0 ? 0 : 1];

    for (var sq = 0; sq < 81; sq++) {
      var c = cells[sqToDisp(sq)];
      var cls = 'cell';
      if (state.selSq === sq) cls += ' sel';
      if (state.last && (state.last.from === sq || state.last.to === sq)) cls += ' last';
      if (checkSq === sq) cls += ' check';
      if (destSet[sq]) cls += pos.board[sq] !== 0 ? ' dest occupied' : ' dest';
      c.className = cls;
      var pc = pos.board[sq];
      var cur = c.firstChild;
      var want = pc === 0 ? '' : String(pc);
      if (c.dataset.pc !== want) {
        c.innerHTML = '';
        if (pc !== 0) c.appendChild(pieceEl(pc));
        c.dataset.pc = want;
      } else if (pc !== 0 && !cur) {
        c.appendChild(pieceEl(pc));
      }
    }

    // 持駒（上段＝盤の向きに応じて相手側）
    var topSide = curFlip ? S.BLACK : S.WHITE;
    renderHand($('handWhite'), pos, topSide, state, true);
    renderHand($('handBlack'), pos, -topSide, state, false);
  }

  function renderHand(box, pos, side, state, isTop) {
    box.className = 'hand ' + (side > 0 ? 'sente' : 'gote');
    var enabled = state.handEnabled && state.handEnabled[side];
    if (!enabled) box.className += ' disabled';
    // 上段の持駒は常に180度回転して表示（対面の相手の駒として）
    if (isTop) box.className = box.className.replace(/\bsente\b|\bgote\b/, 'gote');
    else box.className = box.className.replace(/\bsente\b|\bgote\b/, 'sente');

    var ci = side > 0 ? 0 : 1, html = '', any = false;
    for (var i = 0; i < S.HAND_ORDER.length; i++) {
      var pt = S.HAND_ORDER[i], n = pos.hands[ci][pt];
      if (!n) continue;
      any = true;
      var sel = state.selHand && state.selHand.side === side && state.selHand.pt === pt;
      html += '<div class="hand-piece' + (sel ? ' sel' : '') + '" data-side="' + side + '" data-pt="' + pt + '">' +
        S.PIECE_CHAR[pt] + (n > 1 ? '<span class="cnt">' + n + '</span>' : '') + '</div>';
    }
    if (!any) html = '<span class="empty">持駒なし</span>';
    box.innerHTML = html;
  }

  /* ---------------- 評価バー ---------------- */
  function setEval(score, mateInfo) {
    var pct = 50 + 50 * Math.tanh(score / 900);
    pct = Math.max(1, Math.min(99, pct));
    $('evalFill').style.width = pct + '%';
    var txt;
    if (mateInfo) txt = mateInfo;
    else txt = (score > 0 ? '+' : score < 0 ? '' : '±') + score;
    $('evalText').innerHTML = '評価値 <b>' + txt + '</b>';
  }

  /* ---------------- トースト ---------------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, ms || 2200);
  }

  /* ---------------- メッセージダイアログ ----------------
   * buttons: [{label, cls, value}] / 戻り値は Promise<value>
   */
  function dialog(title, bodyHtml, buttons) {
    return new Promise(function (resolve) {
      $('msgTitle').textContent = title;
      $('msgBody').innerHTML = bodyHtml;
      var box = $('msgActions');
      box.innerHTML = '';
      (buttons || [{ label: 'OK', cls: 'primary', value: true }]).forEach(function (b) {
        var btn = el('button', 'btn ' + (b.cls || ''), b.label);
        btn.addEventListener('click', function () {
          $('msgOverlay').classList.remove('on');
          resolve(b.value);
        });
        box.appendChild(btn);
      });
      $('msgOverlay').classList.add('on');
    });
  }

  /* ---------------- テキストダイアログ ---------------- */
  function textDialog(title, desc, value, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      $('textTitle').textContent = title;
      $('textDesc').textContent = desc || '';
      var ta = $('textArea');
      ta.value = value || '';
      ta.readOnly = !!opts.readOnly;
      var box = $('textActions');
      box.innerHTML = '';
      if (opts.copy) {
        var cb = el('button', 'btn', 'コピー');
        cb.addEventListener('click', function () {
          ta.select();
          try { document.execCommand('copy'); toast('コピーしました'); }
          catch (e) { if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(function () { toast('コピーしました'); }); }
        });
        box.appendChild(cb);
      }
      if (opts.file) {
        var fb = el('button', 'btn', 'ファイルを選ぶ');
        var input = el('input');
        input.type = 'file'; input.accept = '.kif,.kifu,.txt,.csa,.sfen'; input.style.display = 'none';
        input.addEventListener('change', function () {
          var f = input.files && input.files[0];
          if (!f) return;
          var fr = new FileReader();
          fr.onload = function () { ta.value = String(fr.result); };
          fr.readAsText(f, 'UTF-8');
        });
        fb.addEventListener('click', function () { input.click(); });
        box.appendChild(fb); box.appendChild(input);
      }
      var ok = el('button', 'btn primary', opts.okLabel || '閉じる');
      ok.addEventListener('click', function () {
        $('textOverlay').classList.remove('on');
        resolve(ta.value);
      });
      if (opts.cancel) {
        var cc = el('button', 'btn', 'キャンセル');
        cc.addEventListener('click', function () {
          $('textOverlay').classList.remove('on');
          resolve(null);
        });
        box.appendChild(cc);
      }
      box.appendChild(ok);
      $('textOverlay').classList.add('on');
    });
  }

  /* ---------------- 成り確認 ---------------- */
  function askPromote(pieceType) {
    return new Promise(function (resolve) {
      var box = $('promoChoices');
      box.innerHTML = '';
      var opts = [
        { label: '成る', pc: S.PIECE_CHAR[S.prom(pieceType)], promo: true, cls: 'promo' },
        { label: '成らず', pc: S.PIECE_CHAR[pieceType], promo: false, cls: '' }
      ];
      opts.forEach(function (o) {
        var b = el('button');
        var p = el('div', 'pc ' + o.cls, o.pc);
        b.appendChild(p);
        b.appendChild(el('span', null, o.label));
        b.addEventListener('click', function () {
          $('promoOverlay').classList.remove('on');
          resolve(o.promo);
        });
        box.appendChild(b);
      });
      $('promoCancel').onclick = function () {
        $('promoOverlay').classList.remove('on');
        resolve(null);
      };
      $('promoOverlay').classList.add('on');
    });
  }

  root.UI = {
    $: $, el: el, initBoard: initBoard, render: render, setEval: setEval,
    toast: toast, dialog: dialog, textDialog: textDialog, askPromote: askPromote
  };
})(typeof self !== 'undefined' ? self : this);
