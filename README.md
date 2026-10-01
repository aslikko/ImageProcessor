# Logo Prep

Browser-based tool for the operations team to prepare brand logos in the exact sizes a client asks for (e.g. Cadooz: 600×378, 200×126, 124×124, 75×75 – JPG, 72 dpi, no rounded corners). No server; files never leave the browser.

**Live:** https://aslikko.github.io/ImageProcessor/

## Features
- **Upload:** SVG (recommended), PNG, JPG, WEBP – drag & drop, click, or Ctrl+V.
- **Auto-trim:** Empty space / background around the logo is removed.
- **Fit to frame:** Keeps the aspect ratio and centres the logo as large as possible in each size (adjustable padding).
- **Resolution:** Small sources are upscaled step by step with smart sharpening; large ones are downscaled with high quality.
- **Quality checks & recommendations** (per size):
  - upscale factor / low resolution, blur (edge width), JPEG artifacts
  - aspect-ratio mismatch and fill (e.g. suggests the icon version for square sizes)
  - logo/background contrast, source background vs. frame colour mismatch
  - **rounded-corner detection** → one click fills the frame with the tile colour so corners become square
  - Most findings come with a one-click fix button.
- **Background removal (optional):** Removes a solid background starting from the edges while keeping anti-aliased edges; tolerance and "enclosed areas" options.
- **Output:** JPG or PNG with DPI metadata (default 72). Download one by one or all as ZIP. Custom sizes can be added.

## Running locally
The app uses ES modules, so open it through a web server rather than double-clicking `index.html`:

```bash
npx serve .          # or: python3 -m http.server
```

Pushes to the branch are deployed to GitHub Pages by `.github/workflows/pages.yml`.

## Test
```bash
npx serve -l 8123 . &
node tests/smoke.mjs   # requires playwright
```
