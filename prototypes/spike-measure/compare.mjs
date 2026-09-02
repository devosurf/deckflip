// PROTOTYPE (wayfinder #8). Compare ink rows per shape between out/chromium.png and out/powerpoint.png.
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFileSync, writeFileSync } from 'node:fs';

const a = PNG.sync.read(readFileSync('out/chromium.png'));
const b = PNG.sync.read(readFileSync('out/powerpoint.png'));
const shapes = JSON.parse(readFileSync('out/measurements.json', 'utf8'));

const diff = new PNG({ width: a.width, height: a.height });
const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.2 });
writeFileSync('out/diff.png', PNG.sync.write(diff));
console.log(`pixels differing: ${n} (${((100 * n) / (a.width * a.height)).toFixed(2)}%)`);

// ink rows: rows inside the box whose pixels deviate from the box fill (or white)
const inkLines = (img, s) => {
  const bg = s.fill ? [parseInt(s.fill.slice(0, 2), 16), parseInt(s.fill.slice(2, 4), 16), parseInt(s.fill.slice(4, 6), 16)] : [255, 255, 255];
  const rows = [];
  for (let y = Math.round(s.box.y); y < Math.round(s.box.y + s.box.h); y++) {
    let ink = 0, minX = Infinity, maxX = -1;
    for (let x = Math.round(s.box.x); x < Math.round(s.box.x + s.box.w); x++) {
      const i = (y * img.width + x) * 4;
      const d = Math.abs(img.data[i] - bg[0]) + Math.abs(img.data[i + 1] - bg[1]) + Math.abs(img.data[i + 2] - bg[2]);
      if (d > 60) { ink++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    rows.push({ y, ink, minX, maxX });
  }
  const lines = [];
  let cur = null;
  for (const r of rows) {
    if (r.ink) { if (!cur) cur = { top: r.y, bottom: r.y, minX: r.minX, maxX: r.maxX }; else { cur.bottom = r.y; cur.minX = Math.min(cur.minX, r.minX); cur.maxX = Math.max(cur.maxX, r.maxX); } }
    else if (cur && r.y - cur.bottom > 3) { lines.push(cur); cur = null; }  // >3px gap of no ink = line break (descender gaps are smaller)
  }
  if (cur) lines.push(cur);
  return lines;
};

for (const s of shapes) {
  if (!s.text) continue;
  const la = inkLines(a, s), lb = inkLines(b, s);
  console.log(`\n${s.id}  font ${s.font.sizePx}px  line-height ${s.lineHeight.declared} (=${s.lineHeight.computedPx}px)  chromium lines=${la.length} powerpoint lines=${lb.length}`);
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    const x = la[i], y = lb[i];
    const f = (l) => (l ? `top ${l.top} bot ${l.bottom} x ${l.minX}-${l.maxX}` : '-');
    const dy = x && y ? `  dTop ${y.top - x.top} dBot ${y.bottom - x.bottom} dL ${y.minX - x.minX} dR ${y.maxX - x.maxX}` : '';
    console.log(`  line ${i + 1}: chromium [${f(x)}]  powerpoint [${f(y)}]${dy}`);
  }
  if (la.length > 1 && lb.length > 1) console.log(`  pitch: chromium ${la[1].top - la[0].top}px  powerpoint ${lb[1].top - lb[0].top}px`);
}
