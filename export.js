// Export dialog: PNG (still), APNG, GIF, animated WebP and WebM, rendered frame by frame off screen.
// Loaded on demand by app.js; talks to the viewer only through the `renderer` bridge it is given.

const GIFENC = "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/+esm";
const STORE_KEY = "ba-viewer-export";

const FORMATS = [
  { id: "png", label: "PNG", sub: "Image", anim: false, ext: "png" },
  { id: "apng", label: "APNG", sub: "Animated", anim: true, ext: "png" },
  { id: "gif", label: "GIF", sub: "Animated", anim: true, ext: "gif" },
  { id: "webp", label: "WebP", sub: "Animated", anim: true, ext: "webp" },
  { id: "webm", label: "WebM", sub: "Video", anim: true, ext: "webm" },
];
const SIZES = [512, 768, 1024, 1440, 1920, 2560, 3840];
const ASPECTS = [["viewport", "Viewport"], ["1:1", "1:1"], ["4:5", "4:5"], ["9:16", "9:16"], ["16:9", "16:9"]];
const ASPECT_VALUE = { "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16, "16:9": 16 / 9 };
const FPS = [10, 12, 15, 24, 30, 60];

const DEFAULTS = {
  format: "png", sizeStill: 1920, sizeAnim: 1024, aspect: "viewport", transparent: false, shadow: true,
  framing: "fit", padding: 8,
  fps: 24, quality: 80, colors: 256,
};

// ---------- capabilities ----------
let capsPromise = null;
function detectCaps() {
  capsPromise ??= (async () => {
    const caps = { webp: false, apng: "CompressionStream" in window, webm: null, webmAlpha: false };
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 2;
      caps.webp = c.toDataURL("image/webp").startsWith("data:image/webp");
    } catch {}
    if ("VideoEncoder" in window) {
      for (const codec of ["vp09.00.10.08", "vp8"]) {
        try {
          const base = { codec, width: 640, height: 360, bitrate: 2e6, framerate: 24 };
          if ((await VideoEncoder.isConfigSupported(base)).supported) {
            caps.webm = codec;
            caps.webmAlpha = true; // encoded as a second stream, see encodeWebM
            break;
          }
        } catch {}
      }
    }
    return caps;
  })();
  return capsPromise;
}
const unsupportedReason = (id, caps) => ({
  webp: !caps.webp && "This browser can't encode WebP images.",
  apng: !caps.apng && "This browser can't compress PNG data.",
  webm: !caps.webm && "This browser can't encode video (needs WebCodecs).",
})[id] || "";
const alphaSupport = (id, caps) => (id === "webm" ? caps.webmAlpha : true); // GIF: 1-bit

// ---------- settings ----------
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
}

// ---------- dialog ----------
let dialog, renderer, settings, caps, abortCtl = null, range = { start: 0, end: 0 }, lastInfo = null;

export async function openExport(bridge) {
  renderer = bridge;
  dialog = document.getElementById("export-dialog");
  settings = loadSettings();
  caps = await detectCaps();
  lastInfo = renderer.info();
  if (!lastInfo.ready) return;
  range = { start: 0, end: lastInfo.duration };
  if (unsupportedReason(settings.format, caps)) settings.format = "png";
  renderForm();
  if (!dialog.open) dialog.showModal();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderForm() {
  const fmt = FORMATS.find((f) => f.id === settings.format);
  const info = lastInfo;
  const sizeKey = fmt.anim ? "sizeAnim" : "sizeStill";
  const alphaOk = alphaSupport(fmt.id, caps);
  dialog.innerHTML = `
  <form method="dialog" class="export-form">
    <header class="export-head">
      <h2 id="export-title">Export</h2>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close">✕</button>
    </header>
    <p class="export-sub">${esc(info.base)}</p>
    <fieldset class="export-formats">
      <legend class="sr-only">Format</legend>
      ${FORMATS.map((f) => {
        const why = unsupportedReason(f.id, caps);
        return `<label class="export-format${why ? " disabled" : ""}" title="${esc(why)}">
          <input type="radio" name="format" value="${f.id}" ${f.id === fmt.id ? "checked" : ""} ${why ? "disabled" : ""}>
          <span class="fmt-name">${f.label}</span><span class="fmt-sub">${why ? "Not supported here" : f.sub}</span>
        </label>`;
      }).join("")}
    </fieldset>
    <div class="export-grid">
      <label class="field">Size (longest side)
        <select name="size">${SIZES.map((v) => `<option value="${v}" ${v === settings[sizeKey] ? "selected" : ""}>${v} px</option>`).join("")}</select>
      </label>
      <label class="field">Aspect
        <select name="aspect">${ASPECTS.map(([v, l]) => `<option value="${v}" ${v === settings.aspect ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <label class="field">Framing
        <select name="framing">
          <option value="fit" ${settings.framing === "fit" ? "selected" : ""}>Fit to model</option>
          <option value="view" ${settings.framing === "view" ? "selected" : ""}>Current view</option>
        </select>
      </label>
      ${settings.framing === "fit" ? `
      <label class="field">Padding
        <select name="padding">${[0, 4, 8, 15, 25].map((v) => `<option value="${v}" ${v === settings.padding ? "selected" : ""}>${v}%</option>`).join("")}</select>
      </label>` : ""}
      ${fmt.anim ? `
      <label class="field">Frame rate
        <select name="fps">${FPS.map((v) => `<option value="${v}" ${v === settings.fps ? "selected" : ""}>${v} fps</option>`).join("")}</select>
      </label>` : ""}
      ${fmt.id === "gif" ? `
      <label class="field">Colours
        <select name="colors">${[256, 128, 64].map((v) => `<option value="${v}" ${v === settings.colors ? "selected" : ""}>${v}</option>`).join("")}</select>
      </label>` : ""}
      ${fmt.id === "webp" || fmt.id === "webm" ? `
      <label class="field">Quality <span class="q-val">${settings.quality}</span>
        <input type="range" name="quality" min="10" max="100" step="5" value="${settings.quality}">
      </label>` : ""}
    </div>
    ${fmt.anim ? `
    <div class="export-range">
      <label class="field">Start (s)<input type="number" name="start" min="0" max="${info.duration.toFixed(2)}" step="0.01" value="${range.start.toFixed(2)}"></label>
      <label class="field">End (s)<input type="number" name="end" min="0" max="${info.duration.toFixed(2)}" step="0.01" value="${range.end.toFixed(2)}"></label>
      <button type="button" class="btn subtle small" data-act="whole">Whole clip</button>
    </div>` : `<p class="export-note">Captures the current frame (${info.time.toFixed(2)} s of ${esc(info.clip || "the pose")}).</p>`}
    <div class="export-checks">
      <label class="check ${alphaOk ? "" : "disabled"}" title="${alphaOk ? "" : "This browser can't encode transparent video."}">
        <input type="checkbox" name="transparent" ${settings.transparent && alphaOk ? "checked" : ""} ${alphaOk ? "" : "disabled"}>
        Transparent background${fmt.id === "gif" ? " <small>(1-bit)</small>" : ""}
      </label>
      <label class="check"><input type="checkbox" name="shadow" ${settings.shadow ? "checked" : ""}> Ground shadow</label>
    </div>
    <p class="export-summary" aria-live="polite"></p>
    <footer class="export-actions">
      <button type="button" class="btn subtle" data-act="close">Cancel</button>
      ${fmt.id === "png" && navigator.clipboard?.write && window.ClipboardItem ? `<button type="button" class="btn subtle" data-act="copy">Copy image</button>` : ""}
      <button type="submit" class="btn" data-act="save">Save</button>
    </footer>
  </form>`;
  bindForm();
  updateSummary();
}

function readForm() {
  const f = dialog.querySelector("form");
  const fd = new FormData(f);
  const fmt = FORMATS.find((x) => x.id === fd.get("format"));
  const s = settings;
  s.format = fmt.id;
  s[fmt.anim ? "sizeAnim" : "sizeStill"] = Number(fd.get("size"));
  s.aspect = fd.get("aspect");
  if (fd.has("fps")) s.fps = Number(fd.get("fps"));
  if (fd.has("colors")) s.colors = Number(fd.get("colors"));
  if (fd.has("quality")) s.quality = Number(fd.get("quality"));
  if (!f.elements.transparent.disabled) s.transparent = f.elements.transparent.checked;
  s.shadow = f.elements.shadow.checked;
  s.framing = fd.get("framing") || s.framing;
  if (fd.has("padding")) s.padding = Number(fd.get("padding"));
  if (fd.has("start")) {
    const d = lastInfo.duration;
    range.start = clamp(Number(fd.get("start")) || 0, 0, d);
    range.end = clamp(Number(fd.get("end")) || d, 0, d);
  }
  saveSettings(s);
  return s;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function outputSize(s, fmt) {
  const long = fmt.anim ? s.sizeAnim : s.sizeStill;
  const aspect = s.aspect === "viewport" ? lastInfo.viewportAspect : ASPECT_VALUE[s.aspect];
  let w = aspect >= 1 ? long : Math.round(long * aspect);
  let h = aspect >= 1 ? Math.round(long / aspect) : long;
  if (fmt.id === "webm") { w -= w % 2; h -= h % 2; }
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

// frame times: one loop of [start, end) at the current playback speed
function frameTimes(s) {
  const { speed } = lastInfo;
  const span = Math.max(0, range.end - range.start);
  const n = Math.max(1, Math.round((span / speed) * s.fps));
  return Array.from({ length: n }, (_, i) => range.start + (i * speed) / s.fps);
}

function updateSummary() {
  const s = readForm();
  const fmt = FORMATS.find((x) => x.id === s.format);
  const { w, h } = outputSize(s, fmt);
  let text = `${w} × ${h} px`;
  if (fmt.anim) {
    const n = frameTimes(s).length;
    text += ` · ${n} frame${n === 1 ? "" : "s"} · ${(n / s.fps).toFixed(2)} s`;
    if (lastInfo.speed !== 1) text += ` (at ${lastInfo.speed}× speed)`;
    if (range.end <= range.start) text = "End must be after start.";
  }
  dialog.querySelector(".export-summary").textContent = text;
  dialog.querySelector('[data-act="save"]').disabled = fmt.anim && range.end <= range.start;
}

function bindForm() {
  const f = dialog.querySelector("form");
  f.addEventListener("change", (e) => {
    if (e.target.name === "format") { settings.format = e.target.value; saveSettings(settings); renderForm(); return; }
    if (e.target.name === "framing") { readForm(); renderForm(); return; }
    updateSummary();
  });
  f.addEventListener("input", (e) => {
    if (e.target.name === "quality") dialog.querySelector(".q-val").textContent = e.target.value;
    if (e.target.type !== "radio") updateSummary();
  });
  f.addEventListener("submit", (e) => { e.preventDefault(); run("save"); });
  dialog.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener("click", () => dialog.close()));
  dialog.querySelector('[data-act="copy"]')?.addEventListener("click", () => run("copy"));
  dialog.querySelector('[data-act="whole"]')?.addEventListener("click", () => {
    range = { start: 0, end: lastInfo.duration };
    f.elements.start.value = "0.00";
    f.elements.end.value = lastInfo.duration.toFixed(2);
    updateSummary();
  });
  dialog.onclick = (e) => { if (e.target === dialog && !abortCtl) dialog.close(); }; // click on backdrop
  dialog.oncancel = (e) => { if (abortCtl) { e.preventDefault(); abortCtl.abort(); } };
}

// ---------- running an export ----------
function showProgress(text) {
  dialog.innerHTML = `
  <div class="export-progress">
    <h2 id="export-title">Exporting…</h2>
    <p class="export-sub">${esc(lastInfo.base)}</p>
    <div class="bar"><div class="export-bar-fill"></div></div>
    <p class="export-status">${esc(text)}</p>
    <footer class="export-actions"><button type="button" class="btn subtle" data-act="abort">Cancel</button></footer>
  </div>`;
  dialog.querySelector('[data-act="abort"]').addEventListener("click", () => abortCtl?.abort());
}
function setProgress(frac, text) {
  const fill = dialog.querySelector(".export-bar-fill");
  if (fill) fill.style.width = `${Math.round(clamp(frac, 0, 1) * 100)}%`;
  const st = dialog.querySelector(".export-status");
  if (st && text) st.textContent = text;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const aborted = (signal) => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };

async function run(mode) {
  const s = readForm();
  const fmt = FORMATS.find((x) => x.id === s.format);
  const { w, h } = outputSize(s, fmt);
  const transparent = s.transparent && alphaSupport(fmt.id, caps);
  abortCtl = new AbortController();
  const signal = abortCtl.signal;
  showProgress("Preparing…");
  await nextFrame();
  const fitTimes = fmt.anim ? frameTimes(s) : [lastInfo.time];
  renderer.begin({
    width: w, height: h, transparent, shadow: s.shadow,
    fit: s.framing === "fit", padding: s.padding / 100, times: fitTimes,
  });
  let blob = null;
  try {
    if (fmt.id === "png") {
      setProgress(0.5, "Rendering…");
      blob = await rgbaToBlob(renderer.frame(lastInfo.time), w, h, "image/png");
    } else {
      const times = frameTimes(s);
      const encode = { apng: encodeAPNG, gif: encodeGIF, webp: encodeWebP, webm: encodeWebM }[fmt.id];
      blob = await encode({ times, w, h, s, transparent, signal });
    }
  } catch (e) {
    renderer.end();
    abortCtl = null;
    if (e.name === "AbortError") { renderForm(); return; }
    console.error(e);
    dialog.innerHTML = `<div class="export-progress"><h2 id="export-title">Export failed</h2>
      <p class="export-status">${esc(e.message || e)}</p>
      <footer class="export-actions"><button type="button" class="btn" data-act="back">Back</button></footer></div>`;
    dialog.querySelector('[data-act="back"]').addEventListener("click", renderForm);
    return;
  }
  renderer.end();
  abortCtl = null;
  if (mode === "copy") {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setProgress(1, "Copied to clipboard.");
    } catch (e) {
      setProgress(1, `Couldn't copy: ${e.message}`);
    }
  } else {
    download(blob, `${lastInfo.base}.${fmt.ext}`);
    setProgress(1, `Saved ${fmtSize(blob.size)}.`);
  }
  const actions = dialog.querySelector(".export-actions");
  actions.innerHTML = `<button type="button" class="btn subtle" data-act="again">Export another</button><button type="button" class="btn" data-act="done">Done</button>`;
  actions.querySelector('[data-act="again"]').addEventListener("click", renderForm);
  actions.querySelector('[data-act="done"]').addEventListener("click", () => dialog.close());
  dialog.querySelector("#export-title").textContent = mode === "copy" ? "Copied" : "Exported";
}

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

let scratch = null;
function rgbaToBlob(px, w, h, type, quality) {
  scratch ??= document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  scratch.getContext("2d").putImageData(new ImageData(px, w, h), 0, 0);
  return new Promise((res, rej) => scratch.toBlob((b) => (b ? res(b) : rej(new Error(`Couldn't encode ${type}.`))), type, quality));
}

// render every frame, reporting progress; calls onFrame(rgba, index)
async function renderFrames(times, signal, onFrame, from = 0, share = 1, label = "Rendering frame") {
  for (let i = 0; i < times.length; i++) {
    aborted(signal);
    await onFrame(renderer.frame(times[i]), i);
    setProgress(from + (share * (i + 1)) / times.length, `${label} ${i + 1} / ${times.length}`);
    await nextFrame();
  }
}

// ---------- CRC32 / binary helpers ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(...parts) {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const ascii = (s) => new TextEncoder().encode(s);
const u32be = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const u16be = (v) => new Uint8Array([(v >>> 8) & 255, v & 255]);
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- APNG ----------
function pngChunk(type, data) {
  const t = ascii(type);
  return concat([u32be(data.length), t, data, u32be(crc32(t, data))]);
}
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function filterSub(px, w, h) {
  const row = w * 4, out = new Uint8Array((row + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (row + 1), r = y * row;
    out[o] = 1; // Sub
    for (let x = 0; x < row; x++) out[o + 1 + x] = (px[r + x] - (x >= 4 ? px[r + x - 4] : 0)) & 255;
  }
  return out;
}
async function encodeAPNG({ times, w, h, s, signal }) {
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  parts.push(pngChunk("IHDR", concat([u32be(w), u32be(h), new Uint8Array([8, 6, 0, 0, 0])])));
  parts.push(pngChunk("acTL", concat([u32be(times.length), u32be(0)])));
  let seq = 0;
  await renderFrames(times, signal, async (px, i) => {
    parts.push(pngChunk("fcTL", concat([
      u32be(seq++), u32be(w), u32be(h), u32be(0), u32be(0),
      u16be(1), u16be(s.fps), new Uint8Array([0, 0]), // delay 1/fps s; dispose none; blend source
    ])));
    const data = await deflate(filterSub(px, w, h));
    parts.push(i === 0 ? pngChunk("IDAT", data) : pngChunk("fdAT", concat([u32be(seq++), data])));
  });
  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return new Blob(parts, { type: "image/png" });
}

// ---------- GIF (gifenc) ----------
async function encodeGIF({ times, w, h, s, transparent, signal }) {
  setProgress(0, "Loading GIF encoder…");
  const { GIFEncoder, quantize } = await import(GIFENC);
  const format = transparent ? "rgba4444" : "rgb565";
  // one shared palette from ~16 frames across the clip, so colours don't flicker between frames
  const count = Math.min(16, times.length);
  const picks = [...new Set(Array.from({ length: count }, (_, k) =>
    Math.round((k * (times.length - 1)) / Math.max(1, count - 1))))];
  const stride = Math.max(1, Math.round(Math.sqrt((w * h * picks.length) / 400000))); // ~400k sample pixels
  const samples = [];
  await renderFrames(picks.map((i) => times[i]), signal, (px) => {
    for (let y = 0; y < h; y += stride) for (let x = 0; x < w; x += stride) {
      const i = (y * w + x) * 4;
      samples.push(px[i], px[i + 1], px[i + 2], px[i + 3]);
    }
  }, 0, 0.15, "Building palette");
  const palette = quantize(new Uint8Array(samples), s.colors, { format, oneBitAlpha: transparent, clearAlpha: transparent });
  const transparentIndex = transparent ? Math.max(0, palette.findIndex((c) => c[3] === 0)) : 0;
  const gif = GIFEncoder();
  const unit = 100 / s.fps; // in 1/100 s
  const mapFrame = paletteMapper(palette, w * h, transparent, transparentIndex);
  await renderFrames(times, signal, (px, i) => {
    const index = mapFrame(px);
    const delay = (Math.round((i + 1) * unit) - Math.round(i * unit)) * 10; // spread rounding, in ms
    gif.writeFrame(index, w, h, {
      palette: i === 0 ? palette : undefined, delay, repeat: 0,
      transparent, transparentIndex, dispose: transparent ? 2 : -1,
    });
  }, 0.15, 0.85);
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

// Maps frames to palette indices. Two things keep the animation from flickering:
//  - full-precision nearest colour (perceptually weighted RGB), rather than gifenc's 5-6 bit lookup,
//    whose coarse bands sat right inside the smooth shading;
//  - a temporal lock: a pixel keeps last frame's index until its colour has moved more than a few levels
//    away from the colour that index was picked for, so tiny frame-to-frame differences in smooth
//    gradients no longer flip pixels back and forth between two neighbouring palette entries.
function paletteMapper(palette, count, transparent, transparentIndex) {
  const LOCK = 10; // summed |dR|+|dG|+|dB| within which a pixel keeps its previous index
  const pr = [], pg = [], pb = [], idx = [];
  palette.forEach((c, i) => {
    if (transparent && i === transparentIndex) return;
    pr.push(c[0]); pg.push(c[1]); pb.push(c[2]); idx.push(i);
  });
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let best = cache.get(key);
    if (best !== undefined) return best;
    let bestD = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const dr = r - pr[k], dg = g - pg[k], db = b - pb[k];
      const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (d < bestD) { bestD = d; best = idx[k]; }
    }
    if (cache.size > 1 << 20) cache.clear();
    cache.set(key, best);
    return best;
  };
  const last = new Int16Array(count).fill(-1);
  const ref = new Uint8Array(count * 3);
  return (px) => {
    const out = new Uint8Array(count);
    for (let p = 0, i = 0; p < count; p++, i += 4) {
      if (transparent && px[i + 3] < 128) { out[p] = transparentIndex; last[p] = -1; continue; }
      const r = px[i], g = px[i + 1], b = px[i + 2], o = p * 3;
      if (last[p] >= 0 && Math.abs(r - ref[o]) + Math.abs(g - ref[o + 1]) + Math.abs(b - ref[o + 2]) <= LOCK) {
        out[p] = last[p];
        continue;
      }
      const n = nearest(r, g, b);
      out[p] = n; last[p] = n;
      ref[o] = r; ref[o + 1] = g; ref[o + 2] = b;
    }
    return out;
  };
}

// ---------- animated WebP (browser-encoded frames, muxed here) ----------
function riffChunks(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let o = 12; o + 8 <= bytes.length;) {
    const type = String.fromCharCode(...bytes.subarray(o, o + 4));
    const size = dv.getUint32(o + 4, true);
    out.push({ type, chunk: bytes.subarray(o, o + 8 + size + (size & 1)) });
    o += 8 + size + (size & 1);
  }
  return out;
}
function riff(type, data) {
  const head = new Uint8Array(8);
  head.set(ascii(type));
  new DataView(head.buffer).setUint32(4, data.length, true);
  return data.length & 1 ? concat([head, data, new Uint8Array(1)]) : concat([head, data]);
}
const u24le = (v) => new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255]);
async function encodeWebP({ times, w, h, s, transparent, signal }) {
  const frames = [];
  let hasAlpha = transparent;
  const unit = 1000 / s.fps;
  await renderFrames(times, signal, async (px, i) => {
    const blob = await rgbaToBlob(px, w, h, "image/webp", s.quality / 100);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const data = riffChunks(bytes).filter((c) => ["ALPH", "VP8 ", "VP8L"].includes(c.type));
    if (!data.length) throw new Error("The browser produced an unexpected WebP frame.");
    if (data.some((c) => c.type === "ALPH" || c.type === "VP8L")) hasAlpha ||= data.some((c) => c.type === "ALPH");
    const duration = Math.round((i + 1) * unit) - Math.round(i * unit);
    frames.push(riff("ANMF", concat([
      u24le(0), u24le(0), u24le(w - 1), u24le(h - 1), u24le(duration),
      new Uint8Array([0b10]), // no blending (each frame fully replaces the last), no disposal
      ...data.map((c) => c.chunk),
    ])));
  });
  const vp8x = riff("VP8X", concat([new Uint8Array([0x02 | (hasAlpha ? 0x10 : 0), 0, 0, 0]), u24le(w - 1), u24le(h - 1)]));
  const anim = riff("ANIM", new Uint8Array([0, 0, 0, 0, 0, 0])); // background 0, loop forever
  const body = concat([ascii("WEBP"), vp8x, anim, ...frames]);
  const head = new Uint8Array(8);
  head.set(ascii("RIFF"));
  new DataView(head.buffer).setUint32(4, body.length, true);
  return new Blob([head, body], { type: "image/webp" });
}

// ---------- WebM (WebCodecs + a small EBML muxer) ----------
// Opaque video: one VP9/VP8 stream. Transparent video: a second stream carries the alpha mask (in its
// Y plane) attached to each frame as BlockAdditions (AlphaMode 1), the same layout Chrome records.
async function encodeWebM({ times, w, h, s, transparent, signal }) {
  const codec = caps.webm;
  const color = [], alpha = [];
  let failure = null;
  const make = (sink) => new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      sink.push({ data, key: chunk.type === "key", ts: chunk.timestamp });
    },
    error: (e) => { failure = e; },
  });
  const bpp = 0.03 + (s.quality / 100) * 0.22; // bits per pixel per frame
  const config = { codec, width: w, height: h, framerate: s.fps, bitrate: Math.round(w * h * s.fps * bpp) };
  const enc = make(color);
  enc.configure(config);
  const encA = transparent ? make(alpha) : null;
  encA?.configure({ ...config, bitrate: Math.round(config.bitrate / 3) });
  const step = 1e6 / s.fps;
  const ySize = w * h, cSize = (w / 2) * (h / 2);
  try {
    await renderFrames(times, signal, async (px, i) => {
      if (failure) throw failure;
      const timestamp = Math.round(i * step), duration = Math.round(step);
      const keyFrame = i % Math.max(1, s.fps * 2) === 0;
      const frame = new VideoFrame(px, { format: "RGBX", codedWidth: w, codedHeight: h, timestamp, duration });
      enc.encode(frame, { keyFrame });
      frame.close();
      if (encA) {
        const yuv = new Uint8Array(ySize + 2 * cSize);
        for (let p = 0; p < ySize; p++) yuv[p] = px[p * 4 + 3];
        yuv.fill(128, ySize);
        const af = new VideoFrame(yuv, { format: "I420", codedWidth: w, codedHeight: h, timestamp, duration });
        encA.encode(af, { keyFrame });
        af.close();
      }
      while (enc.encodeQueueSize > 4 || (encA && encA.encodeQueueSize > 4)) await new Promise((r) => setTimeout(r, 5));
    });
    setProgress(1, "Finishing video…");
    await enc.flush();
    await encA?.flush();
    if (failure) throw failure;
  } finally {
    if (enc.state !== "closed") enc.close();
    if (encA && encA.state !== "closed") encA.close();
  }
  if (transparent && alpha.length !== color.length) throw new Error("The alpha stream came out a different length.");
  return muxWebM({ w, h, fps: s.fps, codecId: codec.startsWith("vp09") ? "V_VP9" : "V_VP8", color, alpha: transparent ? alpha : null });
}

// EBML helpers
function ebmlId(id) {
  const out = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
  return new Uint8Array(out);
}
function ebmlSize(n) {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const out = new Uint8Array(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { out[i] = v & 255; v = Math.floor(v / 256); }
      out[0] |= 1 << (8 - len);
      return out;
    }
  }
  throw new Error("EBML element too large");
}
const ebmlUint = (v) => {
  const out = [];
  do { out.unshift(v & 255); v = Math.floor(v / 256); } while (v > 0);
  return new Uint8Array(out);
};
const ebmlFloat = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return b; };
const el = (id, data) => concat([ebmlId(id), ebmlSize(data.length), data]);
const elU = (id, v) => el(id, ebmlUint(v));
const elS = (id, str) => el(id, ascii(str));
const elM = (id, ...children) => el(id, concat(children));
const i16 = (v) => new Uint8Array([(v >> 8) & 255, v & 255]);

function muxWebM({ w, h, fps, codecId, color, alpha }) {
  const frameMs = 1000 / fps;
  const header = elM(0x1a45dfa3,
    elU(0x4286, 1), elU(0x42f7, 1), elU(0x42f2, 4), elU(0x42f3, 8),
    elS(0x4282, "webm"), elU(0x4287, 4), elU(0x4285, 2));
  const info = elM(0x1549a966,
    elU(0x2ad7b1, 1000000), elS(0x4d80, "ba-model-viewer"), elS(0x5741, "ba-model-viewer"),
    el(0x4489, ebmlFloat(color.length * frameMs)));
  const video = elM(0xe0, elU(0xb0, w), elU(0xba, h), ...(alpha ? [elU(0x53c0, 1)] : []));
  const tracks = elM(0x1654ae6b, elM(0xae,
    elU(0xd7, 1), elU(0x73c5, 1), elU(0x83, 1), elU(0x9c, 0), elS(0x86, codecId),
    ...(alpha ? [elU(0x55ee, 1)] : []), video));
  // one cluster per key frame (key frames come every 2 s, so relative times fit in 16 bits)
  const clusters = [];
  let cur = null;
  color.forEach((f, i) => {
    const ms = Math.round(f.ts / 1000);
    if (!cur || f.key) { cur = { start: ms, blocks: [] }; clusters.push(cur); }
    const rel = ms - cur.start;
    if (!alpha) {
      cur.blocks.push(el(0xa3, concat([new Uint8Array([0x81]), i16(rel), new Uint8Array([f.key ? 0x80 : 0]), f.data])));
    } else {
      const block = el(0xa1, concat([new Uint8Array([0x81]), i16(rel), new Uint8Array([0]), f.data]));
      const more = elM(0x75a1, elM(0xa6, elU(0xee, 1), el(0xa5, alpha[i].data)));
      const ref = f.key ? [] : [el(0xfb, i16(-Math.round(frameMs)))];
      cur.blocks.push(elM(0xa0, block, more, ...ref));
    }
  });
  const body = concat([info, tracks, ...clusters.map((c) => elM(0x1f43b675, elU(0xe7, c.start), ...c.blocks))]);
  return new Blob([header, el(0x18538067, body)], { type: "video/webm" });
}
