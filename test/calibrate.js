/* 各レベルの「1手の精度」を測り、精度→棋力の対応表を校正する
   実行: node test/calibrate.js [対局あたり最大手数] */
var S=require('../js/shogi.js'), E=require('../js/engine.js');
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
var MAXPLY=parseInt(process.argv[2]||'50',10), GAMETIME=350, ANATIME=250;
function play(lv,seed,maxply){
  var p=S.startpos(), ms=[], rnd=mulberry(seed);
  for(var i=0;i<maxply;i++){ if(S.gameStatus(p)!=='ok')break;
    var r=E.think(p,{level:lv,timeMs:Math.min(E.level(lv).time,GAMETIME),rng:rnd});
    if(!r.move)break; ms.push(r.move); p.doMove(r.move); }
  return ms;
}
function accuracyOf(ms){
  var p=S.startpos(), sc=[];
  for(var i=0;i<=ms.length;i++){
    var r=E.think(p,{level:10,timeMs:ANATIME,deterministic:true});
    sc.push(r.score);
    if(i<ms.length) p.doMove(ms[i]);
  }
  var accs=[], drops=[];
  for(i=0;i<ms.length;i++){
    var wb=E.winProb(sc[i]), wa=E.winProb(-sc[i+1]);
    var d=Math.max(0,wb-wa);
    drops.push(d); accs.push(E.moveAccuracy(d));
  }
  var avg=accs.reduce(function(a,b){return a+b;},0)/accs.length;
  return {acc:avg, drops:drops};
}
var out=[];
[1,2,3,4,5,6,7,8,9,10].forEach(function(lv){
  var ms=play(lv,lv*13+1,MAXPLY);
  var a=accuracyOf(ms);
  var blunders=a.drops.filter(function(d){return d>0.30;}).length;
  out.push([lv,a.acc]);
  console.log('Lv'+lv+' '+E.level(lv).name.padEnd(6,'　')+' 手数'+ms.length+
    '  平均精度='+a.acc.toFixed(1)+'%  大悪手='+blunders+
    '  目安R'+E.level(lv).rating+'  現行推定R'+E.ratingFromAccuracy(a.acc));
});
console.log('\n校正用データ [精度, 目安R]:');
console.log(out.map(function(o){return '['+o[1].toFixed(1)+', '+E.level(o[0]).rating+']';}).join(', '));
