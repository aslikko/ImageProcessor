// Smoke test: node tests/smoke.mjs (needs playwright + a static server on :8123)
// Generates sample logos, runs them through the app and checks DPI metadata of downloads.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT_DIR || '/tmp/logo-smoke';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:8123/');

// generate fixtures in the browser
const fixtures = await page.evaluate(async () => {
  const mk = async (w, h, draw, type = 'image/png', q) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); draw(x, w, h);
    const b = await new Promise((r) => c.toBlob(r, type, q));
    const buf = new Uint8Array(await b.arrayBuffer());
    let s = ''; for (const v of buf) s += String.fromCharCode(v);
    return btoa(s);
  };
  return {
    smallJpg: await mk(120, 40, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#c92a2a'; x.font = 'bold 26px sans-serif'; x.fillText('ACME', 20, 30); }, 'image/jpeg', 0.6),
    bigPng: await mk(1600, 700, (x) => { x.fillStyle = '#1864ab'; x.font = 'bold 300px sans-serif'; x.fillText('Brand', 200, 480); }),
    tile: await mk(300, 300, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#2b8a3e'; x.beginPath(); x.roundRect(20, 20, 260, 260, 50); x.fill(); x.fillStyle = '#fff'; x.font = 'bold 120px sans-serif'; x.fillText('G', 110, 190); }),
  };
});
for (const [k, v] of Object.entries(fixtures)) fs.writeFileSync(path.join(OUT, k + (k.endsWith('Jpg') ? '.jpg' : '.png')), Buffer.from(v, 'base64'));
fs.writeFileSync(path.join(OUT, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 50"><rect x="0" y="0" width="200" height="50" fill="none"/><text x="10" y="40" font-size="40" font-family="sans-serif" fill="#5f3dc4">Vektor</text></svg>');

async function run(file, label, tweak) {
  await page.setInputFiles('#fileInput', path.join(OUT, file));
  await page.waitForSelector('.card');
  if (tweak) await tweak();
  await page.waitForTimeout(400);
  const cards = await page.$$eval('.card', (cs) => cs.map((c) => ({
    title: c.querySelector('h3').textContent,
    status: c.querySelector('.badge').textContent,
    meta: c.querySelector('.meta').textContent,
    findings: [...c.querySelectorAll('.findings li')].map((l) => `[${l.className}] ${l.textContent}`),
  })));
  console.log(`\n=== ${label} ===`);
  console.log(await page.$eval('#sourceInfo', (e) => e.innerText.replace(/\n/g, ' | ')));
  for (const c of cards) console.log(`${c.title} – ${c.status} – ${c.meta}\n   ${c.findings.join('\n   ')}`);
  await page.screenshot({ path: path.join(OUT, `shot-${label}.png`), fullPage: true });
}

await run('smallJpg.jpg', 'small-jpg');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadAll')]);
await dl.saveAs(path.join(OUT, 'all.zip'));
const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('.card .card-foot button')]);
await dl1.saveAs(path.join(OUT, dl1.suggestedFilename()));
const jpg = fs.readFileSync(path.join(OUT, dl1.suggestedFilename()));
console.log('\nJPG file:', dl1.suggestedFilename(), 'JFIF units/dpi:', jpg[13], jpg.readUInt16BE(14), jpg.readUInt16BE(16));

await run('bigPng.png', 'transparent-png');
await run('tile.png', 'rounded-tile');
await page.click('.findings .btn.fix');
await run('tile.png', 'rounded-tile-fixed', async () => {
  await page.click('.findings .btn.fix').catch(() => {});
});
await run('vector.svg', 'svg');
await page.click('.seg label:has(input[value="png"])');
await page.waitForTimeout(300);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('.card .card-foot button')]);
await dl2.saveAs(path.join(OUT, dl2.suggestedFilename()));
const png = fs.readFileSync(path.join(OUT, dl2.suggestedFilename()));
const i = png.indexOf('pHYs');
console.log('PNG file:', dl2.suggestedFilename(), 'size', png.readUInt32BE(16), 'x', png.readUInt32BE(20), 'pHYs ppm', png.readUInt32BE(i + 4), '=> dpi', Math.round(png.readUInt32BE(i + 4) * 0.0254));

console.log('\nErrors:', errors.length ? errors : 'none');
await browser.close();
