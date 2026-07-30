/* ==========================================================================
 * make-icons.js — アプリのアイコン（PNG）を生成する
 *   外部ライブラリを使わず、Node標準の zlib だけで PNG を書き出す。
 *   実行: node tools/make-icons.js
 * ========================================================================== */
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var OUT = path.join(__dirname, '..', 'icons');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

/* ---- PNG 書き出し ---- */
var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function writePng(file, w, h, rgba) {
  var raw = Buffer.alloc((w * 4 + 1) * h);
  for (var y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;                       // フィルタなし
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;  // 8bit RGBA
  var png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

/* ---- 描画（駒の五角形＋「王」） ---- */
function makeIcon(size, opt) {
  opt = opt || {};
  var buf = Buffer.alloc(size * size * 4);
  var bg = opt.bg || [27, 31, 40];
  var wood = [236, 211, 154];
  var woodDark = [214, 184, 122];
  var ink = [43, 28, 8];

  function px(x, y, c, a) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    var i = (y * size + x) * 4;
    var al = a === undefined ? 1 : a;
    buf[i] = Math.round(buf[i] * (1 - al) + c[0] * al);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - al) + c[1] * al);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - al) + c[2] * al);
    buf[i + 3] = 255;
  }
  // 背景
  for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) px(x, y, bg, 1);

  // 駒の五角形（上が尖った将棋の駒の形）
  var cx = size / 2;
  var top = size * 0.13, bottom = size * 0.90;
  var halfTop = size * 0.075, halfBottom = size * 0.345;
  var shoulder = size * 0.27;   // 肩の高さ
  function komaHalfWidth(y) {
    if (y < top || y > bottom) return -1;
    if (y < shoulder) {
      var t = (y - top) / (shoulder - top);
      return halfTop + (size * 0.30 - halfTop) * t;
    }
    var t2 = (y - shoulder) / (bottom - shoulder);
    return size * 0.30 + (halfBottom - size * 0.30) * t2;
  }
  for (y = 0; y < size; y++) {
    var hw = komaHalfWidth(y);
    if (hw < 0) continue;
    for (x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
      var d = Math.abs(x - cx) - hw;
      var a = d <= -1 ? 1 : (d >= 0 ? 0 : -d);          // 端をなめらかに
      if (a <= 0) continue;
      var shade = (y - top) / (bottom - top);
      var col = [
        Math.round(wood[0] + (woodDark[0] - wood[0]) * shade),
        Math.round(wood[1] + (woodDark[1] - wood[1]) * shade),
        Math.round(wood[2] + (woodDark[2] - wood[2]) * shade)
      ];
      px(x, y, col, a);
    }
  }

  // 「王」の字（横3本＋縦1本）
  var gx = cx, gyTop = size * 0.34, gyBot = size * 0.78;
  var gh = gyBot - gyTop;
  var th = Math.max(2, Math.round(size * 0.044));       // 線の太さ
  function bar(yc, halfW) {
    var y0 = Math.round(yc - th / 2), y1 = Math.round(yc + th / 2);
    for (var yy = y0; yy <= y1; yy++)
      for (var xx = Math.round(gx - halfW); xx <= Math.round(gx + halfW); xx++) px(xx, yy, ink, 1);
  }
  bar(gyTop, size * 0.120);                 // 上の横棒
  bar(gyTop + gh * 0.47, size * 0.072);     // 中の横棒
  bar(gyBot, size * 0.178);                 // 下の横棒（いちばん長い）
  for (var yy2 = Math.round(gyTop); yy2 <= Math.round(gyBot); yy2++)
    for (var xx2 = Math.round(gx - th * 0.42); xx2 <= Math.round(gx + th * 0.42); xx2++) px(xx2, yy2, ink, 1);

  return buf;
}

[
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-maskable-512.png', size: 512, bg: [20, 22, 28] }
].forEach(function (o) {
  writePng(path.join(OUT, o.name), o.size, o.size, makeIcon(o.size, { bg: o.bg }));
  console.log('作成: icons/' + o.name + ' (' + o.size + 'x' + o.size + ')');
});
console.log('完了');
