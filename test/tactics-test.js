/* 戦法・囲い・手筋の判定テスト  実行: node test/tactics-test.js
   相手は手を渡す（何もしない）ことで、指定戦法の完成形だけを作って判定する。 */
var S=require('../js/shogi.js'), St=require('../js/strategy.js'), T=require('../js/tactics.js');
var fail=0;
function check(l,c,x){console.log((c?'OK  ':'NG  ')+l+(x?'  '+x:''));if(!c)fail++;}

function buildFormation(stratId, side){
  var p=S.startpos();
  if(side<0) p.doNull();                    // 後手番から始める
  for(var i=0;i<20;i++){
    var m=St.nextPlan(p, stratId, 'auto', 60);
    if(!m) break;
    p.doMove(m);
    p.doNull();                             // 相手は手を渡す
  }
  return p;
}

[['shiken','美濃囲い','四間飛車'],
 ['sanken','美濃囲い','三間飛車'],
 ['nakabisha','美濃囲い','中飛車'],
 ['mukai','美濃囲い','向かい飛車'],
 ['ishida','美濃囲い','石田流'],
 ['yagura','矢倉囲い','居飛車'],
 ['ibisha',null,'居飛車'],
 ['kurotaki82',null,'右四間飛車']].forEach(function(c){
  [1,-1].forEach(function(side){
    var p=buildFormation(c[0], side);
    var ca=T.detectCastle(p,side), st=T.detectStrategy(p,side);
    var okC = c[1]===null || (ca&&ca.name===c[1]);
    var okS = st&&st.name===c[2];
    check((side>0?'先手 ':'後手 ')+St.get(c[0]).name.padEnd(7,'　'), okC&&okS,
      '囲い='+(ca?ca.name:'なし')+' 戦法='+(st?st.name:'なし'));
  });
});

/* ---- 手筋 ---- */
function tech(sfen, m){
  var p=S.fromSfen(sfen), b=p.clone();
  p.doMove(m);
  return T.detectTechnique(b,m,p);
}
var t;
t=tech('4k4/9/4P4/9/9/9/9/9/4K4 b - 1', S.mkMove(S.sqOf(5,3),S.sqOf(5,2),1));
check('と金作り', t&&t.name==='と金作り', t?t.name:'検出なし');

// 1五角：5一の玉に王手しつつ、3七の飛車に当てる
t=tech('4k4/9/9/9/9/9/6r2/9/4K4 b B 1', S.mkDrop(S.KA, S.sqOf(1,5)));
check('王手飛車', t&&t.name==='王手飛車', t?t.name:'検出なし');

t=tech('4k4/9/9/9/9/9/9/9/4K4 b P 1', S.mkDrop(S.FU, S.sqOf(6,3)));
check('垂れ歩', t&&t.name==='垂れ歩', t?t.name:'検出なし');

// 5五銀打：4四と6四の金に両当たり（割り打ちの銀）
t=tech('4k4/9/9/3g1g3/9/9/9/9/4K4 b S 1', S.mkDrop(S.GI, S.sqOf(5,5)));
check('割り打ちの銀', t&&(t.name==='割り打ちの銀'||t.name==='両取り'), t?t.name:'検出なし');

// 香を打って2枚串刺し（田楽刺し）
t=tech('4k4/9/9/4r4/9/4g4/9/9/4K4 b L 1', S.mkDrop(S.KY, S.sqOf(5,8)));
check('田楽刺し', t&&t.name==='田楽刺し', t?t.name:'検出なし');

console.log(fail===0?'\n=== 判定テスト成功 ===':'\n=== 失敗 '+fail+' 件 ===');
process.exit(fail?1:0);
