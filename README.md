# Blue Archive Model Viewer

A static, single-page 3D viewer for Blue Archive student models. It runs entirely in the browser, so it can be hosted on GitHub Pages.

- Models are streamed from [lihaohong6/BlueArchiveModels](https://github.com/lihaohong6/BlueArchiveModels), pinned to the commit recorded in `models.json`.
- **Mix and match:** play any student's animations on any other student. Use the sidebar's **Motion** tab, or the "Motion from" chip. The motion student plays the animation, and each bone's world-space rotation (relative to rest) is copied onto the shown model every frame, with root movement scaled to the model's height. The motion student's weapon and props come along, and the model's mouth plays the motion student's mouth shapes and textures. Bones only the model has (unique hair, tails) follow the model's own idle.
- 2D student icons from [SchaleDB](https://schaledb.com), bundled in `icons/`.
- Each model is downloaded once and kept in the browser's Cache Storage. Later visits load it instantly, with no network request.
- Every built-in animation is listed: Cafe, Formation, Exs, Normal/Kneel attacks, Victory, and more.
- Controls: play/pause, scrubbing, speed and loop.
- Mouth shapes can be animated or forced.
- Toon shading and outlines can be toggled; the halo can come from the model, the motion student, or be hidden; props and accessories (e.g. bags) can be hidden. The background colour is remembered.
- **Export** dialog, rendered frame by frame off screen (any size up to 3840 px, viewport or fixed aspect, optional transparent background and ground shadow; framing either "Fit to model" — the model's bounds over the whole exported range, with adjustable padding — or the current view):
  - **PNG** still (or copy to clipboard)
  - **APNG** (lossless, full transparency)
  - **GIF** (shared palette, 1-bit transparency)
  - **Animated WebP** (needs a browser that encodes WebP: Chrome, Edge, Firefox)
  - **WebM** video (VP9 via WebCodecs; transparency is stored as an alpha side stream)
  - Animated exports take a frame rate and a start/end range, and play at the current speed.
- Links are shareable: `#model=Yuuka&motion=Hoshino&anim=Exs`.

three.js 0.182.0 is loaded from jsDelivr via an import map. There is no build step.

## Run locally

```sh
python3 -m http.server 8000
# open http://127.0.0.1:8000/
```

Opening `index.html` as a `file://` URL won't work, because ES modules and Cache Storage need http(s).

## Publish on GitHub Pages

1. Push this folder as the root of a repository.
2. Under **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`. All paths are relative, so it works under the subfolder.

## Update the model list

```sh
python3 tools/make_manifest.py   # rewrites models.json from the source repo's latest commit, fetches new icons
```

Commit the new `models.json`. Models that changed get new URLs (new commit), so browsers download them fresh. Old copies stay cached until the visitor uses "Clear downloads".

## Notes

- Six variants are the same 3D model as another entry and only add animations (e.g. Arisu (Battle) (Carrier), Toki (Battle) (Scenario)). They're hidden from the list, and their clips appear in the main entry's animation list with a suffix like "Idle (Carrier)". The table is `MERGE` in `tools/make_manifest.py`.
- Icons are matched to models by name, translating the model repo's outfit names to SchaleDB's ("Bunny Girl" → "Bunny", "Battle" → "Armed", …). Model-only variants such as "(Carrier)" or "(Cut-in)" use their outfit's icon. The script prints any models it couldn't match.
- Shading is a generic toon approximation, not the game's shaders. The source models contain no material or mask data.
- Furniture interactions are not included, because those motions aren't in the source repository.
- Model assets belong to their respective owners (Nexon Games / Yostar). This project only views files hosted by the repository above.
