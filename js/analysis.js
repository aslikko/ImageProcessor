// Quality analysis of the source logo and per-size recommendations.

import { getPixels, resize, colorDist, contrastRatio, toHex } from './imaging.js';

const ANALYSIS_MAX = 1200; // longest side of the working copy used for measurements

// Grey-scale working copy, flattened onto a background that contrasts with the logo.
function luminanceMap(canvas) {
  const k = Math.min(1, ANALYSIS_MAX / Math.max(canvas.width, canvas.height));
  const work = k < 1 ? resize(canvas, canvas.width * k, canvas.height * k) : canvas;
  const { width: w, height: h, data } = getPixels(work);

  let sum = 0, wsum = 0;
  for (let p = 0; p < data.length; p += 4) {
    const a = data[p + 3] / 255;
    sum += a * (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
    wsum += a;
  }
  const logoLum = wsum ? sum / wsum : 128;
  const backdrop = logoLum > 128 ? 0 : 255;

  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    const a = data[p + 3] / 255;
    const l = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    lum[i] = l * a + backdrop * (1 - a);
  }
  return { lum, w, h, scale: k };
}

function percentile(arr, q) {
  if (!arr.length) return 0;
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// Edge sharpness: a crisp edge changes over ~1px, so the Sobel peak is ≈ 4 × contrast.
// Returns the estimated edge width in pixels (1 = crisp) and a noise estimate.
function measureSharpness({ lum, w, h }) {
  const grads = [];
  const lapFlat = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = lum[i - w - 1], b = lum[i - w], c = lum[i - w + 1];
      const d = lum[i - 1], e = lum[i], f = lum[i + 1];
      const g = lum[i + w - 1], hh = lum[i + w], k = lum[i + w + 1];
      const gx = (c + 2 * f + k) - (a + 2 * d + g);
      const gy = (g + 2 * hh + k) - (a + 2 * b + c);
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag > 8) grads.push(mag);
      const lap = Math.abs(4 * e - b - d - f - hh);
      if (mag < 24) lapFlat.push(lap);
    }
  }
  if (grads.length < 20) return { edgeWidth: 1, noise: 0, hasEdges: false };

  // local contrast across strong edges ~ difference between dark and light extremes
  const contrast = Math.max(30, percentile(lum, 0.98) - percentile(lum, 0.02));
  const peak = percentile(grads, 0.97);
  const sharpness = Math.min(1.2, peak / (4 * contrast));
  const edgeWidth = Math.max(1, 1 / Math.max(sharpness, 0.05));

  let noise = 0;
  for (const v of lapFlat) noise += v;
  noise = lapFlat.length ? noise / lapFlat.length : 0;

  return { edgeWidth, noise, hasEdges: true };
}

// Dominant opaque colour of the logo (for contrast checks), ignoring background-like colours.
function dominantColor(canvas, exclude = []) {
  const k = Math.min(1, 200 / Math.max(canvas.width, canvas.height));
  const work = k < 1 ? resize(canvas, canvas.width * k, canvas.height * k) : canvas;
  const { data } = getPixels(work);
  const buckets = new Map();
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] < 128) continue;
    if (exclude.some((e) => colorDist(data[p], data[p + 1], data[p + 2], e.r, e.g, e.b) < 30)) continue;
    const key = ((data[p] >> 5) << 6) | ((data[p + 1] >> 5) << 3) | (data[p + 2] >> 5);
    const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    b.n++; b.r += data[p]; b.g += data[p + 1]; b.b += data[p + 2];
    buckets.set(key, b);
  }
  let best = null;
  for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
  return best ? { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n } : null;
}

function hasTransparency(canvas) {
  const { data } = getPixels(canvas);
  for (let p = 3; p < data.length; p += 4 * 7) if (data[p] < 250) return true;
  return false;
}

// Detects a rounded "tile": corners are background but the edge midpoints are one solid colour.
function detectRoundedTile(canvas, bg) {
  const { width: w, height: h, data } = getPixels(canvas);
  if (w < 24 || h < 24) return null;
  const px = (x, y) => { const p = (Math.round(y) * w + Math.round(x)) * 4; return [data[p], data[p + 1], data[p + 2], data[p + 3]]; };
  const isBg = ([r, g, b, a]) => a < 32 || (bg.type === 'solid' && colorDist(r, g, b, bg.color.r, bg.color.g, bg.color.b) < 24);

  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const inset = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const mids = [px(w / 2, inset), px(w / 2, h - 1 - inset), px(inset, h / 2), px(w - 1 - inset, h / 2)];
  if (!corners.every(isBg)) return null;
  if (mids.some(isBg)) return null;

  const m0 = mids[0];
  const sameColor = mids.every((m) => colorDist(m[0], m[1], m[2], m0[0], m0[1], m0[2]) < 24);
  if (!sameColor) return null;
  return { color: { r: m0[0], g: m0[1], b: m0[2] } };
}

// Analyses the trimmed logo once; per-size results are computed by `evaluateSize`.
export function analyzeLogo({ logo, source, trimmedSource, bg, isVector, sourceType }) {
  const lm = luminanceMap(logo);
  const sharp = measureSharpness(lm);
  const rounded = detectRoundedTile(trimmedSource, bg);
  const exclude = [];
  if (bg.type === 'solid') exclude.push(bg.color);
  if (rounded) exclude.push(rounded.color);
  return {
    isVector,
    sourceType,
    sourceWidth: source.width,
    sourceHeight: source.height,
    logoWidth: logo.width,
    logoHeight: logo.height,
    aspect: logo.width / logo.height,
    // edge width in logo pixels (analysis may have been downscaled)
    edgeWidth: sharp.hasEdges ? sharp.edgeWidth / lm.scale : 1,
    edgeWidthAnalysis: sharp.edgeWidth,
    noise: sharp.noise,
    hasEdges: sharp.hasEdges,
    transparent: hasTransparency(logo),
    logoColor: dominantColor(logo, exclude),
    rounded,
    bg,
  };
}

const LEVEL = { ok: 0, info: 1, warn: 2, error: 3 };

export function evaluateSize(a, size, opts) {
  const { width, height } = size;
  const availW = width * (1 - 2 * opts.padding);
  const availH = height * (1 - 2 * opts.padding);
  const scale = Math.min(availW / a.logoWidth, availH / a.logoHeight);
  const outW = Math.round(a.logoWidth * scale);
  const outH = Math.round(a.logoHeight * scale);
  const fill = (outW * outH) / (width * height);
  const outEdge = Math.max(1, a.edgeWidth * scale);

  const items = [];
  const add = (level, text, fix) => items.push({ level, text, fix });

  if (a.isVector) {
    add('ok', 'Vektörel kaynak (SVG) – her boyutta keskin çıktı.');
  } else if (scale <= 1) {
    add('ok', `Kaynak çözünürlük yeterli (logo ${a.logoWidth}×${a.logoHeight}px → ${outW}×${outH}px, küçültme).`);
  } else if (scale <= 2) {
    add('info', `Kaynak bu boyut için biraz küçük; ${scale.toFixed(1)}× büyütüldü ve keskinleştirildi.`);
  } else if (scale <= 4) {
    add('warn', `Kaynak düşük çözünürlüklü: ${scale.toFixed(1)}× büyütme gerekti. Çıktı hafif yumuşak olabilir; markadan daha büyük PNG veya SVG istemek daha iyi olur.`);
  } else {
    add('error', `Kaynak çok küçük (${a.logoWidth}×${a.logoHeight}px): ${scale.toFixed(1)}× büyütme gerekti. Kalite belirgin şekilde düşecek – markadan SVG veya en az ${Math.ceil(outW)}px genişliğinde PNG isteyin.`);
  }

  if (!a.isVector && a.hasEdges) {
    if (a.edgeWidthAnalysis > 2.6) {
      add('warn', `Kaynak görsel bulanık görünüyor (kenar geçişi ~${a.edgeWidthAnalysis.toFixed(1)}px). Daha net bir kaynak dosya önerilir.`);
    } else if (scale > 1 && outEdge > 2.5) {
      add('warn', `Bu boyutta kenarlar yumuşak görünebilir (çıktıda ~${outEdge.toFixed(1)}px geçiş).`);
    }
    if (scale > 0.7 && (a.noise > 2.2 || (a.sourceType === 'image/jpeg' && a.noise > 1.2))) {
      add('warn', 'Düz renk alanlarında sıkıştırma/gürültü izleri var (muhtemelen JPEG kaynağı). Mümkünse PNG/SVG kaynak kullanın.');
    }
  }

  const sizeAspect = width / height;
  const mismatch = Math.max(a.aspect / sizeAspect, sizeAspect / a.aspect);
  if (fill < 0.18) {
    add('warn', `Logo bu çerçevenin yalnızca %${Math.round(fill * 100)}'ini dolduruyor; çok küçük kalacak.` +
      (Math.abs(sizeAspect - 1) < 0.05 && a.aspect > 1.8 ? ' Kare boyutlar için markanın ikon/simge versiyonunu kullanmak daha iyi olur.' : ''),
    opts.padding > 0.05 ? { action: 'padding', value: 0.04, label: 'Boşluğu %4\'e düşür' } : null);
  } else if (mismatch > 2.2) {
    add('info', `Logo oranı (${a.aspect.toFixed(2)}) çerçeve oranından (${sizeAspect.toFixed(2)}) çok farklı; kenarlarda geniş boşluk kalacak.`);
  }

  if (width < 100 && a.logoHeight > 0 && outH < 24) {
    add('warn', `Bu küçük boyutta logo yüksekliği ${outH}px; ince yazılar okunmayabilir.`);
  }

  // background / format checks
  const frameColor = opts.frameColor; // null = transparent
  if (opts.format === 'jpg' && a.transparent) {
    add('info', `JPG şeffaflık desteklemez; şeffaf alanlar ${frameColor ? toHex(frameColor) : 'beyaz'} ile dolduruldu.`);
  }
  if (!opts.removeBg && a.bg.type === 'solid' && frameColor && colorDist(frameColor.r, frameColor.g, frameColor.b, a.bg.color.r, a.bg.color.g, a.bg.color.b) > 12) {
    add('warn', `Kaynağın zemini (${toHex(a.bg.color)}) çerçeve renginden farklı; logonun etrafında kutu görünebilir.`,
      { action: 'removeBg', label: 'Arka planı temizle' });
  }
  if (!opts.removeBg && a.bg.type === 'mixed') {
    add('warn', 'Arka plan düz renk değil (gradyan/fotoğraf). Sonuç beklendiği gibi olmayabilir; şeffaf veya düz zeminli kaynak tercih edin.');
  }
  if (a.logoColor && frameColor && !a.rounded) {
    const cr = contrastRatio(a.logoColor, frameColor);
    if (cr < 1.6) {
      const alt = contrastRatio(a.logoColor, { r: 255, g: 255, b: 255 }) > contrastRatio(a.logoColor, { r: 0, g: 0, b: 0 }) ? '#ffffff' : '#000000';
      add('warn', `Logo rengi (${toHex(a.logoColor)}) ile zemin arasında kontrast çok düşük (${cr.toFixed(1)}:1); logo seçilmeyebilir.`,
        { action: 'frameColor', value: alt, label: `Zemini ${alt === '#ffffff' ? 'beyaz' : 'siyah'} yap` });
    }
  }
  if (a.rounded) {
    const hex = toHex(a.rounded.color);
    const fixed = frameColor && colorDist(frameColor.r, frameColor.g, frameColor.b, a.rounded.color.r, a.rounded.color.g, a.rounded.color.b) < 12;
    if (!fixed) {
      add('warn', `Kaynakta yuvarlatılmış köşeli bir zemin var (${hex}). Müşteri yuvarlak köşe istemiyor: çerçeveyi bu renkle doldurmak köşeleri düz yapar.`,
        { action: 'roundedFix', value: hex, label: `Çerçeveyi ${hex} ile doldur` });
    }
  }

  let worst = 'ok';
  for (const it of items) if (LEVEL[it.level] > LEVEL[worst]) worst = it.level;
  return { scale, outW, outH, fill, items, status: worst };
}
