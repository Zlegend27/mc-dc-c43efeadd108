// node scripts/make-icons.mjs
// Builds the Home Screen / install icons from assets/sunburst-icon.png (transparent mark) on the
// brand cream. Pure Node, no dependencies. Output is a valid, checksummed PNG.
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BG = [0xf2, 0xef, 0xe5];

function decodePng(buf) {
  let p = 8, w, h, ct, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[12] !== 0) throw new Error('need 8-bit, non-interlaced'); ct = d[9]; }
    if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const ch = { 2: 3, 6: 4 }[ct]; if (!ch) throw new Error('need RGB or RGBA');
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[o++];
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[y * stride + x - ch] : 0, up = y ? px[(y - 1) * stride + x] : 0, ul = (y && x >= ch) ? px[(y - 1) * stride + x - ch] : 0;
      let v = raw[o++];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pa = Math.abs(up - ul), pb = Math.abs(a - ul), pc = Math.abs(a + up - 2 * ul); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? up : ul); }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = px[i * ch]; rgba[i * 4 + 1] = px[i * ch + 1]; rgba[i * 4 + 2] = px[i * ch + 2]; rgba[i * 4 + 3] = ch === 4 ? px[i * ch + 3] : 255;
  }
  return { w, h, rgba };
}
function encodePng(w, h, rgb) {
  const stride = w * 3, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
    b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function render(src, size, fill) {
  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { out[i * 3] = BG[0]; out[i * 3 + 1] = BG[1]; out[i * 3 + 2] = BG[2]; }
  const target = Math.round(size * fill), scale = target / Math.max(src.w, src.h);
  const dw = Math.round(src.w * scale), dh = Math.round(src.h * scale), ox = Math.round((size - dw) / 2), oy = Math.round((size - dh) / 2);
  const at = (x, y, c) => src.rgba[(Math.min(src.h - 1, Math.max(0, y)) * src.w + Math.min(src.w - 1, Math.max(0, x))) * 4 + c];
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    // bilinear sample (premultiplied by alpha so soft edges stay clean)
    const sx = (x + 0.5) / scale - 0.5, sy = (y + 0.5) / scale - 0.5, x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]].forEach(([dx, dy, wgt]) => {
      const al = at(x0 + dx, y0 + dy, 3) / 255;
      r += at(x0 + dx, y0 + dy, 0) * al * wgt; g += at(x0 + dx, y0 + dy, 1) * al * wgt; b += at(x0 + dx, y0 + dy, 2) * al * wgt; a += al * wgt;
    });
    const i = ((oy + y) * size + (ox + x)) * 3;
    out[i] = Math.round(r + BG[0] * (1 - a)); out[i + 1] = Math.round(g + BG[1] * (1 - a)); out[i + 2] = Math.round(b + BG[2] * (1 - a));
  }
  return encodePng(size, size, out);
}

const src = decodePng(fs.readFileSync(path.join(root, 'assets', 'sunburst-icon.png')));
const jobs = [['apple-touch-icon.png', 180, 0.62], ['icon-192.png', 192, 0.62], ['icon-512.png', 512, 0.62], ['icon-maskable-512.png', 512, 0.46]];
jobs.forEach(([name, size, fill]) => {
  const png = render(src, size, fill);
  fs.writeFileSync(path.join(root, 'assets', name), png);
  // self-check: it must decode again
  const back = decodePng(png);
  console.log(name, size + 'x' + size, png.length + ' bytes, decodes back OK (' + back.w + 'x' + back.h + ')');
});
