/* ==========================================================================
 * make-textures.js — 盤と駒のテクスチャ（PNG）を生成する
 *   外部ライブラリを使わず Node標準の zlib だけで書き出す。
 *   実行: node tools/make-textures.js
 *   出力: img/board.png  img/koma.png  img/koma-gote.png
 * ========================================================================== */
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var OUT = path.join(__dirname, '..', 'img');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

/* ---------------- PNG 書き出し ---------------- */
var CRC = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function writePng(file, w, h, rgba) {
  var raw = Buffer.alloc((w * 4 + 1) * h);
  for (var y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]));
}

/* ---------------- 決まった乱数（毎回同じ木目にする） ---------------- */
function hash(n) { n = (n << 13) ^ n; return 1 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824; }
function noise1(x) {                      // なめらかな1次元ノイズ
  var i = Math.floor(x), f = x - i;
  var a = hash(i), b = hash(i + 1);
  var t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}
function fbm(x, oct) {                    // 重ねて自然なゆらぎに
  var v = 0, amp = .5, fr = 1;
  for (var i = 0; i < (oct || 4); i++) { v += noise1(x * fr) * amp; amp *= .5; fr *= 2.07; }
  return v;
}

/* ---------------- 盤（榧の柾目を想定） ----------------
 * 縦方向にまっすぐ走る木目。等間隔にせず、太さと濃さを揺らす。
 */
function makeBoard(W, H) {
  var buf = Buffer.alloc(W * H * 4);
  var base = [214, 172, 116];             // 明るめの榧色
  var deep = [186, 141, 88];
  for (var y = 0; y < H; y++) {
    for (var x = 0; x < W; x++) {
      // 木目の位置（縦線）。ゆっくり蛇行させる
      var wob = fbm(y * 0.012 + 40, 3) * 6;
      var g = (x + wob) * 0.16;
      // 年輪の密度をゆらす
      var ring = Math.abs(Math.sin(g * Math.PI + fbm(g * 0.35, 4) * 5.0));
      var line = Math.pow(ring, 9) * 0.55;                 // 細い線に絞る
      var broad = (fbm(x * 0.006 + 11, 4) - 0.5) * 0.30;    // 大きなむら
      var fine = (fbm(x * 0.9 + y * 0.004 + 77, 2) - 0.5) * 0.05;
      var t = Math.max(0, Math.min(1, line + broad + fine + 0.12));
      var i = (y * W + x) * 4;
      buf[i] = Math.round(base[0] + (deep[0] - base[0]) * t);
      buf[i + 1] = Math.round(base[1] + (deep[1] - base[1]) * t);
      buf[i + 2] = Math.round(base[2] + (deep[2] - base[2]) * t);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

/* ---------------- 駒（黄楊の木地） ----------------
 * 実物の比率に近い五角形：肩が狭く、縦に長い。
 * 面には薄い木目、上端に光、下端に影を入れて厚みを出す。
 */
function makeKoma(W, H, gote, red) {
  var buf = Buffer.alloc(W * H * 4);
  var top = H * 0.030, bottom = H * 0.972;
  var halfTop = W * 0.088;                 // 頭の幅（実物は狭い）
  var shoulder = H * 0.205;                // 肩の高さ
  var halfSh = W * 0.352;
  var halfBottom = W * 0.468;

  var light = gote ? [238, 226, 203] : [246, 228, 190];
  var dark = gote ? [211, 196, 170] : [223, 196, 148];
  var edge = gote ? [150, 134, 110] : [156, 124, 78];
  if (red) {                                  // 特殊駒は赤木地にして一目で分かるようにする
    light = gote ? [239, 199, 191] : [248, 205, 190];
    dark = gote ? [206, 152, 142] : [216, 156, 132];
    edge = gote ? [140, 78, 68] : [150, 74, 58];
  }

  function halfW(y) {
    if (y < top || y > bottom) return -1;
    if (y < shoulder) {
      var t = (y - top) / (shoulder - top);
      return halfTop + (halfSh - halfTop) * t;   // 肩は直線
    }
    var t2 = (y - shoulder) / (bottom - shoulder);
    return halfSh + (halfBottom - halfSh) * t2;
  }

  var cx = W / 2;
  for (var y = 0; y < H; y++) {
    var hw = halfW(y);
    if (hw < 0) continue;
    var vy = (y - top) / (bottom - top);
    for (var x = 0; x < W; x++) {
      var d = Math.abs(x - cx) - hw;
      var a = d <= -1.2 ? 1 : (d >= 0.2 ? 0 : (0.2 - d) / 1.4);
      if (a <= 0) continue;
      // 木地の色（上を明るく、下をわずかに沈ませる）
      var shade = 0.06 + vy * 0.42;
      // 縦の細い木目
      var grain = Math.pow(Math.abs(Math.sin(x * 0.30 + fbm(x * 0.045 + 5, 3) * 4)), 16) * 0.11;
      var mottle = (fbm(x * 0.018 + y * 0.003 + 3, 3) - 0.5) * 0.10;
      var t = Math.max(0, Math.min(1, shade + grain + mottle));
      var r = light[0] + (dark[0] - light[0]) * t;
      var g2 = light[1] + (dark[1] - light[1]) * t;
      var b = light[2] + (dark[2] - light[2]) * t;
      // 縁のしまり（外周を少し濃く）
      var em = Math.max(0, 1 - (-d) / (W * 0.055));
      if (em > 0) { r += (edge[0] - r) * em * 0.75; g2 += (edge[1] - g2) * em * 0.75; b += (edge[2] - b) * em * 0.75; }
      // 上端の光、下端の影（厚みの表現）
      if (vy < 0.10) { var k = (0.10 - vy) / 0.10 * 0.30; r += (255 - r) * k; g2 += (255 - g2) * k; b += (255 - b) * k; }
      if (vy > 0.90) { var k2 = (vy - 0.90) / 0.10 * 0.22; r *= (1 - k2); g2 *= (1 - k2); b *= (1 - k2); }
      var i = (y * W + x) * 4;
      buf[i] = Math.round(Math.max(0, Math.min(255, r)));
      buf[i + 1] = Math.round(Math.max(0, Math.min(255, g2)));
      buf[i + 2] = Math.round(Math.max(0, Math.min(255, b)));
      buf[i + 3] = Math.round(255 * a);
    }
  }
  return buf;
}

writePng(path.join(OUT, 'board.png'), 512, 512, makeBoard(512, 512));
writePng(path.join(OUT, 'koma.png'), 132, 146, makeKoma(132, 146, false));
writePng(path.join(OUT, 'koma-gote.png'), 132, 146, makeKoma(132, 146, true));
writePng(path.join(OUT, 'koma-sp.png'), 132, 146, makeKoma(132, 146, false, true));
writePng(path.join(OUT, 'koma-sp-gote.png'), 132, 146, makeKoma(132, 146, true, true));
['board.png', 'koma.png', 'koma-gote.png', 'koma-sp.png', 'koma-sp-gote.png'].forEach(function (f) {
  console.log('作成: img/' + f + '  ' + fs.statSync(path.join(OUT, f)).size.toLocaleString() + ' バイト');
});
