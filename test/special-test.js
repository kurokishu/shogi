/* 特殊駒の動作確認  実行: node test/special-test.js */
var S=require('../js/shogi.js');
var fail=0;
function check(l,c,x){console.log((c?'OK  ':'NG  ')+l+(x?'  '+x:''));if(!c)fail++;}
function dests(p,from){
  return p.legalMoves().filter(function(m){return !S.mvIsDrop(m)&&!S.mvIsShoot(m)&&S.mvFrom(m)===from;})
          .map(function(m){return S.fileOf(S.mvTo(m))+''+S.rankOf(S.mvTo(m));})
          .filter(function(v,i,a){return a.indexOf(v)===i;}).sort();
}

/* 騎士：8方向へ跳ぶ */
(function(){
  var p=S.fromSfen('4k4/9/9/9/4Y4/9/9/9/4K4 b - 1');   // 5五に騎士
  var d=dests(p,S.sqOf(5,5));
  check('騎士は8方向へ跳ぶ', d.length===8, d.join(' '));
  // 間に駒があっても跳べる
  var q=S.fromSfen('4k4/9/9/4P4/4Y4/9/9/9/4K4 b - 1');
  check('騎士は駒を飛び越す', dests(q,S.sqOf(5,5)).length===8);
})();

/* 忍：前1マス＋斜め後ろ2マス */
(function(){
  var p=S.fromSfen('4k4/9/9/9/4D4/9/9/9/4K4 b - 1');   // 5五に忍
  var d=dests(p,S.sqOf(5,5));
  check('忍は3ヶ所に動ける', d.length===3, d.join(' '));
  check('忍は斜め後ろ2マスへ', d.indexOf('37')>=0&&d.indexOf('77')>=0, d.join(' '));
})();

/* 風車：指すたびに飛と角が入れ替わる */
(function(){
  var p=S.fromSfen('4k4/9/9/9/4W4/9/9/9/4K4 b - 1');   // 5五に風車（飛モード）
  var d1=dests(p,S.sqOf(5,5));
  check('風車（飛モード）は縦横に動く', d1.length===15 && d1.indexOf('55')<0 && d1.indexOf('44')<0, d1.join(' '));
  var m=S.mkMove(S.sqOf(5,5),S.sqOf(5,4),0);
  p.doMove(m); p.doNull();
  var v=p.board[S.sqOf(5,4)];
  check('動いた後は角モードになる', v===S.WIND_B, '駒コード='+v);
  var d2=dests(p,S.sqOf(5,4));
  check('風車（角モード）は斜めに動く', d2.indexOf('64')<0 && d2.indexOf('63')>=0, d2.join(' '));
  p.undoMove(); p.undoMove();
  check('取り消すと飛モードに戻る', p.board[S.sqOf(5,5)]===S.WIND_R);
})();

/* 弓兵：射撃と移動の交互 */
(function(){
  var p=S.fromSfen('4k4/9/9/4p4/4A4/9/9/9/4K4 b - 1');  // 5五弓兵、5四に相手の歩…は隣接
  // 2マス先に相手の歩を置く
  p=S.fromSfen('4k4/9/9/9/4A4/9/9/9/4K4 b - 1');
  p.board[S.sqOf(5,3)] = -S.FU;   // 5三＝2マス先
  p.computeKey();
  var shoots=p.legalMoves().filter(S.mvIsShoot);
  check('弓兵は2マス先を撃てる', shoots.length===1, shoots.length+'通り');
  var before=p.board[S.sqOf(5,5)];
  p.doMove(shoots[0]);
  check('撃っても弓兵は動かない', p.board[S.sqOf(5,5)]===S.ARCHER_S*1||p.board[S.sqOf(5,5)]===S.ARCHER_M*1,
        '駒='+p.board[S.sqOf(5,5)]);
  check('撃った歩が消える', p.board[S.sqOf(5,3)]===0);
  check('撃った後は「要移動」状態', p.board[S.sqOf(5,5)]===S.ARCHER_M, '駒='+p.board[S.sqOf(5,5)]);
  p.doNull();
  check('要移動の間は撃てない', p.legalMoves().filter(S.mvIsShoot).length===0);
  p.undoMove(); p.undoMove();
  check('取り消すと元に戻る', p.board[S.sqOf(5,5)]===before && p.board[S.sqOf(5,3)]===-S.FU);
})();

/* 転生兵：取られると自陣に歩で復活 */
(function(){
  var p=S.fromSfen('4k4/9/9/9/4E4/9/9/9/4K4 w - 1');   // 5五に先手の転生兵、後手番
  p.board[S.sqOf(5,4)] = -S.HI; p.computeKey();        // 5四に後手の飛車
  var m=S.mkMove(S.sqOf(5,4),S.sqOf(5,5),0);
  p.doMove(m);
  check('転生兵は相手の持ち駒にならない', p.hands[1][S.KI]===0 && p.hands[1][S.FU]===0);
  var revived=0;
  for(var i=0;i<81;i++) if(p.board[i]===S.FU) revived++;
  check('自陣に歩として復活する', revived===1, revived+'枚');
  check('復活の残り回数が減る', p.rebornLeft[0]===1, '残り'+p.rebornLeft[0]);
  p.undoMove();
  check('取り消すと復活も戻る', p.rebornLeft[0]===2 && p.board[S.sqOf(5,5)]===S.REBORN);
})();

/* SFENの往復 */
(function(){
  var sf='4k4/9/9/2D6/4Y4/6W2/1A7/9/4K1E2 b - 1';
  var p=S.fromSfen(sf);
  check('特殊駒のSFEN往復', p.toSfen()===sf, p.toSfen());
})();

console.log(fail===0?'\n=== 特殊駒テスト成功 ===':'\n=== 失敗 '+fail+' 件 ===');
process.exit(fail?1:0);
