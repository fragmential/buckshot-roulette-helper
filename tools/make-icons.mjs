// Renders the home-screen icons (iOS needs PNG) with headless Chromium.
// Usage: node tools/make-icons.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const html = `<canvas id=c width=64 height=64></canvas><script>
const c = document.getElementById('c'), g = c.getContext('2d');
g.fillStyle = '#070606'; g.fillRect(0, 0, 64, 64);
const lamp = g.createRadialGradient(32, 26, 2, 32, 30, 44);
lamp.addColorStop(0, 'rgba(170,32,24,0.55)'); lamp.addColorStop(1, 'rgba(170,32,24,0)');
g.fillStyle = lamp; g.fillRect(0, 0, 64, 64);
function shell(x, y, hull, hi, lo) {
  const w = 12, h = 36, bh = 10, hh = h - bh;
  g.fillStyle = hull; g.fillRect(x, y, w, hh);
  g.fillStyle = hi; g.fillRect(x + 2, y + 3, 3, hh - 5);
  g.fillStyle = lo; g.fillRect(x + w - 3, y, 3, hh); g.fillRect(x, y, w, 3); g.fillRect(x, y + hh - 1, w, 1);
  g.fillStyle = '#a9843c'; g.fillRect(x, y + hh, w, bh);
  g.fillStyle = '#e6c774'; g.fillRect(x + 2, y + hh + 2, 3, bh - 5);
  g.fillStyle = '#56411c'; g.fillRect(x + w - 3, y + hh, 3, bh);
  g.fillStyle = '#a9843c'; g.fillRect(x - 1, y + h - 3, w + 2, 3);
  g.fillStyle = '#56411c'; g.fillRect(x - 1, y + h - 1, w + 2, 1);
}
shell(17, 14, '#3f5869', '#7d98a8', '#1c2a34');
shell(35, 14, '#9e1519', '#dc3d3f', '#4f080b');
const B = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const img = g.getImageData(0, 0, 64, 64), d = img.data, step = 255 / 7;
for (let p = 0; p < 64 * 64; p++) {
  const x = p % 64, y = (p / 64) | 0, b = (B[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * step;
  const dx = x / 32 - 1, dy = y / 32 - 1, v = Math.max(0.3, 1 - 0.5 * (dx * dx + dy * dy));
  for (let k = 0; k < 3; k++) d[p * 4 + k] = Math.max(0, Math.min(255, Math.round((d[p * 4 + k] * v + b) / step) * step));
}
g.putImageData(img, 0, 0);
</script>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
for (const size of [180, 192, 512]) {
  const data = await page.evaluate((s) => {
    const out = document.createElement('canvas'); out.width = out.height = s;
    const x = out.getContext('2d'); x.imageSmoothingEnabled = false;
    x.drawImage(document.getElementById('c'), 0, 0, s, s);
    return out.toDataURL('image/png').split(',')[1];
  }, size);
  writeFileSync(new URL(`../web/icons/icon-${size}.png`, import.meta.url), Buffer.from(data, 'base64'));
}
await browser.close();
