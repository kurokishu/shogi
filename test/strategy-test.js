/* 戦法どおりに組めるかの確認  実行: node test/strategy-test.js */
var S=require('../js/shogi.js'), E=require('../js/engine.js'), St=require('../js/strategy.js');
var fail=0;
St.LIST.filter(function(x){return x.id!=='auto';}).forEach(function(st){
  [1,-1].forEach(function(side){
    var p=S.startpos(), log=[], prev=-1, used=0;
    for(var i=0;i<26;i++){
      var m=0;
      if(p.side===side) m=St.nextMove(p, st.id);
      if(m) used++;
      if(!m){ var r=E.think(p,{level:6,timeMs:120,deterministic:true}); m=r.move; }
      if(!m) break;
      if(!p.isLegal(m)){ console.log('!! 非合法', st.name, S.moveToUsi(m)); fail++; break; }
      if(p.side===side) log.push(S.moveToJa(p,m,prev,{}));
      prev=S.mvTo(m); p.doMove(m);
    }
    console.log((side>0?'先手 ':'後手 ')+st.name.padEnd(7,'　')+' 戦法手'+used+'手 → '+log.slice(0,9).join(' '));
  });
});
console.log(fail===0?'\n=== 戦法テスト成功 ===':'\n=== 失敗 '+fail+' 件 ===');
process.exit(fail?1:0);
