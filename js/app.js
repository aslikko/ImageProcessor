import {
  loadImageFile, getPixels, detectBackground, removeBackground, contentBounds, crop,
  renderFrame, toHex, hexToRgb,
} from './imaging.js';
import { analyzeLogo, evaluateSize } from './analysis.js';
import { encodeCanvas, makeZip } from './encode.js';

const PRESET_SIZES = [
  { width: 600, height: 378 },
  { width: 200, height: 126 },
  { width: 124, height: 124 },
  { width: 75, height: 75 },
];

const $ = (id) => document.getElementById(id);

const state = {
  source: null,        // { canvas, isVector, originalWidth, originalHeight }
  fileType: '',
  fileName: '',
  bg: null,
  sizes: PRESET_SIZES.map((s) => ({ ...s, enabled: true, preset: true })),
  results: [],
  removedCache: null,  // { key, canvas }
};

const STATUS_LABEL = { ok: 'OK', info: 'OK (notes)', warn: 'Check', error: 'Problem' };

// ---------- options ----------

function options() {
  const format = document.querySelector('input[name="format"]:checked').value;
  return {
    format,
    dpi: Math.min(1200, Math.max(1, parseInt($('dpi').value, 10) || 72)),
    quality: parseInt($('quality').value, 10) / 100,
    padding: parseInt($('padding').value, 10) / 100,
    frameMode: $('frameMode').value,
    customColor: $('customColor').value,
    sharpen: $('sharpen').checked,
    removeBg: $('removeBg').checked,
    tolerance: parseInt($('tolerance').value, 10),
    globalRemove: $('globalRemove').checked,
  };
}

// Resolves the frame (background) colour; null means transparent.
function resolveFrameColor(opts, bg) {
  const white = { r: 255, g: 255, b: 255 };
  switch (opts.frameMode) {
    case 'white': return white;
    case 'custom': return hexToRgb(opts.customColor);
    case 'transparent': return opts.format === 'png' ? null : white;
    default:
      if (!opts.removeBg && bg.type === 'solid') return bg.color;
      return opts.format === 'png' ? null : white;
  }
}

// ---------- UI rendering ----------

function renderSizeList() {
  const list = $('sizeList');
  list.innerHTML = '';
  state.sizes.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'size-item';
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.enabled;
    cb.addEventListener('change', () => { s.enabled = cb.checked; schedule(); });
    label.append(cb, document.createTextNode(`${s.width} × ${s.height} px`));
    row.append(label);
    if (!s.preset) {
      const rm = document.createElement('button');
      rm.className = 'remove';
      rm.type = 'button';
      rm.title = 'Remove';
      rm.textContent = '×';
      rm.addEventListener('click', () => { state.sizes.splice(i, 1); renderSizeList(); schedule(); });
      row.append(rm);
    }
    list.append(row);
  });
}

function renderSourceInfo() {
  const el = $('sourceInfo');
  const s = state.source;
  if (!s) { el.hidden = true; return; }
  const bg = state.bg;
  const bgText = bg.type === 'transparent' ? 'transparent'
    : bg.type === 'solid' ? `solid ${toHex(bg.color)}` : 'mixed (not solid)';
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  const img = document.createElement('img');
  img.src = s.canvas.toDataURL();
  img.alt = '';
  thumb.append(img);
  const txt = document.createElement('div');
  txt.innerHTML = `<div><b></b></div><div></div><div></div>`;
  txt.children[0].firstChild.textContent = state.fileName;
  txt.children[1].textContent = s.isVector
    ? `Vector (SVG) · ${s.originalWidth}×${s.originalHeight}`
    : `${s.originalWidth}×${s.originalHeight}px · ${(state.fileType.split('/')[1] || '').toUpperCase()}`;
  txt.children[2].textContent = `Background: ${bgText}`;
  el.replaceChildren(thumb, txt);
  el.hidden = false;
}

function updateControls(opts) {
  $('qualityVal').textContent = Math.round(opts.quality * 100);
  $('qualityField').style.visibility = opts.format === 'jpg' ? 'visible' : 'hidden';
  $('paddingVal').textContent = `${Math.round(opts.padding * 100)}%`;
  $('toleranceVal').textContent = opts.tolerance;
  $('customColor').hidden = opts.frameMode !== 'custom';
  $('bgOptions').hidden = !opts.removeBg;
  const hint = $('bgHint');
  if (state.bg) {
    hint.textContent = state.bg.type === 'transparent'
      ? 'Source is already transparent; no background to remove.'
      : state.bg.type === 'solid'
        ? `Removes ${toHex(state.bg.color)} starting from the edges. Increase tolerance if traces remain; decrease it if parts of the logo disappear.`
        : 'Background is not a solid colour; the dominant edge colour is removed, results may be imperfect.';
  }
}

function makeCard(res, opts) {
  const { size, render, evalr } = res;
  const card = document.createElement('article');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head"><h3></h3><span class="badge"></span></div>
    <div class="preview"></div>
    <div class="meta"></div>
    <ul class="findings"></ul>
    <div class="card-foot"><span class="size"></span><button type="button" class="btn small">Download</button></div>`;
  card.querySelector('h3').textContent = `${size.width} × ${size.height}`;
  const badge = card.querySelector('.badge');
  badge.classList.add(evalr.status);
  badge.textContent = STATUS_LABEL[evalr.status];

  const canvas = render.canvas;
  const zoom = $('zoom').checked ? 2 : 1;
  canvas.style.width = `${size.width * zoom}px`;
  card.querySelector('.preview').append(canvas);
  card.querySelector('.meta').textContent =
    `Logo area: ${render.logoWidth}×${render.logoHeight}px · scale ${evalr.scale.toFixed(2)}× · fill ${Math.round(evalr.fill * 100)}%`;

  const ul = card.querySelector('.findings');
  for (const it of evalr.items) {
    const li = document.createElement('li');
    li.className = it.level;
    const span = document.createElement('span');
    span.textContent = it.text;
    if (it.fix) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn fix';
      b.textContent = it.fix.label;
      b.addEventListener('click', () => applyFix(it.fix));
      span.append(b);
    }
    li.append(span);
    ul.append(li);
  }

  const btn = card.querySelector('.card-foot button');
  const sizeLabel = card.querySelector('.size');
  sizeLabel.textContent = `${opts.format.toUpperCase()} · ${opts.dpi} dpi`;
  btn.addEventListener('click', async () => {
    const blob = await encodeCanvas(canvas, opts);
    download(blob, fileNameFor(size, opts));
  });
  return card;
}

function renderSummary() {
  const counts = { ok: 0, info: 0, warn: 0, error: 0 };
  for (const r of state.results) counts[r.evalr.status]++;
  const el = $('summary');
  el.innerHTML = '';
  for (const k of ['ok', 'info', 'warn', 'error']) {
    if (!counts[k]) continue;
    const b = document.createElement('span');
    b.className = `badge ${k}`;
    b.textContent = `${counts[k]} ${STATUS_LABEL[k].toLowerCase()}`;
    el.append(b);
  }
}

// ---------- processing ----------

function workingCanvas(opts) {
  const { source, bg } = state;
  if (!opts.removeBg || bg.type === 'transparent' || !bg.color) return source.canvas;
  const key = `${opts.tolerance}|${opts.globalRemove}`;
  if (state.removedCache?.key !== key) {
    state.removedCache = {
      key,
      canvas: removeBackground(source.canvas, bg.color, { tolerance: opts.tolerance, global: opts.globalRemove }),
    };
  }
  return state.removedCache.canvas;
}

function withMargin(box, w, h, m = 1) {
  const x = Math.max(0, box.x - m), y = Math.max(0, box.y - m);
  return { x, y, w: Math.min(w, box.x + box.w + m) - x, h: Math.min(h, box.y + box.h + m) - y };
}

function process() {
  if (!state.source) return;
  const opts = options();
  updateControls(opts);

  const { source, bg } = state;
  const working = workingCanvas(opts);
  const removed = working !== source.canvas;
  const trimBg = removed ? { type: 'transparent' } : bg;

  const tol = Math.max(18, opts.tolerance);
  const box = contentBounds(getPixels(working), trimBg, tol);
  if (box.empty) {
    toast('No logo found in the image (empty or entirely background colour). Try lowering the tolerance.', true);
    return;
  }
  const logo = crop(working, withMargin(box, working.width, working.height));
  const srcBox = removed ? contentBounds(getPixels(source.canvas), bg, tol) : box;
  const trimmedSource = crop(source.canvas, srcBox);

  const analysis = analyzeLogo({
    logo, source: source.canvas, trimmedSource, bg, isVector: source.isVector, sourceType: state.fileType,
  });

  const frameColor = resolveFrameColor(opts, bg);
  const background = frameColor ? toHex(frameColor) : null;

  state.results = state.sizes.filter((s) => s.enabled).map((size) => {
    const render = renderFrame(logo, {
      width: size.width, height: size.height, padding: opts.padding, background,
      sharpenAmount: opts.sharpen && !source.isVector ? 0.6 : 0,
    });
    const evalr = evaluateSize(analysis, size, { ...opts, frameColor });
    return { size, render, evalr };
  });

  const cards = $('cards');
  cards.classList.toggle('zoomed', $('zoom').checked);
  cards.replaceChildren(...state.results.map((r) => makeCard(r, opts)));
  renderSummary();
  $('downloadAll').disabled = state.results.length === 0;
  $('empty').hidden = true;
  $('output').hidden = false;
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { process(); } catch (e) { console.error(e); toast(`Processing error: ${e.message}`, true); }
  }, 60);
}

function applyFix(fix) {
  switch (fix.action) {
    case 'padding':
      $('padding').value = Math.round(fix.value * 100);
      break;
    case 'removeBg':
      $('removeBg').checked = true;
      break;
    case 'frameColor':
      $('frameMode').value = 'custom';
      $('customColor').value = fix.value;
      break;
    case 'roundedFix':
      $('frameMode').value = 'custom';
      $('customColor').value = fix.value;
      if (state.bg.type === 'solid') $('removeBg').checked = true;
      break;
  }
  schedule();
}

// ---------- files ----------

function slug(s) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  return (s || 'logo').replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c]).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'logo';
}

function fileNameFor(size, opts) {
  return `${slug($('brandName').value)}_${size.width}x${size.height}.${opts.format}`;
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function downloadAll() {
  const opts = options();
  const files = [];
  for (const r of state.results) {
    files.push({ name: fileNameFor(r.size, opts), blob: await encodeCanvas(r.render.canvas, opts) });
  }
  const zip = await makeZip(files);
  download(zip, `${slug($('brandName').value)}_logos.zip`);
}

async function handleFile(file) {
  if (!file) return;
  try {
    const src = await loadImageFile(file);
    state.source = src;
    state.fileType = file.type || (file.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '');
    state.fileName = file.name || 'pasted-image.png';
    state.bg = detectBackground(getPixels(src.canvas));
    state.removedCache = null;
    // per-logo settings start fresh for every new file
    $('removeBg').checked = false;
    if ($('frameMode').value === 'custom') $('frameMode').value = 'auto';
    if (!$('brandName').value || $('brandName').dataset.auto === '1') {
      $('brandName').value = slug(state.fileName.replace(/\.[^.]+$/, ''));
      $('brandName').dataset.auto = '1';
    }
    renderSourceInfo();
    schedule();
  } catch (e) {
    toast(e.message, true);
  }
}

let toastTimer = 0;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast${isError ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

// ---------- wiring ----------

function init() {
  renderSizeList();

  const dz = $('dropzone');
  $('fileInput').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); handleFile(e.dataTransfer.files[0]); });
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (item) handleFile(item.getAsFile());
  });

  $('brandName').addEventListener('input', () => { $('brandName').dataset.auto = '0'; });

  for (const id of ['dpi', 'quality', 'padding', 'frameMode', 'customColor', 'sharpen', 'removeBg', 'tolerance', 'globalRemove', 'zoom']) {
    $(id).addEventListener('input', schedule);
    $(id).addEventListener('change', schedule);
  }
  document.querySelectorAll('input[name="format"]').forEach((r) => r.addEventListener('change', schedule));

  $('addSize').addEventListener('click', () => {
    const w = parseInt($('customW').value, 10);
    const h = parseInt($('customH').value, 10);
    if (!(w >= 8 && h >= 8 && w <= 5000 && h <= 5000)) { toast('Width and height must be between 8 and 5000 px.', true); return; }
    if (state.sizes.some((s) => s.width === w && s.height === h)) { toast('This size is already in the list.'); return; }
    state.sizes.push({ width: w, height: h, enabled: true, preset: false });
    $('customW').value = ''; $('customH').value = '';
    renderSizeList();
    schedule();
  });

  $('downloadAll').addEventListener('click', () => downloadAll().catch((e) => toast(e.message, true)));
  updateControls(options());
}

init();
