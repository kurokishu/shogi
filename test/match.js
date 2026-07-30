/* レベル間の強さ順序を確認する簡易マッチ  実行: node test/match.js [A] [B] [局数] */
var S=require('../js/shogi.js'), E=require('../js/engine.js');
function playGame(la,lb,seed){
  var p=S.startpos(), seen={}, rnd=mulberry(seed);
  for(var i=0;i<400;i++){
    var st=S.gameStatus(p);
    if(st!=='ok') return p.side>0?-1:1;              // 手番側の負け
    var k=p.posKey(); seen[k]=(seen[k]||0)+1; if(seen[k]>=4) return 0;
    var lv = p.side>0?la:lb;
    var r=E.think(p,{level:lv, timeMs:Math.min(E.level(lv).time,300), rng:rnd});
    if(!r.move) return p.side>0?-1:1;
    p.doMove(r.move);
  }
  var e=E.evaluate(p);
  return e>300?1:(e<-300?-1:0);
}
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
var A=parseInt(process.argv[2]||'6'),B=parseInt(process.argv[3]||'3'),N=parseInt(process.argv[4]||'6');
var w=0,l=0,d=0;
for(var g=0;g<N;g++){
  var r = (g%2===0) ? playGame(A,B,g+1) : -playGame(B,A,g+1);  // 手番を入れ替え、Aから見た結果に統一
  if(r>0)w++; else if(r<0)l++; else d++;
  process.stdout.write((r>0?'○':r<0?'●':'△'));
}
console.log('\nLv'+A+'('+E.level(A).name+') vs Lv'+B+'('+E.level(B).name+') : '+w+'勝 '+l+'敗 '+d+'分  勝率'+Math.round((w+d/2)/N*100)+'%');
