# 将棋アプリ UI 改修依頼書（生成AI向け指示書）

このファイルの内容をそのまま生成AIに渡してください。
**`index.html` と `css/style.css` の2つだけ**を作り直してもらいます。
JavaScript（`js/` の中身）は完成しており、**一切変更しません**。

---

## 0. 絶対条件（最重要）

JavaScript が HTML の要素を **id で探して動かしています**。
**「必須id一覧」（第5章）のidを1つでも欠くと、その機能が動かなくなります。**

- id は**すべて残す**（見た目は自由に変えてよい）
- 使わない機能の要素も、**`style="display:none"` で隠して残す**（削除しない）
- `class` 名（`seg-btn` など指定のもの）と `data-*` 属性も**そのまま残す**
- `<script>` タグの読み込み順を変えない
- 新しい JavaScript ライブラリを追加しない（CDNも不可。オフラインで動かすため）

---

## 1. アプリの概要

スマートフォンで遊ぶ将棋アプリです。次の6つのモードがあります。

| モード | 内容 |
|---|---|
| 対CP戦 | コンピュータと対局（強さ10段階） |
| CP対CP | コンピュータ同士の対局を観戦 |
| 対人戦 | 1台の端末を交代で使って2人で対局 |
| 2台で対戦 | 2台のスマホで通信対局 |
| 段位測定 | 3〜7局続けて指し、棋力を推定 |
| 棋譜・解析 | 棋譜の保存・読み込み・解析（形勢グラフ、悪手の指摘） |

**利用環境：iPhone / Android のブラウザが主。ホーム画面に追加して全画面で使う。**

---

## 2. 今の画面の問題点（これを直したい）

1. **盤以外の情報が多く、盤が小さい。** 持駒の帯が、駒を持っていなくても場所を取っている
2. **どちらの手番か分かりにくい。** 枠線の色だけで示しており、スマホでは気づけない
3. **相手が何を指したか分からない。** 盤の色が変わるだけで、文字で出ていない
4. **投了・待ったのボタンが画面外**にあり、下までスクロールしないと押せない
5. タブが6個あり2段になって場所を取る。対局中に使わないタブも常時見えている
6. エンジン情報（探索ノード数など）や棋譜リストが、対局中も常に表示されていて情報過多
7. 全体に文字が小さく、余白が詰まっていて読みにくい

---

## 3. 追加してほしい機能（今回の主目的）

### ① 双方の持ち時間を、はっきり見えるように

- 相手・自分それぞれの**残り時間**を常に表示する
- **手番側の時計だけが動く**（動いている方を目立たせる）
- 残り1分を切ったら**赤く**する
- 秒読み中は「秒読み 25秒」のように出す（残り時間ではなく1手ごとの持ち時間）
- 持ち時間なしの設定のときは、消費時間（0:00形式）を出す

> 表示する文字列は JavaScript 側が `#clockBlack` `#clockWhite` に入れます。
> **HTML側は「置き場所と見た目」だけ**を用意してください。

### ② 形勢グラフを見られるように

現在は「形勢バー（横棒）」しかありません。次の2つを表示できるようにしてください。

- **形勢バー**：`#evalWrap` の中。今の局面の形勢を横棒で表示（既存）
- **形勢グラフ**：対局の最初から現在までの形勢の推移を折れ線で表示

グラフの中身（SVG）は JavaScript が `#analyzeOut` の中に描きます。
HTML側では、**グラフを置く領域を確保**し、対局画面からも見られるようにしてください
（例：盤の下に折りたたみで置く、または「形勢」タブを設ける）。

- `#evalWrap` 全体は JavaScript が `display:none` で隠すことがあります（「かくす」設定）
- グラフ領域も同様に隠せるようにしてください

---

## 4. 画面構成の希望

### 対局中の画面（上から順に）

```
┌────────────────────────────────┐
│ ☗相手の名前（アマ強豪）   [持駒]      残り 3:24 │ ← 手番なら帯が光る
├────────────────────────────────┤
│                                    │
│         盤（画面幅いっぱい・座標つき）        │
│                                    │
├────────────────────────────────┤
│ ☖あなた                [持駒]      残り 9:58 │
├────────────────────────────────┤
│  ● あなたの番です      直前：▲2六歩          │
├────────────────────────────────┤
│  形勢バー（表示/非表示を切替可）              │
├────────────────────────────────┤
│  待った  │  ヒント  │  投了  │  ⋯（その他）    │
└────────────────────────────────┘
```

**変更のポイント**

| 今 | こうしてほしい |
|---|---|
| 持駒が独立した帯（駒がなくても高さを取る） | 名前と同じ行に入れる。持駒がないときは高さを詰める |
| 手番が枠線の色だけ | 帯の色を変え、**「あなたの番です」と文字でも**出す |
| 直前の手が分からない | 「直前：▲2六歩」を文字で出す（`#statusLine` に入ります） |
| タブ6個が常時2段 | 対局中は隠し、「⋯」で開く形にする（タブ自体は`#tabs`に残す） |
| 操作ボタンが画面外 | **盤のすぐ下に固定**して、スクロールなしで押せるように |
| エンジン情報・棋譜リストが常時表示 | 折りたたみ、または別タブに移す（要素は残す） |

### 盤のデザイン要件

- 盤は**画面の横幅いっぱい**（左右の余白は最小限）
- マス目の線がはっきり見えること
- **駒は大きく、太い字**で。小さい画面でも判別できること
- **自分の駒は正立、相手の駒は180度回転**（JavaScript が `.piece.upside` を付けます。CSSで `transform: rotate(180deg)` を当ててください）
- 相手の駒は**わずかに色を変える**（`.piece.gote` にCSSを当てる）
- 成駒は**赤い字**（`.piece.promo`）
- 選択中のマス、動かせる場所、直前に動いたマス、王手されている玉が、**一目で区別できる色**であること
- 筋（1〜9）と段（一〜九）の座標を盤の外に表示

---

## 5. 必須id一覧（1つも欠かさないこと）

### 盤・対局者

| id | 役割 |
|---|---|
| `board` | 盤本体。**空のまま**にする（JavaScriptが81個のマスを作る） |
| `fileLabels` | 筋の座標（1〜9）。空のまま |
| `rankLabels` | 段の座標（一〜九）。空のまま |
| `handWhite` | 画面**上側**の持駒置き場。空のまま |
| `handBlack` | 画面**下側**の持駒置き場。空のまま |
| `barWhite` `nameWhite` `whoWhite` `clockWhite` | 上側の対局者の帯・名前・種別・時計 |
| `barBlack` `nameBlack` `whoBlack` `clockBlack` | 下側の対局者の帯・名前・種別・時計 |
| `statusLine` | 状況表示（手番・王手・直前の手など） |

※ `barWhite` `barBlack` には、手番のとき JavaScript が `class="player-bar active"` を付けます。
　CSSで `.player-bar.active` を目立たせてください。

### 形勢表示

| id | 役割 |
|---|---|
| `evalWrap` | 形勢表示のまとまり（JavaScriptが display で切り替える） |
| `evalFill` | 形勢バーの中身。JavaScriptが `style.width` を % で入れる |
| `evalText` | 評価値の文字 |

### タブとパネル

| id | 役割 |
|---|---|
| `tabs` | タブの入れ物。中に `<button data-tab="play">` 等を6個置く |
| `panel-play` `panel-cpcp` `panel-human` `panel-net` `panel-rank` `panel-kifu` | 各タブの中身。表示中のものに `class="panel on"` が付く |

`data-tab` の値：`play` `cpcp` `human` `net` `rank` `kifu`

### 各パネルの中の要素

**対CP戦（panel-play）**
`cpLevel`（`<select>`）, `cpLevelNote`, `btnStartPlay`
＋ `<div class="seg-btn" data-myside="1">先手</div>`（`-1`＝後手、`0`＝ランダム）

**CP対CP（panel-cpcp）**
`cpLevelB` `cpLevelW`（`<select>`）, `cpSpeed`（`<input type="range">`）, `cpSpeedVal`,
`btnCpStart` `btnCpPause` `btnCpStep`

**対人戦（panel-human）**
`nameInB` `nameInW`（`<input type="text">`）, `btnStartHuman`
＋ `data-autoflip="0"` / `data-autoflip="1"` の `seg-btn`

**2台で対戦（panel-net）**
`netOffline` `netSetup` `netActive` `netUrls` `netName` `netRoom` `netRoomNo` `netStatus` `netServer`,
`btnNetCreate` `btnNetJoin` `btnNetLeave` `btnNetCopy` `btnNetServerSave`
＋ `data-netside="1"/"-1"/"0"` の `seg-btn`

**段位測定（panel-rank）**
`rankBig` `rankSub` `rankDots` `rankHistory`, `btnRankStart` `btnRankReset`
＋ `data-rankgames="3"/"5"/"7"` の `seg-btn`

**棋譜・解析（panel-kifu）**
`analyzeProg`（進捗バーの中身）, `analyzeOut`（**解析結果と形勢グラフの描画先**）,
`btnAnalyze` `btnAnalyzeStop` `btnSaveKifu` `btnExportKif` `btnImportKif` `btnCopySfen`, `kifuList`
＋ `data-adepth="250"/"700"/"1800"` の `seg-btn`

### エンジン情報・棋譜・操作

| id | 役割 |
|---|---|
| `engState` `engDepth` `engNodes` `engScore` `engPv` | 思考状況（対局中は折りたたんでよい） |
| `moveList` | 棋譜の一覧。JavaScriptが中身を作る |
| `kifuCount` | 「◯手」の表示 |
| `btnFirst` `btnPrev` `btnNext` `btnLast` | 棋譜の移動 |
| `btnUndo` `btnHint` `btnFlip` `btnJishogi` `btnDeclare` `btnResign` `btnNew` | 操作ボタン |

### 設定（seg-btn 形式）

いずれも `<div class="seg-btn" data-XXX="値">ラベル</div>` の形。
同じ `data-XXX` を持つものを横並びにし、選択中のものに `on` クラスが付きます。

- `data-evalshow="1"/"0"` … 形勢の表示／かくす
- `data-foul="1"/"0"` … 二歩を反則負けにする／指せなくする
- `data-maxmoves="256"/"320"/"500"` … 手数上限
- `data-tc="0"/"600"/"1500"/"900:30"` … 持ち時間（なし／10分／25分／15分+秒読み30秒）

### ダイアログ（3種類とも必要）

| id | 役割 |
|---|---|
| `promoOverlay` `promoChoices` `promoCancel` | 成り／不成の選択 |
| `msgOverlay` `msgTitle` `msgBody` `msgActions` | お知らせ・確認 |
| `textOverlay` `textTitle` `textDesc` `textArea` `textActions` | 棋譜の書き出し／読み込み |

表示するとき JavaScript が `class="overlay on"` を付けます。
CSSで `.overlay { display:none }` `.overlay.on { display:flex }` にしてください。

### 上部バッジ

`engineBadge` `offlineBadge` `myRankBadge`（`class="badge"`。緑にするとき `on` が付く）

### その他

`toast`（画面下に一時表示するメッセージ。`on` クラスで表示）

---

## 6. JavaScript が付けるクラス名（CSSを当ててください）

| クラス | 意味 |
|---|---|
| `.cell` | 盤のマス（81個） |
| `.cell.sel` | 選択中のマス |
| `.cell.dest` | 動かせる場所（丸い印） |
| `.cell.dest.occupied` | 駒が取れる場所（枠で囲む） |
| `.cell.last` | 直前に動いたマス |
| `.cell.check` | 王手されている玉のマス |
| `.piece` | 駒 |
| `.piece.upside` | 180度回転して表示する駒（相手の駒） |
| `.piece.gote` / `.piece.sente` | 後手の駒／先手の駒 |
| `.piece.promo` | 成駒（赤字） |
| `.hand-piece` | 持駒の駒。`data-side` と `data-pt` を持つ |
| `.hand-piece.sel` | 選択中の持駒 |
| `.hand-piece .cnt` | 持駒の枚数 |
| `.player-bar.active` | 手番側の帯 |
| `.mv` / `.mv.cur` | 棋譜の1行／現在表示中の行 |
| `.tag.good` `.tag.dubious` `.tag.mistake` `.tag.blunder` | 最善／疑問手／悪手／大悪手 |
| `.panel.on` | 表示中のパネル |
| `.seg-btn.on` | 選択中の設定ボタン |
| `.notice` `.hint` | 注意書き／補足文 |

---

## 7. 技術的な制約

- **HTML と CSS のみ**。JavaScript は書かない（既存のものを読み込むだけ）
- 外部の CSS/JS/フォント/画像を読み込まない（**オフラインで動かすため**）
- `<head>` の以下はそのまま残す：
  - `<link rel="manifest" href="manifest.webmanifest">`
  - `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">`
  - `<meta name="apple-mobile-web-app-capable" content="yes">`
  - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- `<body>` 末尾のスクリプト読み込みは**順番を変えない**：
  ```html
  <script src="js/book.js"></script>
  <script src="js/shogi.js"></script>
  <script src="js/engine.js"></script>
  <script src="js/kifu.js"></script>
  <script src="js/ui.js"></script>
  <script src="js/app.js"></script>
  ```
- iPhoneのノッチ対応：`env(safe-area-inset-*)` を使う
- タップの遅延防止：操作要素に `touch-action: manipulation`
- 明るい画面・暗い画面の両方に対応（`prefers-color-scheme`）

---

## 8. 見た目の希望

- **落ち着いた和風**。盤は木の色、駒は木札の色
- 派手な装飾より**判読性優先**。文字は大きめ
- 暗い背景でも明るい背景でも成立すること
- 動きは控えめに（駒の移動が分かる程度）

---

## 9. 完成後の確認方法

1. `index.html` と `css/style.css` を差し替える
2. ブラウザで開き、次を確認する
   - 盤に駒が並ぶ／自分の駒が正立している
   - 「対CP戦」→「この設定で対局開始」で対局が始まる
   - 駒をタップ → 緑の印が出る → 動かせる
   - 6つのタブがすべて切り替わる
   - 「投了」「待った」がスクロールなしで押せる
   - 持ち時間を設定すると、両者の時計が表示され手番側だけ減る
   - 「棋譜・解析」→「この棋譜を解析」で形勢グラフが出る
3. ブラウザの開発者ツールでエラーが出ていないこと
   （`Cannot read properties of null` が出たら、idが欠けています）
