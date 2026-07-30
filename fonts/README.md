# 駒の書体について

将棋の駒に使っている書体です。いずれも **SIL Open Font License 1.1** の
オープンライセンスフォントを、駒に使う16文字
（歩香桂銀金角飛玉王と杏圭全馬竜龍）だけに絞り込んだものです。

| ファイル | 元のフォント | 作者 | 字形 |
|---|---|---|---|
| `koma-kaisho-r.woff2` | Klee One Regular | Fontworks Inc. | 楷書寄りの教科書体（既定・細身） |
| `koma-kaisho.woff2` | Klee One SemiBold | Fontworks Inc. | 同上（太め） |
| `koma-brush.woff2` | Yuji Syuku | Kanji Yuji | 毛筆（楷書） |

ライセンス全文は `OFL-KleeOne.txt` / `OFL-YujiSyuku.txt` を参照してください。
絞り込みは `fontTools` の subset で行っています（元の字形は変更していません）。

作り直す場合：

```bash
python3 -m fontTools.subset KleeOne-SemiBold.ttf \
  --text="歩香桂銀金角飛玉王と杏圭全馬竜龍" --flavor=woff2 --output-file=koma-kaisho.woff2
```
