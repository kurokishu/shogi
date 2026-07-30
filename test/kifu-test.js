/* 棋譜入出力のテスト（KIF書き出し→読み込みで一致するか / USI読み込み）
 * 実行: node test/kifu-test.js
 */
var S = require('../js/shogi.js');
var E = require('../js/engine.js');
var K = require('../js/kifu.js');
var fail = 0;

function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* CP同士で1局作る（持駒・成り・打つ手を含む棋譜にする） */
var rnd = mulberry(42);
var pos = S.startpos(), moves = [];
for (var i = 0; i < 120; i++) {
  if (S.gameStatus(pos) !== 'ok') break;
  var r = E.think(pos, { level: 3, timeMs: 60, rng: rnd });
  if (!r.move) break;
  moves.push({ usi: S.moveToUsi(r.move), sec: 3 });
  pos.doMove(r.move);
}
console.log('テスト用棋譜: ' + moves.length + '手');

var game = {
  startSfen: S.startpos().toSfen(), moves: moves,
  black: 'CP先手', white: 'CP後手',
  result: { kif: '投了', text: '先手の勝ち（投了）' }, startedAt: Date.now()
};

/* 1) KIF 書き出し → 読み込み → 手が一致するか */
var kif = K.toKif(game);
console.log('--- KIF 先頭8行 ---');
console.log(kif.split('\n').slice(0, 8).join('\n'));
var back = K.parseKif(kif);
var same = back.moves.length === moves.length;
if (same) for (var j = 0; j < moves.length; j++) if (back.moves[j].usi !== moves[j].usi) { same = false; break; }
console.log('KIF往復一致:', same ? 'OK' : 'NG（' + back.moves.length + '/' + moves.length + '手）');
if (!same) {
  fail++;
  for (var k = 0; k < Math.min(moves.length, back.moves.length); k++) {
    if (back.moves[k].usi !== moves[k].usi) { console.log('  最初の不一致 ' + (k + 1) + '手目: 期待' + moves[k].usi + ' → ' + back.moves[k].usi); break; }
  }
}
console.log('KIFヘッダ:', back.black, 'vs', back.white, '/ 終局=', back.result && back.result.text);

/* 2) USI形式の読み込み */
var usiText = 'position startpos moves ' + moves.map(function (m) { return m.usi; }).join(' ');
var u = K.parseUsiText(usiText);
console.log('USI読み込み:', u.moves.length === moves.length ? 'OK' : 'NG (' + u.moves.length + ')');
if (u.moves.length !== moves.length) fail++;

/* 3) 途中局面(SFEN)付きのUSI */
var midSfen = (function () {
  var p = S.startpos();
  for (var i = 0; i < 20; i++) p.doMove(S.usiToMove(p, moves[i].usi));
  return p.toSfen();
})();
var u2 = K.parseAny('position sfen ' + midSfen + ' moves ' + moves.slice(20, 30).map(function (m) { return m.usi; }).join(' '));
var ok3 = u2.startSfen === midSfen && u2.moves.length === 10;
console.log('SFEN付きUSI読み込み:', ok3 ? 'OK' : 'NG');
if (!ok3) { fail++; console.log('  startSfen=', u2.startSfen, 'moves=', u2.moves.length); }

/* 4) 実物に近いKIF（同・打・成・不成を含む手書き風）を読めるか */
var handKif = [
  '#KIF version=2.0 encoding=UTF-8',
  '開始日時：2026/07/30',
  '手合割：平手',
  '先手：太郎',
  '後手：花子',
  '手数----指手---------消費時間--',
  '   1 ７六歩(77)   ( 0:03/00:00:03)',
  '   2 ３四歩(33)   ( 0:02/00:00:02)',
  '   3 ２二角成(88)   ( 0:05/00:00:08)',
  '   4 同飛(82)   ( 0:01/00:00:03)',
  '   5 角打(00)   ( 0:04/00:00:12)'
].join('\n');
var h = K.parseKif(handKif);
console.log('手書き風KIF:', h.black + ' vs ' + h.white + ' / ' + h.moves.length + '手 → ' +
  h.moves.map(function (m) { return m.usi; }).join(' '));
var ok4 = h.moves.length >= 4 && h.moves[0].usi === '7g7f' && h.moves[2].usi === '8h2b+' && h.moves[3].usi === '8b2b';
console.log('  「同」「成」の解釈:', ok4 ? 'OK' : 'NG');
if (!ok4) fail++;

console.log(fail === 0 ? '\n=== 棋譜テスト成功 ===' : '\n=== 失敗 ' + fail + ' 件 ===');
process.exit(fail ? 1 : 0);
