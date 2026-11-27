import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const CACHE_NAME = "ba-models-v1";
const $ = (id) => document.getElementById(id);
const fmtMB = (b) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`;

// ---------- storage (Cache Storage, with graceful fallback) ----------
let cachePromise = null;
function openCache() {
  if (!cachePromise) {
    cachePromise = ("caches" in window ? caches.open(CACHE_NAME) : Promise.reject(new Error("no Cache Storage")))
      .catch((e) => { console.warn("[cache] unavailable, models will not be kept:", e); return null; });
  }
  return cachePromise;
}
async function cacheGet(url) {
  try { const c = await openCache(); return c ? await c.match(url) : undefined; } catch { return undefined; }
}
async function cachePut(url, blob) {
  try {
    const c = await openCache();
    if (c) await c.put(url, new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } }));
  } catch (e) { console.warn("[cache] could not store", url, e); }
}
async function cacheDelete(url) {
  try { const c = await openCache(); if (c) await c.delete(url); } catch {}
}
async function cachedUrls() {
  try { const c = await openCache(); return c ? (await c.keys()).map((r) => r.url) : []; } catch { return []; }
}
let askedPersist = false;
function requestPersist() {
  if (askedPersist) return;
  askedPersist = true;
  try { navigator.storage?.persist?.(); } catch {}
}

// ---------- theme: system / light / dark (the 3D background colour is separate) ----------
const THEME_KEY = "ba-viewer-theme";
const THEMES = ["system", "light", "dark"];
const THEME_ICON = { system: "◐", light: "☀", dark: "☾" };
let theme = "system";
function setTheme(t, save = true) {
  theme = THEMES.includes(t) ? t : "system";
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $("theme-toggle").textContent = THEME_ICON[theme];
  $("theme-toggle").title = `Theme: ${theme} (T)`;
  if (save) try { theme === "system" ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, theme); } catch {}
}
try { setTheme(localStorage.getItem(THEME_KEY) || "system", false); } catch { setTheme("system", false); }
const cycleTheme = () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
$("theme-toggle").addEventListener("click", cycleTheme);

// ---------- manifest ----------
const manifest = await fetch("./models.json").then((r) => r.json());
const models = manifest.models;
const byName = new Map(models.map((m) => [m.name, m]));
const modelUrl = (m) =>
  `https://raw.githubusercontent.com/${manifest.repo}/${manifest.commit}/${encodeURIComponent(m.file)}`;
const iconUrl = (m) => (m?.icon != null ? `./icons/${m.icon}.webp` : null);

const cached = new Set(); // model names fully downloaded

async function refreshCacheState() {
  const urls = new Set(await cachedUrls());
  cached.clear();
  for (const m of models) if (urls.has(modelUrl(m))) cached.add(m.name);
  let text = `${cached.size} downloaded`;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) text += ` · ${fmtMB(est.usage)}`;
  } catch {}
  $("storage").textContent = text;
  renderList();
}

// ---------- selection state ----------
let current = null;      // model entry being shown
let motionSrc = null;    // model entry whose animations are used (null = the model's own)
let pickMode = "model";  // what a click in the list picks

function setPickMode(mode) {
  pickMode = mode;
  $("tab-model").setAttribute("aria-selected", String(mode === "model"));
  $("tab-motion").setAttribute("aria-selected", String(mode === "motion"));
  $("sidebar").classList.toggle("motion-mode", mode === "motion");
  $("pick-hint").textContent = mode === "model"
    ? "Pick the student to show."
    : `Pick whose animations ${current ? current.name : "the model"} should use.`;
  renderList();
}
$("tab-model").addEventListener("click", () => setPickMode("model"));
$("tab-motion").addEventListener("click", () => setPickMode("motion"));

// ---------- student list ----------
function renderList() {
  const q = $("search").value.trim().toLowerCase();
  const onlyCached = $("cached-only").checked;
  const list = $("list");
  list.replaceChildren();
  const selected = pickMode === "model" ? current : (motionSrc ?? current);
  if (pickMode === "motion" && current && !q) {
    const li = document.createElement("li");
    const own = document.createElement("button");
    own.className = "own";
    own.dataset.own = "1";
    own.setAttribute("aria-selected", String(!motionSrc));
    own.textContent = `Use ${current.name}'s own motions`;
    li.append(own);
    list.append(li);
  }
  let group = null, lastBase = null;
  for (const m of models) {
    if (q && !m.name.toLowerCase().includes(q)) continue;
    if (onlyCached && !cached.has(m.name)) continue;
    if (m.mergedInto) continue; // same 3D model as another entry; its animations are merged into that one
    if (m.base !== lastBase) {
      lastBase = m.base;
      group = document.createElement("li");
      group.className = "group";
      const h = document.createElement("div");
      h.className = "base";
      h.textContent = m.base;
      group.append(h);
      list.append(group);
    }
    const b = document.createElement("button");
    b.className = "item" + (m === current ? " is-model" : "");
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", String(selected === m && !(pickMode === "motion" && !motionSrc)));
    b.dataset.name = m.name;
    let thumb;
    if (iconUrl(m)) {
      thumb = document.createElement("img");
      thumb.src = iconUrl(m);
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.decoding = "async";
    } else {
      thumb = document.createElement("span");
      thumb.textContent = m.base.slice(0, 2);
    }
    thumb.className = "thumb";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = m.variant || "Default";
    b.append(thumb, label);
    if (pickMode === "motion" && m === current) {
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = "model";
      b.append(t);
    } else if (pickMode === "model" && m === motionSrc) {
      const t = document.createElement("span");
      t.className = "tag";
      t.textContent = "motion";
      b.append(t);
    }
    const meta = document.createElement("span");
    meta.className = "meta" + (cached.has(m.name) ? " cached" : "");
    meta.textContent = cached.has(m.name) ? "saved" : fmtMB(m.size);
    b.append(meta);
    group.append(b);
  }
  if (!list.querySelector("button.item")) {
    const li = document.createElement("li");
    li.className = "muted";
    li.style.padding = "8px";
    li.textContent = onlyCached && !q ? "Nothing downloaded yet." : "No matches.";
    list.append(li);
  }
}
$("list").addEventListener("click", (e) => {
  if (e.target.closest("button.own")) {
    $("sidebar").classList.remove("open");
    load(current, null);
    return;
  }
  const b = e.target.closest("button.item");
  if (!b) return;
  const m = byName.get(b.dataset.name);
  $("sidebar").classList.remove("open");
  if (pickMode === "model") load(m, motionSrc);
  else load(current ?? m, m === current ? null : m);
});
$("search").addEventListener("input", renderList);
$("cached-only").addEventListener("change", renderList);
// Sidebar: a slide-over on phones ("open"); on wider screens it can be hidden ("side-hidden", remembered).
const SIDE_KEY = "ba-viewer-sidebar-hidden";
function setSidebar(show) {
  $("sidebar").classList.toggle("open", show);
  $("app").classList.toggle("side-hidden", !show);
  try { show ? localStorage.removeItem(SIDE_KEY) : localStorage.setItem(SIDE_KEY, "1"); } catch {}
}
try { if (localStorage.getItem(SIDE_KEY)) $("app").classList.add("side-hidden"); } catch {}
// Control panel: can be hidden to see the whole model (remembered).
const CONTROLS_KEY = "ba-viewer-controls-hidden";
function setControls(show) {
  $("app").classList.toggle("controls-hidden", !show);
  try { show ? localStorage.removeItem(CONTROLS_KEY) : localStorage.setItem(CONTROLS_KEY, "1"); } catch {}
}
try { if (localStorage.getItem(CONTROLS_KEY)) $("app").classList.add("controls-hidden"); } catch {}
$("hide-controls").addEventListener("click", () => setControls(false));
$("show-controls").addEventListener("click", () => setControls(true));
$("open-side").addEventListener("click", () => setSidebar(true));
$("close-side").addEventListener("click", () => setSidebar(false));
$("chip-model").addEventListener("click", () => { setPickMode("model"); setSidebar(true); $("search").focus(); });
$("chip-motion").addEventListener("click", () => { setPickMode("motion"); setSidebar(true); $("search").focus(); });
$("reset-motion").addEventListener("click", () => load(current, null));

// ---------- three.js scene ----------
const canvas = $("canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const BG_KEY = "ba-viewer-bg";
const BG_DEFAULT = $("bg").defaultValue;
try {
  const saved = localStorage.getItem(BG_KEY);
  if (saved && /^#[0-9a-f]{6}$/i.test(saved)) $("bg").value = saved;
} catch {}
scene.background = new THREE.Color($("bg").value);
const PROPS_KEY = "ba-viewer-props";
try {
  const saved = localStorage.getItem(PROPS_KEY);
  if (["all", "noacc", "none"].includes(saved)) $("props").value = saved;
} catch {}
const HALO_KEY = "ba-viewer-halo";
try {
  const saved = localStorage.getItem(HALO_KEY);
  if (["model", "motion", "off"].includes(saved)) $("halo").value = saved;
} catch {}
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
camera.position.set(0, 1, 4);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa6b8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(1.5, 3, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const gradientMap = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;

const outlineUniforms = { uWidth: { value: 1.6 }, uRes: { value: new THREE.Vector2(1, 1) } };
// Lambert always computes (skinned) object normals, which the outline offset needs; black base + emissive = flat colour
const outlineMaterial = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: 0x2a2228, side: THREE.BackSide });
outlineMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, outlineUniforms);
  shader.vertexShader = shader.vertexShader
    .replace("void main() {", "uniform float uWidth;\nuniform vec2 uRes;\nvoid main() {")
    .replace("#include <project_vertex>", `#include <project_vertex>
      vec3 oN = normalize(normalMatrix * objectNormal);
      vec2 cN = (projectionMatrix * vec4(oN, 0.0)).xy;
      if (dot(cN, cN) > 1e-8) gl_Position.xy += normalize(cN) * (2.0 * uWidth / uRes) * gl_Position.w;`);
};

function resize() {
  const { clientWidth: w, clientHeight: h } = $("stage");
  const panel = $("controls");
  const ph = panel.offsetHeight ? panel.offsetHeight + 12 : 0; // 0 while hidden
  camera.setViewOffset(w, h, 0, Math.round(ph / 2), w, h);
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  outlineUniforms.uRes.value.set(w * pr, h * pr);
  outlineUniforms.uWidth.value = 1.3 * pr;
}
const ro = new ResizeObserver(resize);
ro.observe($("stage"));
ro.observe($("controls"));
resize();

// ---------- downloading ----------
let abortCtl = null;
async function download(m, onProgress, signal) {
  const url = modelUrl(m);
  const hit = await cacheGet(url);
  if (hit) return hit.arrayBuffer();
  requestPersist();
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || m.size;
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got, total);
  }
  const blob = new Blob(chunks, { type: "model/gltf-binary" });
  await cachePut(url, blob);
  cached.add(m.name);
  return blob.arrayBuffer();
}

// ---------- puppets: one loaded student model, prepared for display ----------
const PROP_NAME = /weapon|prop|gun|grenade|bomb|book|cake|gamepad|mouse|bag|food|shield|wheelchair|bike|cycle|mount|cockpit|bullet|brush|health|toggle|diary|flowerpot|balloon|parchment|pike|chain|dron|calculator|instrument|tank|truck|car_|drill|turret|rocket|firework|cheer|paper|letter|leaflet|pad|item|coin|ticket|punch|fist|stamp|candy|dessert|pie|milk|hotdog|corndog|hamburger|macaron|bowl|fish|cat|rabbit|telescope|spanner|shuriken|frypan|hipflask|firecracker|gohei|hagoita|dango|tube|tapwater|haniwa|pillow|parts|platform|map_|banana|seahouse|hive|magazine|amp|bass|mike|ex\d|trail|star/i;
const BODY_NAME = /body|face|hair|eyemouth|eyebrow|^mouth_|halo|_eye|_mesh$/i;
const MOUTH = /^Mouth_(\d+(?:_Flipped)?)$/i;

function isProp(o) {
  const mats = [o.material].flat().map((m) => m?.name ?? "").join(" ");
  if (MOUTH.test(o.name) || /halo/i.test(o.name)) return false;
  if (PROP_NAME.test(o.name) && !/body|face|hair/i.test(o.name)) return true;
  return !BODY_NAME.test(o.name + " " + mats);
}

function makePuppet(gltf, entry) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bones = new Map(); // name -> bone
  const rest = new Map();  // bone -> rest transforms (local + world), captured before any animation
  root.traverse((o) => {
    if (!o.isBone || bones.has(o.name)) return;
    bones.set(o.name, o);
    rest.set(o, {
      p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(),
      wp: o.getWorldPosition(new THREE.Vector3()), wq: o.getWorldQuaternion(new THREE.Quaternion()),
      w: o.matrixWorld.clone(), pw: o.parent ? o.parent.matrixWorld.clone() : new THREE.Matrix4(),
    });
  });
  const head = bones.get("Bip001_Head");
  const feet = ["Bip001_L_Foot", "Bip001_R_Foot"].map((n) => bones.get(n)).filter(Boolean);
  const floor = feet.length ? Math.min(...feet.map((f) => rest.get(f).wp.y)) : 0;
  const height = head ? Math.max(0.01, rest.get(head).wp.y - floor) : 1;

  const p = { entry, root, bones, rest, height, mixer: new THREE.AnimationMixer(root), clips: gltf.animations,
              toonables: [], outlines: [], props: [], mouths: new Map(), haloMeshes: [], haloRoots: [], optional: [],
              accessories: [],
              head, hips: bones.get("Bip001_Pelvis") };
  const meshes = [];
  const underHalo = (o) => { for (let a = o; a && a !== root; a = a.parent) if (/halo/i.test(a.name)) return true; return false; };
  root.traverse((o) => {
    if (o.isMesh) meshes.push(o);
    if (o.isMesh && !o.userData.isOutline && underHalo(o)) p.haloMeshes.push(o);
    // the top of each halo branch (usually a node hanging off the head bone)
    if (/halo/i.test(o.name) && !underHalo(o.parent) && !o.isSkinnedMesh) p.haloRoots.push({ obj: o, parent: o.parent });
  });
  for (const o of [...meshes]) {
    if (MOUTH.test(o.name) || isProp(o) || underHalo(o)) continue;
    const acc = splitAccessories(o);
    if (acc) { meshes.push(acc); p.accessories.push(acc); }
  }
  for (const o of meshes) {
    o.castShadow = true;
    o.frustumCulled = false;
    const m = o.name.match(MOUTH);
    if (m && o.morphTargetInfluences) p.mouths.set(m[1], o);
    else if (!o.userData.accessory && isProp(o)) p.props.push(o);
    const src = o.material;
    o.userData.origMat = src;
    o.userData.toonMat = toonFor(src, /halo/i.test(src.name + " " + o.name));
    p.toonables.push(o);
    const faceDetail = src.alphaTest > 0 || src.transparent || /eye|mouth|brow|halo/i.test(src.name + " " + o.name);
    if (!faceDetail) p.outlines.push(addOutline(o));
  }
  // Optional props (marked in the GLB extras, e.g. Hoshino's shield) only appear while the playing
  // clip animates their own bones.
  for (const o of meshes) {
    let optRoot = null;
    for (let a = o; a && a !== root; a = a.parent) if (a.userData?.optional) { optRoot = a; break; }
    if (!optRoot) continue;
    const targets = new Set();
    for (let a = o; a && a !== optRoot.parent; a = a.parent) if (a.name) targets.add(a.name);
    for (const b of o.skeleton?.bones ?? []) {
      for (let a = b; a?.isBone && !isBodyBone(a); a = a.parent) targets.add(a.name);
    }
    p.optional.push({ mesh: o, targets });
  }
  return p;
}
const isBodyBone = (b) => /^Bip001/i.test(b.name) && !/weapon/i.test(b.name);

// Accessories baked into a body mesh (e.g. Shokuhou Misaki's bag): triangles skinned only to bones that
// hang off the model's root instead of the body skeleton. They're split into their own mesh so they can be
// hidden. Returns the new mesh, or null if the mesh has none.
function splitAccessories(o) {
  if (!o.isSkinnedMesh) return null;
  // clothing can also hang off the root (dress panels, coats, scarves, shoes): never treat it as an accessory
  const CLOTHING = /dress|coat|scarf|shoe|skirt|cloth|cape|ribbon|tail|sleeve|hair|hood|collar|tie/i;
  const detached = o.skeleton.bones.map((b) => {
    for (let a = b; a?.isBone; a = a.parent) if (/^Bip001/i.test(a.name) || CLOTHING.test(a.name)) return false;
    return true;
  });
  if (!detached.some(Boolean)) return null;
  const g = o.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const onDetached = new Uint8Array(si.count);
  for (let i = 0; i < si.count; i++) {
    let w = 0;
    for (let c = 0; c < si.itemSize; c++) if (detached[si.getComponent(i, c)]) w += sw.getComponent(i, c);
    onDetached[i] = w > 0.999 ? 1 : 0;
  }
  const index = g.index ? Array.from(g.index.array) : Array.from({ length: si.count }, (_, i) => i);
  const keep = [], take = [];
  for (let t = 0; t + 2 < index.length; t += 3) {
    const tri = [index[t], index[t + 1], index[t + 2]];
    (tri.every((v) => onDetached[v]) ? take : keep).push(...tri);
  }
  if (!take.length || !keep.length) return null; // nothing to split, or the whole mesh is an accessory
  const part = new THREE.BufferGeometry();
  for (const [k, v] of Object.entries(g.attributes)) part.setAttribute(k, v);
  part.morphAttributes = g.morphAttributes;
  part.morphTargetsRelative = g.morphTargetsRelative;
  part.setIndex(take);
  g.setIndex(keep);
  const mesh = new THREE.SkinnedMesh(part, o.material);
  mesh.name = o.name + "_accessory";
  mesh.bind(o.skeleton, o.bindMatrix);
  mesh.bindMode = o.bindMode;
  mesh.position.copy(o.position); mesh.quaternion.copy(o.quaternion); mesh.scale.copy(o.scale);
  mesh.userData.accessory = true;
  o.parent.add(mesh);
  return mesh;
}
const clipNodes = new WeakMap();
function nodesOf(clip) {
  let set = clipNodes.get(clip);
  if (!set) {
    set = new Set(clip.tracks.map((t) => THREE.PropertyBinding.parseTrackName(t.name).nodeName));
    clipNodes.set(clip, set);
  }
  return set;
}
// Props option: "all", "noacc" (hide accessories like bags), "none" (also hide weapons/held props).
function applyOptionalProps() {
  const d = driver();
  if (!d) return;
  const mode = $("props").value;
  const nodes = action ? nodesOf(action.getClip()) : new Set();
  const optional = new Set(d.optional.map((x) => x.mesh));
  for (const o of d.props) if (!optional.has(o)) o.visible = mode !== "none";
  for (const { mesh, targets } of d.optional) {
    const allowed = (!swap || d.props.includes(mesh)) && !(mode === "none" && d.props.includes(mesh));
    let hit = false;
    for (const n of targets) if (nodes.has(n)) { hit = true; break; }
    mesh.visible = allowed && hit;
  }
  for (const o of model.accessories) o.visible = mode === "all";
}

// Eye bones (eyelids, eye shapes): their movement is mapped through head space and scaled by eye size.
const EYE_BONE = /^(?:bip001)?(?:eye[lr][12]?|boneeyed[lr](?:01|02)?)$/;
const normName = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
function eyeSize(p, side) {
  const inv = p.rest.get(p.head).w.clone().invert();
  const box = new THREE.Box3();
  for (const [name, b] of p.bones) {
    const n = normName(name);
    if (EYE_BONE.test(n) && new RegExp(`eyed?${side}`).test(n)) box.expandByPoint(p.rest.get(b).wp.clone().applyMatrix4(inv));
  }
  return box.isEmpty() ? null : box.getSize(new THREE.Vector3());
}

function toonFor(src, unlit) {
  const t = new (unlit ? THREE.MeshBasicMaterial : THREE.MeshToonMaterial)({
    map: src.map ?? null,
    color: src.color?.clone() ?? new THREE.Color(1, 1, 1),
    ...(unlit ? {} : { gradientMap }),
    side: src.side, transparent: src.transparent, alphaTest: src.alphaTest, depthWrite: src.depthWrite,
  });
  t.name = src.name;
  return t;
}

function addOutline(o) {
  let line;
  if (o.isSkinnedMesh) {
    line = new THREE.SkinnedMesh(o.geometry, outlineMaterial);
    line.bind(o.skeleton, o.bindMatrix);
    line.bindMode = o.bindMode;
  } else {
    line = new THREE.Mesh(o.geometry, outlineMaterial);
  }
  if (o.morphTargetInfluences) line.morphTargetInfluences = o.morphTargetInfluences;
  line.userData.isOutline = true;
  line.frustumCulled = false;
  o.add(line);
  return line;
}

function disposePuppet(p) {
  if (!p) return;
  p.mixer.stopAllAction();
  p.mixer.uncacheRoot(p.root);
  p.root.removeFromParent();
  const mats = new Set(), texs = new Set();
  p.root.traverse((o) => {
    if (o.geometry && !o.userData.isOutline && !o.userData.borrowed) o.geometry.dispose();
    for (const m of [o.material, o.userData.origMat, o.userData.toonMat].flat()) {
      if (!m || m === outlineMaterial) continue;
      mats.add(m);
      if (!o.userData.borrowed) for (const v of Object.values(m)) if (v?.isTexture) texs.add(v);
    }
  });
  mats.forEach((m) => m.dispose());
  texs.forEach((t) => t !== gradientMap && t.dispose());
}

// ---------- motion swap: the donor plays its own animation; its pose is copied onto the model ----------
// Rotations are transferred in world space relative to each skeleton's rest pose, so differing bone
// orientations and proportions both work. The donor's props (weapons etc.) are shown in place of the
// model's, and the model's mouth plays the donor's mouth timing using the donor's mouth textures.
const isUnder = (o, anc) => { for (let a = o.parent; a; a = a.parent) if (a === anc) return true; return false; };
// Maps a local offset in the donor bone's parent space into the model bone's parent space, via a
// reference bone (hips or head) and a scale between the two skeletons.
function positionBasis(tr, sr, tRefW, sRefW, scale) {
  const m = tr.pw.clone().invert()
    .multiply(tRefW)
    .multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
    .multiply(sRefW.clone().invert())
    .multiply(sr.pw);
  return new THREE.Matrix3().setFromMatrix4(m);
}

function bindSwap(model, donor) {
  const ratio = model.height / donor.height;
  const headW = [model.head && model.rest.get(model.head).w, donor.head && donor.rest.get(donor.head).w];
  const hipsW = [model.hips && model.rest.get(model.hips).w, donor.hips && donor.rest.get(donor.hips).w];
  const eyeRatio = {};
  for (const side of ["l", "r"]) {
    const a = model.head && eyeSize(model, side), b = donor.head && eyeSize(donor, side);
    eyeRatio[side] = new THREE.Vector3(1, 1, 1);
    if (a && b) for (const k of ["x", "y", "z"]) eyeRatio[side][k] = b[k] > 1e-5 ? THREE.MathUtils.clamp(a[k] / b[k], 0.25, 4) : 1;
  }
  const order = [];
  model.root.traverse((o) => {
    if (!o.isBone || model.bones.get(o.name) !== o) return;
    const src = donor.bones.get(o.name);
    if (!src) { order.push({ t: o, src: null }); return; }
    const tr = model.rest.get(o), sr = donor.rest.get(src);
    const entry = { t: o, src, tr, sr, delta: sr.wq.clone().invert().multiply(tr.wq) }; // inv(srcRestW) * tgtRestW
    const eye = EYE_BONE.test(normName(o.name)) && model.head && donor.head;
    if (o === model.hips && donor.hips) entry.mode = "hips";
    else if (eye) entry.basis = positionBasis(tr, sr, headW[0], headW[1], eyeRatio[/eyed?l/.test(normName(o.name)) ? "l" : "r"]);
    else if (model.hips && donor.hips && isUnder(o, model.hips) && isUnder(src, donor.hips))
      entry.basis = positionBasis(tr, sr, hipsW[0], hipsW[1], new THREE.Vector3(ratio, ratio, ratio));
    order.push(entry);
  });

  // The model's own idle drives anything the donor has no bone for (unique hair, tails, accessories).
  const matched = new Set(order.filter((m) => m.src).map((m) => m.t.name));
  const idle = ["Cafe_Idle", "Normal_Idle", "Formation_Idle"].map((n) => model.clips.find((c) => c.name === n)).find(Boolean)
    ?? model.clips[0];
  let idleClip = null;
  if (idle) {
    const tracks = idle.tracks.filter((t) => {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(t.name);
      return propertyName !== "morphTargetInfluences" && !matched.has(nodeName);
    });
    idleClip = new THREE.AnimationClip("__idle", idle.duration, tracks);
    model.mixer.clipAction(idleClip).play();
  }

  // Props: hide the model's, show only the donor's props (the donor's body stays hidden).
  for (const o of model.props) o.visible = false;
  donor.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.visible = false; });
  for (const o of donor.props) o.visible = true;
  scene.add(donor.root);

  // Mouths: one copy of the model's mouth quad per donor mouth shape, textured with the donor's texture.
  const mouths = [];
  const quad = model.mouths.values().next().value;
  if (quad && donor.mouths.size) {
    for (const o of model.mouths.values()) o.visible = false;
    for (const [code, dm] of donor.mouths) {
      const orig = quad.userData.origMat.clone();
      orig.map = dm.userData.origMat.map;
      const toon = quad.userData.toonMat.clone();
      toon.map = dm.userData.origMat.map;
      const mesh = new THREE.SkinnedMesh(quad.geometry, orig);
      mesh.bind(quad.skeleton, quad.bindMatrix);
      mesh.bindMode = quad.bindMode;
      mesh.position.copy(quad.position); mesh.quaternion.copy(quad.quaternion); mesh.scale.copy(quad.scale);
      mesh.morphTargetDictionary = quad.morphTargetDictionary;
      mesh.morphTargetInfluences = [1];
      mesh.name = "borrowed_Mouth_" + code;
      mesh.frustumCulled = false;
      mesh.userData = { borrowed: true, origMat: orig, toonMat: toon };
      quad.parent.add(mesh);
      mouths.push({ mesh, src: dm, code });
    }
  }
  const lids = buildLids(model, donor);
  return { donor, ratio, order, idleClip, mouths, lids };
}

// ---------- eyelids ----------
// Students' face rigs differ: some (e.g. Hoshino) close an eye by moving/rotating only the main lid bones,
// others also animate the lid's corner child bones. When the two rigs differ, each eye is mapped by how
// *closed* it is rather than by raw bone offsets:
//  - closure is measured on the actual eyelid vertices (how far they move toward closed, in head space);
//  - an eye = upper lid group (eye_X + corners) and lower lid group (bone_eye_D_X + corners);
//  - the donor's current closure is a fraction of its own most-closed pose (from its own clips), and the
//    model's lid bones are blended toward the model's own most-closed pose by the same amount, keeping
//    the donor's balance between upper and lower lid (so winks and smiling eyes still meet in the middle).
const EYES = [["Bip001_eye_L", "Bip001_bone_eye_D_L"], ["Bip001_eye_R", "Bip001_bone_eye_D_R"]];
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _lv = new THREE.Vector3();

// one lid group: bone + its child bones, with eyelid vertex samples and a closure function
function lidGroup(p, name, dir) {
  const bone = p.bones.get(name);
  if (!bone || !bone.parent?.isBone) return null;
  const head = bone.parent;
  const group = [bone, ...bone.children.filter((c) => c.isBone)];
  const headInv = p.rest.get(head).w.clone().invert();
  const restInv = group.map((b) => headInv.clone().multiply(p.rest.get(b).w).invert());
  const dirH = new THREE.Vector3(0, 1, 0).applyQuaternion(p.rest.get(head).wq.clone().invert()).multiplyScalar(dir);
  const samples = [];
  p.root.traverse((o) => {
    if (!o.isSkinnedMesh || o.userData.isOutline) return;
    const idx = group.map((b) => o.skeleton.bones.indexOf(b));
    if (idx.every((i) => i < 0)) return;
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    for (let i = 0; i < si.count; i++) {
      const ws = new Array(group.length).fill(0);
      let tot = 0;
      for (let c = 0; c < si.itemSize; c++) {
        const g = idx.indexOf(si.getComponent(i, c));
        if (g >= 0) { const w = sw.getComponent(i, c); ws[g] += w; tot += w; }
      }
      if (tot < 0.3) continue;
      _lv.fromBufferAttribute(o.geometry.attributes.position, i);
      o.applyBoneTransform(i, _lv); // rest pose == bind pose at load time
      samples.push({ v0: _lv.clone().applyMatrix4(o.matrixWorld).applyMatrix4(headInv), ws, tot });
    }
  });
  if (!samples.length) return null;
  samples.sort((a, b) => b.tot - a.tot);
  samples.length = Math.min(samples.length, 48);
  const cur = group.map(() => new THREE.Matrix4());
  const closure = (locals) => {
    cur[0].compose(locals[0].p, locals[0].q, _one);
    for (let k = 1; k < group.length; k++) cur[k].multiplyMatrices(cur[0], _m.compose(locals[k].p, locals[k].q, _one));
    let sum = 0;
    for (const { v0, ws } of samples) {
      for (let g = 0; g < group.length; g++) {
        if (!ws[g]) continue;
        sum += ws[g] * _lv.copy(v0).applyMatrix4(_m2.multiplyMatrices(cur[g], restInv[g])).sub(v0).dot(dirH);
      }
    }
    return sum / samples.length;
  };
  const rest = group.map((b) => ({ p: p.rest.get(b).p.clone(), q: p.rest.get(b).q.clone() }));
  return { group, rest, closure, current: () => closure(group.map((b) => ({ p: b.position, q: b.quaternion }))) };
}

// an eye (upper + lower lid) and its most-closed pose in this student's own clips
function eyeRig(p, [upperName, lowerName]) {
  const up = lidGroup(p, upperName, -1), lo = lidGroup(p, lowerName, 1);
  if (!up || !lo) return null;
  const groups = [up, lo];
  const peaks = []; // most-closed moment of each clip
  let kidsMove = false;
  for (const clip of p.clips) {
    let best = null;
    const evals = groups.map((g) => g.group.map((b) => ({
      p: clip.tracks.find((t) => t.name === `${b.name}.position`)?.createInterpolant(),
      q: clip.tracks.find((t) => t.name === `${b.name}.quaternion`)?.createInterpolant(),
    })));
    const times = new Set();
    for (const g of groups) for (const b of g.group) for (const t of clip.tracks) if (t.name.startsWith(b.name + ".")) t.times.forEach((x) => times.add(x));
    for (const time of times) {
      const locals = groups.map((g, gi) => g.group.map((b, k) => {
        const e = evals[gi][k];
        return {
          p: e.p ? new THREE.Vector3().fromArray(e.p.evaluate(time)) : g.rest[k].p.clone(),
          q: e.q ? new THREE.Quaternion().fromArray(e.q.evaluate(time)).normalize() : g.rest[k].q.clone(),
        };
      }));
      // do the upper lid's corner bones ever move on their own? (rig style)
      if (!kidsMove) kidsMove = locals[0].slice(1).some((l, k) => l.p.distanceTo(up.rest[k + 1].p) > 1e-4 || Math.abs(l.q.dot(up.rest[k + 1].q)) < 0.9999);
      const cu = up.closure(locals[0]), cl = lo.closure(locals[1]);
      if (!best || cu + cl > best.cu + best.cl) best = { cu, cl, locals };
    }
    if (best) peaks.push(best);
  }
  // reference "closed eye": the median of the clips' peaks (single extremes overshoot; blinks, winks and
  // smiling eyes typically land around the median)
  const top = Math.max(0, ...peaks.map((b) => b.cu + b.cl));
  if (top < 1e-4) return null;
  const real = peaks.filter((b) => b.cu + b.cl > top * 0.4).sort((a, b) => a.cu + a.cl - (b.cu + b.cl));
  const best = real[Math.floor(real.length / 2)];
  return { up, lo, closed: best.locals, cu: Math.max(best.cu, 1e-4), cl: Math.max(best.cl, 1e-4), kidsMove };
}

function buildLids(model, donor) {
  const eyes = [];
  for (const names of EYES) {
    const t = eyeRig(model, names), d = eyeRig(donor, names);
    if (!t || !d || t.kidsMove === d.kidsMove) continue; // same style of rig: the direct transfer is best
    eyes.push({ t, d });
  }
  return eyes;
}

function applyLids(swap) {
  for (const { t, d } of swap.lids) {
    const u = d.up.current(), l = d.lo.current();
    // overall closure of the donor's eye; visibly shut eyes measure ~0.8-0.9 of the reference, so a small
    // gain makes them read as fully shut on the model too
    const F = Math.min(1.1, ((u + l) / (d.cu + d.cl)) * 1.15);
    const ru = u / d.cu, rl = l / d.cl;          // per-lid closure relative to the donor's closed pose
    const denom = ru * t.cu + rl * t.cl;
    const k = Math.abs(denom) > 1e-6 ? (F * (t.cu + t.cl)) / denom : 0;
    const cap = 1.15;
    let fu = THREE.MathUtils.clamp(ru * k, -0.3, cap), fl = THREE.MathUtils.clamp(rl * k, -0.3, cap);
    // if one lid hit its limit, let the other one make up the rest so the eye still closes as much
    const missing = F * (t.cu + t.cl) - (fu * t.cu + fl * t.cl);
    if (missing > 0) {
      if (fl >= cap) fu = Math.min(cap, fu + missing / t.cu);
      else if (fu >= cap) fl = Math.min(cap, fl + missing / t.cl);
    }
    [[t.up, t.closed[0], fu], [t.lo, t.closed[1], fl]].forEach(([g, closed, f]) => {
      g.group.forEach((b, i) => {
        b.position.lerpVectors(g.rest[i].p, closed[i].p, f);
        b.quaternion.slerpQuaternions(g.rest[i].q, closed[i].q, Math.max(0, f));
      });
    });
  }
}

function unbindSwap(model, swap) {
  if (!swap) return;
  for (const { obj, parent } of swap.donor.haloRoots) if (obj.parent !== parent) parent.add(obj);
  if (swap.idleClip) { model.mixer.uncacheAction(swap.idleClip); model.mixer.uncacheClip(swap.idleClip); }
  for (const { mesh } of swap.mouths) {
    mesh.removeFromParent();
    mesh.userData.origMat.dispose();
    mesh.userData.toonMat.dispose();
  }
  for (const o of model.props) o.visible = true;
  for (const o of model.mouths.values()) o.visible = true;
  // put every bone back to rest so nothing the donor moved sticks once the model's own clips run
  for (const [bone, r] of model.rest) { bone.position.copy(r.p); bone.quaternion.copy(r.q); bone.scale.copy(r.s); }
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
function applySwap(model, swap) {
  const { donor, ratio, order } = swap;
  donor.root.updateMatrixWorld(true);
  model.root.updateMatrixWorld(true);
  const wq = new Map();
  for (const m of order) {
    const t = m.t;
    let parentWQ = wq.get(t.parent);
    if (!parentWQ) { parentWQ = t.parent.getWorldQuaternion(new THREE.Quaternion()); wq.set(t.parent, parentWQ); }
    if (!m.src) { wq.set(t, parentWQ.clone().multiply(t.quaternion)); continue; }
    // rotation: donor's world-space change from rest, applied to the model's rest orientation
    const w = m.src.getWorldQuaternion(new THREE.Quaternion()).multiply(m.delta);
    wq.set(t, w);
    t.quaternion.copy(_q.copy(parentWQ).invert().multiply(w));
    // translation: hips follow the donor's movement scaled to the model's height; other body and eye
    // bones take the donor's offset from rest, mapped into the model's space; the rest keep their rest offset
    if (m.mode === "hips") {
      m.src.getWorldPosition(_v).sub(m.sr.wp).multiplyScalar(ratio).add(m.tr.wp);
      t.position.copy(t.parent.worldToLocal(_v));
    } else if (m.basis) {
      t.position.copy(_v.copy(m.src.position).sub(m.sr.p).applyMatrix3(m.basis)).add(m.tr.p);
    } else {
      t.position.copy(m.tr.p);
    }
    // scale: relative to rest (the game hides/shows parts by scaling bones)
    for (const k of ["x", "y", "z"]) {
      t.scale[k] = m.tr.s[k] * (Math.abs(m.sr.s[k]) > 1e-6 ? m.src.scale[k] / m.sr.s[k] : 1);
    }
  }
  applyLids(swap);
  for (const { mesh, src } of swap.mouths) {
    const w = src.morphTargetInfluences[0];
    mesh.morphTargetInfluences[0] = w;
  }
}

// ---------- state ----------
let model = null;   // puppet being shown
let swap = null;    // { donor, ... } when another student's motion is used
let action = null;  // the playing AnimationAction (on the donor when swapping)
let playing = true;
let loadToken = 0;
const driver = () => swap?.donor ?? model;

function show(id) {
  for (const x of ["empty", "loading", "error"]) $(x).classList.toggle("hidden", x !== id);
}

async function parseModel(entry, signal, progress) {
  const buf = await download(entry, progress, signal);
  const gltf = await new GLTFLoader().parseAsync(buf, "");
  // merged duplicates: same model, extra animations -> add their clips, labelled "Clip (Label)"
  for (const { name, label } of entry.extras ?? []) {
    const extra = byName.get(name);
    if (!extra) continue;
    try {
      $("loading-text").textContent = `Loading extra animations (${label})…`;
      const eb = await download(extra, null, signal);
      const eg = await new GLTFLoader().parseAsync(stripGlb(eb), "");
      const nodes = new Map();
      gltf.scene.traverse((o) => o.name && !nodes.has(o.name) && nodes.set(o.name, o));
      const fits = (t) => {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(t.name);
        const node = nodes.get(nodeName);
        return node && (propertyName !== "morphTargetInfluences" || node.morphTargetInfluences);
      };
      for (const clip of eg.animations) {
        const tracks = clip.tracks.filter(fits);
        gltf.animations.push(new THREE.AnimationClip(`${clip.name} (${label})`, clip.duration, tracks));
      }
      eg.scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    } catch (e) {
      if (e.name === "AbortError") throw e;
      console.warn(`[merge] couldn't load animations from ${name}:`, e);
    }
  }
  return gltf;
}

// Remove images/materials from a GLB so it parses fast when only its animations are needed.
function stripGlb(buf) {
  const jsonLen = new DataView(buf).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  for (const k of ["images", "textures", "samplers", "materials"]) delete json[k];
  for (const mesh of json.meshes ?? []) for (const p of mesh.primitives) delete p.material;
  let text = JSON.stringify(json);
  while (new TextEncoder().encode(text).length % 4) text += " ";
  const jsonBytes = new TextEncoder().encode(text);
  const rest = new Uint8Array(buf, 20 + jsonLen);
  const out = new Uint8Array(20 + jsonBytes.length + rest.length);
  const dv = new DataView(out.buffer);
  out.set(new Uint8Array(buf, 0, 12));
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  out.set(rest, 20 + jsonBytes.length);
  return out.buffer;
}

// Load a model and/or a motion source; keeps the current animation name when possible.
async function load(modelEntry, motionEntry, wantAnim) {
  if (!modelEntry) return;
  if (motionEntry === modelEntry) motionEntry = null;
  wantAnim ??= action?.getClip().name;
  const token = ++loadToken;
  abortCtl?.abort();
  abortCtl = new AbortController();
  const signal = abortCtl.signal;
  current = modelEntry;
  motionSrc = motionEntry;
  setPickMode(pickMode);
  const progress = (label) => (got, total) => {
    if (token !== loadToken) return;
    $("bar-fill").style.width = `${Math.min(100, (got / total) * 100)}%`;
    $("loading-text").textContent = `Downloading ${label}… ${fmtMB(got)} / ${fmtMB(total)}`;
  };
  const begin = (text) => {
    $("bar-fill").style.width = "0";
    $("loading-text").textContent = text;
    show("loading");
  };
  try {
    let newModel = null, newDonor = null;
    if (model?.entry !== modelEntry) {
      begin(`${cached.has(modelEntry.name) ? "Loading" : "Downloading"} ${modelEntry.name}…`);
      newModel = makePuppet(await parseModel(modelEntry, signal, progress(modelEntry.name)), modelEntry);
      if (token !== loadToken) return disposePuppet(newModel);
    }
    const keepDonor = motionEntry && swap?.donor.entry === motionEntry;
    if (motionEntry && !keepDonor) {
      begin(`${cached.has(motionEntry.name) ? "Loading" : "Downloading"} motions from ${motionEntry.name}…`);
      newDonor = makePuppet(await parseModel(motionEntry, signal, progress(`motions from ${motionEntry.name}`)), motionEntry);
      if (token !== loadToken) { disposePuppet(newModel); disposePuppet(newDonor); return; }
    }

    // tear down the old pairing, then build the new one
    const oldDonor = swap?.donor;
    if (model) unbindSwap(model, swap);
    swap = null;
    action = null;
    if (newModel) { disposePuppet(model); model = newModel; scene.add(model.root); model.needsFraming = true; }
    else model.mixer.stopAllAction();
    const donor = motionEntry ? (keepDonor ? oldDonor : newDonor) : null;
    if (oldDonor && oldDonor !== donor) disposePuppet(oldDonor);
    if (donor) { donor.mixer.stopAllAction(); swap = bindSwap(model, donor); }

    $("controls").classList.remove("hidden");
    setupMouthMenu();
    syncHaloOptions();
    applyLook();
    setClips(wantAnim);
    $("retarget-note").classList.add("hidden");
    updateChips();
    show(null);
    await refreshCacheState();
  } catch (e) {
    if (token !== loadToken || e.name === "AbortError") return;
    console.error(e);
    $("error").textContent = `Couldn't load: ${e.message}. Check your connection and try again.`;
    show("error");
  }
}

function setClips(wantAnim) {
  const clips = driver().clips;
  const sel = $("anim");
  sel.replaceChildren(...clips.map((c) => new Option(c.name, c.name)));
  if (!clips.length) sel.append(new Option("No animations", ""));
  sel.disabled = !clips.length;
  const pick = [wantAnim, "Cafe_Idle", "Normal_Idle", "Formation_Idle"].find((n) => n && clips.some((c) => c.name === n));
  playClip(pick ?? clips[0]?.name);
  if (model.needsFraming) { frameModel(); model.needsFraming = false; }
}

function setupMouthMenu() {
  const codes = swap?.mouths.length ? swap.mouths.map((m) => m.code) : [...model.mouths.keys()];
  $("mouth").replaceChildren(new Option("Animated", ""), ...codes.map((c) => new Option(c.replace("_Flipped", " (flipped)"), c)));
  $("mouth").disabled = !codes.length;
  $("mouth").value = "";
}

function updateChips() {
  const setChip = (id, entry, text) => {
    const img = $(id).querySelector("img");
    const u = iconUrl(entry);
    if (u) img.src = u; else img.removeAttribute("src");
    $(id).querySelector("b").textContent = text;
  };
  setChip("chip-model", current, current?.name ?? "—");
  setChip("chip-motion", motionSrc ?? current, motionSrc ? motionSrc.name : "Own motions");
  $("reset-motion").classList.toggle("hidden", !motionSrc);
  $("swap-pair").disabled = !motionSrc;
}

function applyLook() {
  if (!model) return;
  const toon = $("toon").checked;
  const all = [...model.toonables, ...(swap ? swap.donor.toonables : []), ...(swap ? swap.mouths.map((m) => m.mesh) : [])];
  for (const o of all) o.material = toon ? o.userData.toonMat : o.userData.origMat;
  for (const l of [...model.outlines, ...(swap ? swap.donor.outlines : [])]) l.visible = $("outline").checked;
  applyHalo();
}

// Halo: the model's own, the motion student's (moved onto the model's head), or none.
function applyHalo() {
  const mode = $("halo").value;
  const borrowed = !!(swap && mode === "motion" && model.head);
  for (const h of model.haloMeshes) h.visible = mode === "model" || (mode === "motion" && !borrowed);
  if (!swap) return;
  for (const { obj, parent } of swap.donor.haloRoots) {
    const target = borrowed && obj.parent === parent && parent?.isBone && /head/i.test(parent.name) ? model.head : parent;
    if (borrowed && target === model.head) model.head.add(obj); // keeps its head-relative offset & animation
    else if (!borrowed && obj.parent !== parent) parent.add(obj);
  }
  for (const h of swap.donor.haloMeshes) h.visible = borrowed && h.parent !== null && isUnder(h, model.root);
}
function syncHaloOptions() {
  const opt = $("halo").querySelector('option[value="motion"]');
  opt.disabled = !swap;
  opt.textContent = swap ? `From ${swap.donor.entry.name}` : "From motion";
}

// Mouth shapes are separate quads collapsed by a morph weight: 1 = hidden, 0 = shown.
// "Animated" leaves them to the animation; picking one shows only that shape.
function forceMouth() {
  const v = $("mouth").value;
  if (!v || !model) return;
  const list = swap?.mouths.length ? swap.mouths.map((m) => [m.code, m.mesh]) : [...model.mouths];
  for (const [code, mesh] of list) mesh.morphTargetInfluences[0] = code === v ? 0 : 1;
}
function syncMouthVisibility() {
  if (!swap) return;
  for (const { mesh } of swap.mouths) mesh.visible = mesh.morphTargetInfluences[0] < 0.99999;
}

function playClip(name) {
  if (!model) return;
  const d = driver();
  if (action) action.stop();
  action = null;
  const clip = d.clips.find((c) => c.name === name);
  $("anim").value = clip ? name : "";
  if (clip) {
    action = d.mixer.clipAction(clip);
    action.reset();
    action.setLoop($("loop").checked ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.play();
  }
  d.mixer.removeEventListener("finished", onFinished);
  d.mixer.addEventListener("finished", onFinished);
  playing = true;
  step(0);
  syncPlayButton();
  updateHash();
}
function onFinished() { playing = false; syncPlayButton(); }

// advance the animation by dt seconds (0 = just re-evaluate)
function step(dt) {
  if (!model) return;
  if (swap) {
    swap.donor.mixer.update(dt);
    model.mixer.update(dt);
    applySwap(model, swap);
  } else {
    model.mixer.update(dt);
  }
  forceMouth();
  syncMouthVisibility();
  applyOptionalProps();
}

// Bounding box of everything currently shown (model, borrowed props/halo), using posed vertices.
function shownBox(box = new THREE.Box3()) {
  const v = new THREE.Vector3();
  const shown = (o) => { for (let a = o; a; a = a.parent) if (!a.visible) return false; return true; };
  const roots = [model.root, ...(swap ? [swap.donor.root] : [])];
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || o.userData.isOutline || !shown(o)) return;
      if (o.morphTargetInfluences?.length === 1 && o.morphTargetInfluences[0] > 0.999) return; // collapsed mouth
      const pos = o.geometry.attributes.position;
      const stride = Math.max(1, Math.floor(pos.count / 1500));
      for (let i = 0; i < pos.count; i += stride) {
        v.fromBufferAttribute(pos, i);
        if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
        box.expandByPoint(v.applyMatrix4(o.matrixWorld));
      }
    });
  }
  return box;
}

// Keep the camera's viewing angle, but centre on the model and move in/out so that its bounds over the
// given clip times fit the frame with some padding.
function fitCamera(cam, times, padding) {
  const box = new THREE.Box3();
  const picks = times.length ? times.filter((_, i) => i % Math.max(1, Math.ceil(times.length / 24)) === 0) : [null];
  for (const t of picks) {
    if (t != null && action) { action.paused = false; action.enabled = true; action.time = t; }
    step(0);
    shownBox(box);
  }
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
  cam.matrixWorld.extractBasis(right, up, fwd);
  fwd.negate(); // camera looks down -Z
  const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (1 - padding);
  const tanX = tanY * cam.aspect;
  let d = 0;
  const r = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    r.set(x, y, z).sub(center);
    const depth = r.dot(fwd);
    d = Math.max(d, Math.abs(r.dot(up)) / tanY - depth, Math.abs(r.dot(right)) / tanX - depth);
  }
  cam.position.copy(center).addScaledVector(fwd, -d);
  cam.near = Math.max(0.001, d / 100);
  cam.far = d * 50;
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
}

function frameModel() {
  if (!model) return;
  step(0);
  model.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  model.root.traverse((o) => {
    if (!o.isMesh || o.userData.isOutline || !o.visible || model.props.includes(o)) return;
    const pos = o.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(pos.count / 2000));
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i);
      if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
      box.expandByPoint(v.applyMatrix4(o.matrixWorld));
    }
  });
  if (box.isEmpty()) box.setFromObject(model.root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const h = Math.max(size.y, size.x * 0.8, 0.1);
  const panel = $("controls").offsetHeight ? $("controls").offsetHeight + 12 : 0;
  const usable = Math.max(0.35, 1 - panel / Math.max($("stage").clientHeight, 1));
  const dist = (h / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.15 / usable;
  controls.target.copy(center);
  camera.position.set(center.x, center.y + h * 0.05, center.z + dist);
  camera.near = dist / 100;
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.update();
  ground.position.set(center.x, box.min.y, center.z);
  ground.scale.setScalar(h * 6);
  const s = sun.shadow.camera;
  s.left = s.bottom = -h * 1.5; s.right = s.top = h * 1.5; s.near = 0.01; s.far = h * 10;
  s.updateProjectionMatrix();
  sun.position.copy(center).add(new THREE.Vector3(h * 0.6, h * 1.4, h * 1.0));
  sun.target.position.copy(center);
}

// ---------- controls ----------
function syncPlayButton() {
  $("play").textContent = playing ? "❚❚" : "▶";
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
}
function togglePlay() {
  if (!action) return;
  if (!playing && action.loop === THREE.LoopOnce && action.time >= action.getClip().duration - 1e-3) action.reset().play();
  action.paused = false;
  playing = !playing;
  syncPlayButton();
}
$("play").addEventListener("click", togglePlay);

// Frame stepping: pauses and moves by whole frames (the game's clips are 30 fps).
const FRAME = 1 / 30;
function stepFrames(n) {
  if (!action) return;
  const dur = action.getClip().duration;
  if (!(dur > 0)) return;
  playing = false;
  syncPlayButton();
  action.paused = false;
  action.enabled = true;
  const t = Math.round(action.time / FRAME + n) * FRAME;
  action.time = $("loop").checked ? ((t % dur) + dur) % dur : Math.min(dur, Math.max(0, t));
  step(0);
  syncTime();
}
$("step-back").addEventListener("click", (e) => stepFrames(e.shiftKey ? -10 : -1));
$("step-fwd").addEventListener("click", (e) => stepFrames(e.shiftKey ? 10 : 1));
function syncTime() {
  if (!action) return;
  const dur = action.getClip().duration || 1;
  const t = action.time % (dur + 1e-6);
  if (!scrubbing) $("scrub").value = String(t / dur);
  $("time").textContent = `${t.toFixed(2)} / ${dur.toFixed(2)} s`;
}

// Face close-up: keep the viewing direction, centre on the head.
function frameFace() {
  if (!model?.head) return frameModel();
  model.root.updateMatrixWorld(true);
  const h = model.height;
  const target = model.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, h * 0.12, 0));
  const dir = camera.position.clone().sub(controls.target).normalize();
  const dist = (h * 0.8) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(dir, dist);
  controls.update();
}
let scrubbing = false;
$("scrub").addEventListener("input", () => {
  if (!action) return;
  scrubbing = true;
  action.paused = false;
  action.enabled = true;
  action.time = Number($("scrub").value) * action.getClip().duration;
  step(0);
});
$("scrub").addEventListener("change", () => { scrubbing = false; });
$("anim").addEventListener("change", (e) => playClip(e.target.value));
$("mouth").addEventListener("change", () => step(0));
$("loop").addEventListener("change", () => action && playClip(action.getClip().name));
for (const id of ["toon", "outline", "halo"]) $(id).addEventListener("change", applyLook);
$("halo").addEventListener("change", (e) => {
  try { localStorage.setItem(HALO_KEY, e.target.value); } catch {}
});
$("props").addEventListener("change", (e) => {
  try { localStorage.setItem(PROPS_KEY, e.target.value); } catch {}
  step(0);
});
function setBackground(value, save = true) {
  $("bg").value = value;
  scene.background.set(value);
  try {
    if (save && value !== BG_DEFAULT) localStorage.setItem(BG_KEY, value);
    else localStorage.removeItem(BG_KEY);
  } catch {}
}
$("bg").addEventListener("input", (e) => setBackground(e.target.value));
$("bg-reset").addEventListener("click", () => setBackground(BG_DEFAULT, false));
$("reset-cam").addEventListener("click", frameModel);
// ---------- export ----------
// Off-screen renderer used by export.js: poses the model at exact clip times and reads frames back at any
// size, optionally with a transparent background.
let exporting = false;
const exportRenderer = {
  info() {
    const clip = action?.getClip();
    const stage = $("stage");
    const motion = motionSrc ? ` + ${motionSrc.name}` : "";
    return {
      ready: !!model,
      clip: clip?.name ?? "",
      duration: clip?.duration ?? 0,
      time: action ? action.time % (clip.duration || 1) : 0,
      speed: Number($("speed").value) || 1,
      viewportAspect: stage.clientWidth / Math.max(1, stage.clientHeight),
      base: `${current?.name ?? "model"}${motion}${clip ? " - " + clip.name : ""}`,
    };
  },
  begin({ width, height, transparent, shadow, fit = false, padding = 0.08, times = [] }) {
    exporting = true;
    const saved = {
      playing, time: action?.time, background: scene.background, ground: ground.visible,
      uRes: outlineUniforms.uRes.value.clone(), uWidth: outlineUniforms.uWidth.value,
      clearColor: renderer.getClearColor(new THREE.Color()), clearAlpha: renderer.getClearAlpha(),
    };
    playing = false;
    syncPlayButton();
    const rt = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const cam = camera.clone();
    cam.clearViewOffset();
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    if (fit) fitCamera(cam, times, padding);
    // keep outlines the same thickness relative to the image as on screen
    outlineUniforms.uRes.value.set(width, height);
    outlineUniforms.uWidth.value = saved.uWidth * (height / Math.max(1, saved.uRes.y));
    if (transparent) { scene.background = null; renderer.setClearColor(0x000000, 0); }
    ground.visible = shadow;
    this.state = { saved, rt, cam, width, height, transparent, buf: new Uint8Array(width * height * 4) };
  },
  frame(t) {
    const { rt, cam, width: w, height: h, transparent, buf } = this.state;
    if (action) { action.paused = false; action.enabled = true; action.time = t; }
    step(0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    renderer.setRenderTarget(null);
    const out = new Uint8ClampedArray(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) out.set(buf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    if (transparent) {
      // anti-aliased edges against a transparent clear come out premultiplied; undo that
      for (let i = 0; i < out.length; i += 4) {
        const a = out[i + 3];
        if (a > 0 && a < 255) {
          const k = 255 / a;
          out[i] = Math.min(255, out[i] * k); out[i + 1] = Math.min(255, out[i + 1] * k); out[i + 2] = Math.min(255, out[i + 2] * k);
        }
      }
    }
    return out;
  },
  end() {
    const st = this.state;
    if (!st) return;
    const { saved, rt } = st;
    rt.dispose();
    scene.background = saved.background;
    ground.visible = saved.ground;
    renderer.setClearColor(saved.clearColor, saved.clearAlpha);
    outlineUniforms.uRes.value.copy(saved.uRes);
    outlineUniforms.uWidth.value = saved.uWidth;
    if (action && saved.time != null) action.time = saved.time;
    step(0);
    playing = saved.playing;
    syncPlayButton();
    this.state = null;
    exporting = false;
    clock.getDelta(); // don't jump ahead by the time the export took
    resize();
  },
};
$("export-btn").addEventListener("click", async () => {
  if (!model) return;
  try {
    const { openExport } = await import("./export.js");
    openExport(exportRenderer);
  } catch (e) {
    console.error(e);
  }
});
// ---------- random pick & swap ----------
// Picks from the students currently listed (so search and "Downloaded only" narrow it down).
function randomPick() {
  const shown = [...document.querySelectorAll("#list button.item")].map((b) => byName.get(b.dataset.name));
  const all = models.filter((m) => !m.mergedInto);
  const pool = (shown.length ? shown : all).filter((m) => m !== current && m !== motionSrc);
  if (!pool.length) return;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (pickMode === "motion" && current) load(current, pick);
  else load(pick, motionSrc === pick ? null : motionSrc);
}
$("random-btn").addEventListener("click", randomPick);
$("empty-random").addEventListener("click", () => {
  const all = models.filter((m) => !m.mergedInto);
  load(all[Math.floor(Math.random() * all.length)], null);
});
function swapPair() {
  if (current && motionSrc) load(motionSrc, current);
}
$("swap-pair").addEventListener("click", swapPair);

// ---------- keyboard shortcuts ----------
const shortcuts = $("shortcuts-dialog");
// phones / touch-only: no keyboard, so drop the "(/)" hint from the search box
const noKeyboard = matchMedia("(max-width: 720px), (hover: none) and (pointer: coarse)");
const syncKeyHints = () => { $("search").placeholder = noKeyboard.matches ? "Search students" : "Search students (/)"; };
noKeyboard.addEventListener?.("change", syncKeyHints);
syncKeyHints();
const toggleShortcuts = () => (shortcuts.open ? shortcuts.close() : shortcuts.showModal());
$("shortcuts-btn").addEventListener("click", toggleShortcuts);
$("close-shortcuts").addEventListener("click", () => shortcuts.close());
shortcuts.addEventListener("click", (e) => { if (e.target === shortcuts) shortcuts.close(); });
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }
  if ($("export-dialog").open) return;
  if (e.key === "?") { e.preventDefault(); toggleShortcuts(); return; }
  if (shortcuts.open) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const act = {
    "/": () => { setSidebar(true); $("search").focus(); },
    m: () => { setSidebar(true); setPickMode(pickMode === "model" ? "motion" : "model"); },
    s: () => {
      // phones: the sidebar is a slide-over ("open"); wider screens: it's hidden via "side-hidden"
      const shown = innerWidth <= 720 ? $("sidebar").classList.contains("open") : !$("app").classList.contains("side-hidden");
      setSidebar(!shown);
    },
    h: () => setControls($("app").classList.contains("controls-hidden")),
    t: cycleTheme,
    n: randomPick,
  }[k] ?? (model && {
    " ": togglePlay,
    ArrowLeft: () => stepFrames(e.shiftKey ? -10 : -1),
    ArrowRight: () => stepFrames(e.shiftKey ? 10 : 1),
    ",": () => stepFrames(-1),
    ".": () => stepFrames(1),
    l: () => { $("loop").checked = !$("loop").checked; $("loop").dispatchEvent(new Event("change")); },
    r: frameModel,
    f: frameFace,
    x: swapPair,
    e: () => $("export-btn").click(),
  }[k]);
  if (!act) return;
  e.preventDefault();
  act();
});

$("delete-model").addEventListener("click", async () => {
  if (!current) return;
  await cacheDelete(modelUrl(current));
  await refreshCacheState();
});
$("clear-all").addEventListener("click", async () => {
  try { await caches.delete(CACHE_NAME); } catch {}
  cachePromise = null;
  await refreshCacheState();
});

// ---------- deep links ----------
function updateHash() {
  if (!current) return;
  const p = new URLSearchParams({ model: current.name });
  if (motionSrc) p.set("motion", motionSrc.name);
  if (action) p.set("anim", action.getClip().name);
  history.replaceState(null, "", "#" + p.toString());
}
function fromHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const resolve = (n) => { const e = byName.get(n ?? ""); return e?.mergedInto ? byName.get(e.mergedInto) : e; };
  const m = resolve(p.get("model"));
  const mo = resolve(p.get("motion")) ?? null;
  if (m && (m !== current || mo !== motionSrc)) load(m, mo, p.get("anim"));
}
addEventListener("hashchange", fromHash);

// ---------- render loop ----------
const clock = new THREE.Clock();
let uiTick = 0;
renderer.setAnimationLoop(() => {
  if (exporting) return;
  const dt = clock.getDelta();
  if (model) {
    if (playing && !scrubbing) step(dt * Number($("speed").value));
    if (action && ++uiTick % 4 === 0) {
      const dur = action.getClip().duration || 1;
      const t = action.time % (dur + 1e-6);
      if (!scrubbing) $("scrub").value = String(t / dur);
      $("time").textContent = `${t.toFixed(2)} / ${dur.toFixed(2)} s`;
    }
  }
  controls.update();
  renderer.render(scene, camera);
});

await refreshCacheState();
fromHash();

