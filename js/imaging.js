// Core image operations: loading, background detection/removal, trimming, resizing, framing.

const SVG_RASTER_SIZE = 2400; // longest side used when rasterising vector logos

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true });
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the image. The file may be corrupt or in an unsupported format.'));
    img.src = url;
  });
}

async function loadSvg(file) {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('Could not read the SVG file.');

  let vw = parseFloat(svg.getAttribute('width')) || 0;
  let vh = parseFloat(svg.getAttribute('height')) || 0;
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { vw = vb[2]; vh = vb[3]; }
  if (!vw || !vh) { vw = 1000; vh = 1000; }
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);

  const k = SVG_RASTER_SIZE / Math.max(vw, vh);
  const w = Math.round(vw * k);
  const h = Math.round(vh * k);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageFromUrl(url);
    const canvas = createCanvas(w, h);
    ctx2d(canvas).drawImage(img, 0, 0, w, h);
    return { canvas, isVector: true, originalWidth: Math.round(vw), originalHeight: Math.round(vh) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadImageFile(file) {
  const name = file.name.toLowerCase();
  if (file.type === 'image/svg+xml' || name.endsWith('.svg')) return loadSvg(file);
  if (/\.(pdf|ai|eps|psd)$/.test(name)) {
    throw new Error('PDF/AI/EPS/PSD are not supported directly. Please export as SVG, PNG, JPG or WEBP.');
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageFromUrl(url);
    const canvas = createCanvas(img.naturalWidth, img.naturalHeight);
    ctx2d(canvas).drawImage(img, 0, 0);
    return { canvas, isVector: false, originalWidth: img.naturalWidth, originalHeight: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function getPixels(canvas) {
  return ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height);
}

export function cloneCanvas(src) {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

// ---------- colour helpers ----------

export function colorDist(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  // weighted euclidean – cheap approximation of perceptual distance
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
}

export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 255, g: 255, b: 255 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function relLuminance({ r, g, b }) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------- background detection ----------

// Looks at the outer border and decides whether the background is transparent,
// a single solid colour, or mixed (photo / gradient).
export function detectBackground(imageData) {
  const { width: w, height: h, data } = imageData;
  const samples = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  const push = (x, y) => samples.push((y * w + x) * 4);
  for (let x = 0; x < w; x += step) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += step) { push(0, y); push(w - 1, y); }

  let transparent = 0;
  const buckets = new Map();
  for (const i of samples) {
    if (data[i + 3] < 24) { transparent++; continue; }
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    buckets.set(key, b);
  }
  const total = samples.length;
  if (transparent / total > 0.5) return { type: 'transparent', share: transparent / total };

  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
  if (!sorted.length) return { type: 'transparent', share: 1 };
  const avg = (b) => ({ r: b.r / b.n, g: b.g / b.n, b: b.b / b.n });
  const color = avg(sorted[0]);

  // share of border samples close to any of the given colours (buckets split near-identical colours)
  const shareOf = (colors) => {
    let close = 0;
    for (const i of samples) {
      if (data[i + 3] >= 24 && colors.some((c) => colorDist(data[i], data[i + 1], data[i + 2], c.r, c.g, c.b) < 20)) close++;
    }
    return close / total;
  };
  const share = shareOf([color]);
  if (share > 0.6) return { type: 'solid', color, colors: [color], share };

  // "fake transparency": a grey/white checkerboard baked into the image
  const second = sorted.map(avg).find((c) => colorDist(c.r, c.g, c.b, color.r, color.g, color.b) >= 20);
  if (second) {
    const c2 = second;
    const both = shareOf([color, c2]);
    const neutral = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) < 24;
    if (both > 0.6 && share > 0.15 && neutral(color) && neutral(c2) && colorDist(color.r, color.g, color.b, c2.r, c2.g, c2.b) < 90) {
      const light = relLuminance(color) >= relLuminance(c2) ? color : c2;
      return { type: 'checker', color: light, colors: [color, c2], share: both };
    }
  }
  return { type: 'mixed', color, colors: [color], share };
}

// Distance of a pixel to the closest background colour.
export function bgDist(r, g, b, colors) {
  let m = Infinity;
  for (const c of colors) m = Math.min(m, colorDist(r, g, b, c.r, c.g, c.b));
  return m;
}

export function isKeyedBg(bg) {
  return !!bg && (bg.type === 'solid' || bg.type === 'checker');
}

// ---------- background removal ----------

// Flood fills from the borders, making pixels similar to `bg` transparent.
// `global` also removes enclosed areas of the same colour (letter holes etc.).
export function removeBackground(canvas, colors, { tolerance = 30, global = false } = {}) {
  const out = cloneCanvas(canvas);
  const ctx = ctx2d(out);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const { width: w, height: h, data } = img;
  const removed = new Uint8Array(w * h);
  const dist = (p) => bgDist(data[p], data[p + 1], data[p + 2], colors);
  const nearest = (r, g, b) => colors.reduce((best, c) => (colorDist(r, g, b, c.r, c.g, c.b) < colorDist(r, g, b, best.r, best.g, best.b) ? c : best));

  if (global) {
    for (let i = 0, p = 0; i < removed.length; i++, p += 4) {
      if (data[p + 3] < 8 || dist(p) <= tolerance) removed[i] = 1;
    }
  } else {
    const stack = [];
    const visited = new Uint8Array(w * h);
    const seed = (x, y) => { const i = y * w + x; if (!visited[i]) { visited[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    while (stack.length) {
      const i = stack.pop();
      const p = i * 4;
      if (data[p + 3] >= 8 && dist(p) > tolerance) continue;
      removed[i] = 1;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && !visited[i - 1]) { visited[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !visited[i + 1]) { visited[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !visited[i - w]) { visited[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !visited[i + w]) { visited[i + w] = 1; stack.push(i + w); }
    }
  }

  // Anti-aliased rim (≤2px from removed area): the pixel is a mix of bg and the nearby
  // logo colour. Estimate that colour from the neighbourhood and derive alpha from it.
  const rim = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (removed[i]) continue;
      search: for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && removed[yy * w + xx]) { rim[i] = 1; break search; }
        }
      }
    }
  }
  const src = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!rim[i]) continue;
      const p = i * 4;
      const bg = nearest(src[p], src[p + 1], src[p + 2]);
      // most "non-background" neighbour within 3px = estimated logo colour
      let best = -1, fr = 0, fg = 0, fb = 0;
      for (let dy = -3; dy <= 3; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (removed[j]) continue;
          const q = j * 4;
          if (src[q + 3] < 200) continue;
          const d = bgDist(src[q], src[q + 1], src[q + 2], colors);
          if (d > best) { best = d; fr = src[q]; fg = src[q + 1]; fb = src[q + 2]; }
        }
      }
      if (best <= tolerance) continue;
      const vr = fr - bg.r, vg = fg - bg.g, vb = fb - bg.b;
      const len2 = vr * vr + vg * vg + vb * vb;
      if (!len2) continue;
      const a = ((src[p] - bg.r) * vr + (src[p + 1] - bg.g) * vg + (src[p + 2] - bg.b) * vb) / len2;
      const alpha = Math.max(0, Math.min(1, a));
      if (alpha > 0.97) continue;
      data[p] = fr; data[p + 1] = fg; data[p + 2] = fb;
      data[p + 3] = Math.round(src[p + 3] * alpha);
    }
  }
  for (let i = 0; i < removed.length; i++) if (removed[i]) data[i * 4 + 3] = 0;

  ctx.putImageData(img, 0, 0);
  return out;
}

// ---------- trimming ----------

// Bounding box of the "logo" pixels (not transparent and not background coloured).
export function contentBounds(imageData, bg, tolerance = 30) {
  const { width: w, height: h, data } = imageData;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const solid = isKeyedBg(bg);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (data[p + 3] < 16) continue;
      if (solid && bgDist(data[p], data[p + 1], data[p + 2], bg.colors) <= tolerance) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h, empty: true };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, empty: false };
}

export function crop(canvas, box) {
  const c = createCanvas(box.w, box.h);
  ctx2d(c).drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return c;
}

// ---------- resizing ----------

// High quality resize: halves repeatedly when shrinking, doubles step by step when enlarging.
export function resize(src, tw, th) {
  tw = Math.max(1, Math.round(tw));
  th = Math.max(1, Math.round(th));
  let cur = src;
  let cw = src.width, ch = src.height;

  const step = (nw, nh) => {
    const c = createCanvas(nw, nh);
    const x = ctx2d(c);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
    cur = c; cw = nw; ch = nh;
  };

  while (cw / 2 >= tw && ch / 2 >= th) step(Math.round(cw / 2), Math.round(ch / 2));
  while (cw * 2 <= tw && ch * 2 <= th) step(cw * 2, ch * 2);
  if (cw !== tw || ch !== th) step(tw, th);
  return cur === src ? cloneCanvas(src) : cur;
}

// Unsharp mask (3x3 blur, premultiplied alpha so transparent pixels don't create halos).
export function sharpen(canvas, amount = 0.6) {
  const ctx = ctx2d(canvas);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width: w, height: h, data } = img;
  const pm = new Float32Array(data.length);
  for (let p = 0; p < data.length; p += 4) {
    const a = data[p + 3] / 255;
    pm[p] = data[p] * a; pm[p + 1] = data[p + 1] * a; pm[p + 2] = data[p + 2] * a; pm[p + 3] = data[p + 3];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const out = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            sum += pm[(yy * w + xx) * 4 + c]; n++;
          }
        }
        const v = pm[p + c];
        out[c] = v + amount * (v - sum / n);
      }
      const a = Math.max(0, Math.min(255, out[3]));
      data[p + 3] = a;
      if (a > 0) {
        const k = 255 / a;
        data[p] = out[0] * k; data[p + 1] = out[1] * k; data[p + 2] = out[2] * k;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// ---------- framing ----------

// Places the (trimmed) logo into a w x h frame keeping the aspect ratio,
// leaving `padding` (fraction of the frame) free on every side.
export function renderFrame(logo, { width, height, padding = 0.1, background = null, sharpenAmount = 0.6 }) {
  const availW = width * (1 - 2 * padding);
  const availH = height * (1 - 2 * padding);
  const scale = Math.min(availW / logo.width, availH / logo.height);
  const lw = Math.max(1, Math.round(logo.width * scale));
  const lh = Math.max(1, Math.round(logo.height * scale));

  const scaled = resize(logo, lw, lh);
  if (scale > 1.15 && sharpenAmount > 0) sharpen(scaled, Math.min(1, sharpenAmount * Math.min(scale, 3) / 2));

  const frame = createCanvas(width, height);
  const x = ctx2d(frame);
  if (background) {
    x.fillStyle = background;
    x.fillRect(0, 0, width, height);
  }
  x.drawImage(scaled, Math.round((width - lw) / 2), Math.round((height - lh) / 2));
  return { canvas: frame, scale, logoWidth: lw, logoHeight: lh };
}
