#!/usr/bin/env python3
"""Regenerate models.json (and icons/) from the lihaohong6/BlueArchiveModels repository.

Usage: python3 tools/make_manifest.py
- Pins the manifest to the model repo's current commit so cached models never go stale silently.
- Matches every model to a SchaleDB student and downloads its 2D icon into icons/<id>.webp.
"""
import json
import re
import time
import urllib.request
from pathlib import Path

REPO = "lihaohong6/BlueArchiveModels"
SCHALE = "https://schaledb.com"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "models.json"
ICONS = ROOT / "icons"
UA = {"User-Agent": "ba-viewer-manifest"}

# model-repo wording -> SchaleDB wording
NAME_ALIAS = {"Arisu": "Aris", "Shiroko＊Terror": "Shiroko*Terror"}
VARIANT_ALIAS = {
    "Bunny Girl": "Bunny", "School Uniform": "School", "Sportswear": "Track",
    "Cheerleader": "Cheer Squad", "Camping": "Camp", "Pajama": "Pajamas",
    "Idol": "Pop Idol", "Riding": "Cycling", "Kid": "Small", "Battle": "Armed",
}
# Variants whose 3D model is identical to another entry (same geometry and textures); they only add
# animations. They're hidden from the list and their clips are merged into the main entry, labelled with
# the given suffix. (Found by comparing mesh/texture data of every model; re-check when models are added.)
MERGE = {
    "Arisu (Battle) (Carrier)": ("Arisu (Battle)", "Carrier"),
    "Eimi (Battle) (Carrier)": ("Eimi (Battle) (Scenario)", "Carrier"),
    "Kei (Carrier 2)": ("Kei", "Carrier 2"),
    "Kei (Carrier)": ("Kei (Scenario 1)", "Carrier"),
    "Toki (Battle) (Scenario)": ("Toki (Battle)", "Scenario"),
    "Reisa (Magical) (Special)": ("Reisa (Magical)", "Special"),
}
# qualifiers that only distinguish model files, not outfits
EXTRA = re.compile(r"^(Carrier( \d+)?|Scenario( \d+)?|Cut-in|Cafe|Special|No Weapon|Prototype|\d+)$")


def get(url, accept=None):
    headers = dict(UA)
    if accept:
        headers["Accept"] = accept
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
        return r.read()


def api(path):
    return json.loads(get(f"https://api.github.com/repos/{REPO}/{path}", "application/vnd.github+json"))


def split(name):
    m = re.match(r"^(.*?)\s*((?:\([^)]*\)\s*)*)$", name)
    return m.group(1).strip(), re.findall(r"\(([^)]*)\)", m.group(2))


def resolve_icon(name, by_name):
    """Return (schale_id, exact) for a model name, or (None, False)."""
    if name in by_name:
        return by_name[name], True
    base, quals = split(name)
    base = NAME_ALIAS.get(base, base)
    quals = [VARIANT_ALIAS.get(q, q) for q in quals if not EXTRA.match(q)]
    for cand in ([f"{base} ({quals[0]})"] if quals else []) + [base]:
        if cand in by_name:
            return by_name[cand], cand == (f"{base} ({quals[0]})" if quals else base)
    return None, False


def main():
    commit = api("commits/main")["sha"]
    tree = api(f"git/trees/{commit}?recursive=1")
    if tree.get("truncated"):
        raise SystemExit("tree listing truncated")

    students = json.loads(get(f"{SCHALE}/data/en/students.min.json"))
    students = list(students.values()) if isinstance(students, dict) else students
    by_name = {s["Name"]: s["Id"] for s in students}

    models, fallback, none = [], [], []
    for t in tree["tree"]:
        if t["type"] != "blob" or not t["path"].endswith(".glb") or "/" in t["path"]:
            continue
        name = t["path"][:-4]
        base, quals = split(name)
        icon, exact = resolve_icon(name, by_name)
        if icon is None:
            none.append(name)
        elif not exact:
            fallback.append(name)
        models.append({"name": name, "base": base, "variant": ", ".join(quals),
                       "file": t["path"], "size": t["size"], "sha": t["sha"], "icon": icon})
    by_name = {m["name"]: m for m in models}
    for extra, (main, label) in MERGE.items():
        if extra in by_name and main in by_name:
            by_name[extra]["mergedInto"] = main
            by_name[main].setdefault("extras", []).append({"name": extra, "label": label})
        else:
            print(f"warning: merge {extra} -> {main} skipped (not in repo)")
    models.sort(key=lambda x: (x["base"].lower(), x["variant"] != "", x["variant"].lower()))

    ICONS.mkdir(exist_ok=True)
    fetched = 0
    for icon in sorted({m["icon"] for m in models if m["icon"] is not None}):
        dest = ICONS / f"{icon}.webp"
        if dest.exists():
            continue
        dest.write_bytes(get(f"{SCHALE}/images/student/icon/{icon}.webp"))
        fetched += 1
        time.sleep(0.1)

    OUT.write_text(json.dumps({"repo": REPO, "commit": commit, "models": models},
                              ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(models)} models, commit {commit[:10]}); downloaded {fetched} new icons")
    print(f"{len(fallback)} models use their base outfit's icon: {', '.join(fallback)}")
    print(f"{len(none)} models have no icon: {', '.join(none) or '-'}")


if __name__ == "__main__":
    main()
