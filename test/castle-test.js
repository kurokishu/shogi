/* 囲いの手順が、狙った形に組み上がるか確認する  実行: node test/castle-test.js */
var S = require('../js/shogi.js');
var St = require('../js/strategy.js');
var T = require('../js/tactics.js');

var 期待 = {
  yagura: '矢倉囲い', mino: '美濃囲い', takamino: '高美濃囲い', ginkanmuri: '銀冠',
  funa: '舟囲い', nakazumai: '中住まい', kinmusou: '金無双',
  anaguma: '居飛車穴熊', furianaguma: '振り飛車穴熊'
};
/* その囲いを組むのに必要な、飛車の位置をつくる戦法 */
var 相性 = {
  yagura: 'yagura', mino: 'shiken', takamino: 'shiken', ginkanmuri: 'shiken',
  funa: 'ibisha', nakazumai: 'ibisha', kinmusou: 'shiken',
  anaguma: 'ibisha', furianaguma: 'shiken'
};
var ng = 0;
[1, -1].forEach(function (side) {
  St.CASTLE_LIST.forEach(function (c) {
    if (!c.moves.length) return;
    /* 囲いは戦法と組み合わせて成立する（美濃は飛車が2八から動いている必要がある等）。
       相性のよい戦法を先に指してから、囲いを組む。 */
    var strat = 相性[c.id];
    var pos = S.startpos();
    if (side < 0) pos.doNull();                 // 後手番から始める
    var played = [];
    for (var i = 0; i < 40; i++) {
      var m = St.nextPlan(pos, strat, c.id, 60);
      if (!m) break;
      played.push(S.moveToJa(pos, m));
      pos.doMove(m);
      pos.doNull();                             // 相手は手を渡す
    }
    var got = T.detectCastle(pos, side);
    var name = got ? got.name : 'なし';
    var ok = (name === 期待[c.id]);
    if (!ok) ng++;
    console.log((ok ? 'OK  ' : 'NG  ') + (side > 0 ? '先手 ' : '後手 ') +
      c.name.padEnd(7, '　') + ' → ' + name + '  (' + played.length + '手)');
  });
});
console.log(ng ? '\n=== 失敗 ' + ng + ' 件 ===' : '\n=== 囲いテスト成功 ===');
if (ng) process.exit(1);
