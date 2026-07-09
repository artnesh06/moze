#!/usr/bin/env python3
"""Generate a full Moze collection from assets/Traits with anti-collision rules.

Rules:
  - Layer order: BACKGROUND → BASE → SKIN → CLOTHES → EYES → HEAD → MOUTH
  - Superstar Eyes always drawn AFTER MOUTH (star stays in front)
  - BASE always Moze
  - Unique trait DNA (no duplicate combos)
  - HEAD must not cover EYES (pixel overlap in face band < threshold)
  - Face-replace heads (Doctor Monkey*) force eyes/mouth that work, or use safe head rules
  - Blank head/skin/clothes allowed

Output: generated/images, generated/json, generated/metadata.csv, data/metadata.csv
"""

from __future__ import annotations

import csv
import json
import random
import sys
import time
from pathlib import Path
from urllib.parse import unquote

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TRAITS_JSON = ROOT / "data" / "traits.json"
ASSETS = ROOT / "assets"
OUT_DIR = ROOT / "generated"
OUT_SIZE = 1000
COLLECTION_SIZE = 1000
DESCRIPTION = "Rooted in street art!"
SEED = 20260709

LAYER_ORDER = [
    "BACKGROUND",
    "BASE",
    "SKIN",
    "CLOTHES",
    "EYES",
    "HEAD",
    "MOUTH",
]

# CSV column order matches launchpad export
CSV_ATTR_ORDER = [
    "BACKGROUND",
    "BASE",
    "SKIN",
    "CLOTHES",
    "EYES",
    "MOUTH",
    "HEAD",
]

CSV_FIELDS = [
    "tokenID",
    "name",
    "description",
    "file_name",
    *[f"attributes[{k}]" for k in CSV_ATTR_ORDER],
]

# Pixel cover threshold: head covering this much of eyes = clash
COVER_MAX = 0.12  # stricter than previous MED

# Face-band for eyes
EYE_BOX = (150, 280, 850, 560)  # x0,y0,x1,y1

# Heads that fully replace the face — only allow with Blank-style or skip heavy eyes
FACE_REPLACE_HEADS = {
    "Doctor Monkey Head",
    "Doctor Monkey Head Grafitti",
}

# Eyes that stick out / beams — need low head cover
PROTRUDING_EYES = {
    "Laser Eyes",
    "Aura Glasses",
    "Spirally Googles",
    "Cool Sunglasses",
    "Dollar Eyes",
    "Double Eyes",
}

# Drawn after MOUTH so protruding art stays visible
EYES_ON_TOP = {
    "Superstar Eyes",
    "Laser Eyes",
}

# (eyes_name, mouth_name) pairs that must never share a frame
FORBIDDEN_EYES_MOUTH = {
    ("Laser Eyes", "Monsieur Cigs"),
}


def load_traits() -> dict:
    with TRAITS_JSON.open(encoding="utf-8") as f:
        data = json.load(f)
    data["layerOrder"] = list(LAYER_ORDER)
    return data


def trait_index(traits: dict) -> dict[str, dict[str, dict]]:
    out: dict[str, dict[str, dict]] = {}
    for cat in traits["categories"]:
        out[cat["name"]] = {item["name"]: item for item in cat["items"]}
    return out


def names_in(traits: dict, category: str) -> list[str]:
    for cat in traits["categories"]:
        if cat["name"] == category:
            return [i["name"] for i in cat["items"]]
    return []


def resolve_path(item: dict) -> Path:
    rel = unquote(item["image"].replace("assets/", ""))
    return ASSETS / rel


def is_blank(name: str | None) -> bool:
    if not name:
        return True
    return name.strip().lower().startswith("blank")


def load_layer(index: dict, category: str, name: str, cache: dict) -> Image.Image | None:
    if is_blank(name):
        return None
    key = (category, name)
    if key in cache:
        return cache[key]
    item = index[category][name]
    path = resolve_path(item)
    if not path.exists():
        raise FileNotFoundError(path)
    img = Image.open(path).convert("RGBA").resize(
        (OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS
    )
    cache[key] = img
    return img


def cover_ratio(eyes_img: Image.Image, head_img: Image.Image | None) -> float:
    if eyes_img is None or head_img is None:
        return 0.0
    x0, y0, x1, y1 = EYE_BOX
    eyes = eyes_img.crop((x0, y0, x1, y1)).split()[-1]
    head = head_img.crop((x0, y0, x1, y1)).split()[-1]
    ep, hp = eyes.load(), head.load()
    w, h = eyes.size
    eyes_n = both_n = 0
    for y in range(h):
        for x in range(w):
            if ep[x, y] >= 40:
                eyes_n += 1
                if hp[x, y] >= 60:
                    both_n += 1
    if eyes_n == 0:
        return 0.0
    return both_n / eyes_n


def build_compat(
    index: dict, eyes_list: list[str], heads_list: list[str], cache: dict
) -> dict[str, list[str]]:
    """eyes_name → list of heads that don't clash."""
    compat: dict[str, list[str]] = {}
    total = len(eyes_list) * len(heads_list)
    done = 0
    print(f"Building eyes×head compatibility matrix ({total} pairs)...")
    for eyes in eyes_list:
        e_img = load_layer(index, "EYES", eyes, cache)
        ok: list[str] = []
        for head in heads_list:
            if is_blank(head):
                ok.append(head)
                continue
            # Face replace heads: only allow with non-protruding eyes AND still check cover
            h_img = load_layer(index, "HEAD", head, cache)
            cov = cover_ratio(e_img, h_img)
            if head in FACE_REPLACE_HEADS:
                # Doctor monkey has its own face — never pair with real eyes that show
                # (cover is high; skip all)
                continue
            if cov <= COVER_MAX:
                ok.append(head)
            done += 1
        if not ok:
            # always allow blank if everything else clashes
            blanks = [h for h in heads_list if is_blank(h)]
            ok = blanks or [heads_list[0]]
        compat[eyes] = ok
        print(f"  {eyes}: {len(ok)}/{len(heads_list)} heads OK")
    return compat


def compose_order(selected: dict[str, str]) -> list[str]:
    """Bottom→top stack. Superstar Eyes (etc.) go after MOUTH."""
    eyes = (selected.get("EYES") or "").strip()
    if eyes in EYES_ON_TOP:
        # BACKGROUND BASE SKIN CLOTHES HEAD MOUTH EYES
        return [
            "BACKGROUND",
            "BASE",
            "SKIN",
            "CLOTHES",
            "HEAD",
            "MOUTH",
            "EYES",
        ]
    return list(LAYER_ORDER)


def compose(index: dict, selected: dict[str, str], cache: dict) -> Image.Image:
    canvas: Image.Image | None = None
    for layer in compose_order(selected):
        name = selected.get(layer)
        if is_blank(name):
            continue
        img = load_layer(index, layer, name, cache)  # type: ignore[arg-type]
        if img is None:
            continue
        if canvas is None:
            if layer == "BACKGROUND":
                canvas = img.copy()
            else:
                canvas = Image.new("RGBA", (OUT_SIZE, OUT_SIZE), (255, 248, 238, 255))
                canvas = Image.alpha_composite(canvas, img)
        else:
            canvas = Image.alpha_composite(canvas, img)
    if canvas is None:
        raise ValueError("empty compose")
    return canvas.convert("RGB")


def short_bg_name(name: str) -> str:
    """Store metadata like original launchpad (Army not Army Canvas) when possible."""
    if name.endswith(" Canvas"):
        return name[: -len(" Canvas")]
    return name


def dna_key(selected: dict[str, str]) -> tuple:
    return tuple(selected[k] for k in LAYER_ORDER)


def pick_combo(
    traits: dict,
    compat: dict[str, list[str]],
    rng: random.Random,
    seen: set[tuple],
) -> dict[str, str] | None:
    backgrounds = names_in(traits, "BACKGROUND")
    skins = names_in(traits, "SKIN")
    clothes = names_in(traits, "CLOTHES")
    eyes_list = names_in(traits, "EYES")
    mouths = names_in(traits, "MOUTH")
    bases = names_in(traits, "BASE")

    for _ in range(500):
        eyes = rng.choice(eyes_list)
        heads_ok = compat.get(eyes) or [h for h in names_in(traits, "HEAD") if is_blank(h)]
        if not heads_ok:
            continue
        head = rng.choice(heads_ok)
        mouth_pool = [
            m
            for m in mouths
            if (eyes, m) not in FORBIDDEN_EYES_MOUTH
        ]
        if not mouth_pool:
            continue
        selected = {
            "BACKGROUND": rng.choice(backgrounds),
            "BASE": bases[0] if bases else "Moze",
            "SKIN": rng.choice(skins),
            "CLOTHES": rng.choice(clothes),
            "EYES": eyes,
            "HEAD": head,
            "MOUTH": rng.choice(mouth_pool),
        }
        key = dna_key(selected)
        if key in seen:
            continue
        return selected
    return None


def write_json(path: Path, token_id: int, selected: dict[str, str], meta_names: dict[str, str]) -> None:
    payload = {
        "name": f"Moze #{token_id}",
        "description": DESCRIPTION,
        "image": f"images/{token_id}.png",
        "attributes": [
            {"trait_type": k, "value": meta_names.get(k, selected.get(k, ""))}
            for k in CSV_ATTR_ORDER
        ],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for row in rows:
            w.writerow(row)


def meta_labels(selected: dict[str, str]) -> dict[str, str]:
    """Labels stored in metadata.csv (short BACKGROUND names)."""
    out = dict(selected)
    out["BACKGROUND"] = short_bg_name(selected["BACKGROUND"])
    return out


def main() -> None:
    rng = random.Random(SEED)
    traits = load_traits()
    index = trait_index(traits)
    cache: dict = {}

    eyes_list = names_in(traits, "EYES")
    heads_list = names_in(traits, "HEAD")
    compat = build_compat(index, eyes_list, heads_list, cache)

    # Report safe heads for laser
    if "Laser Eyes" in compat:
        print(f"\nLaser Eyes safe heads ({len(compat['Laser Eyes'])}):")
        for h in compat["Laser Eyes"]:
            print(f"  - {h}")

    print(f"\nPicking {COLLECTION_SIZE} unique collision-free DNAs...")
    seen: set[tuple] = set()
    combos: list[dict[str, str]] = []
    attempts = 0
    while len(combos) < COLLECTION_SIZE:
        attempts += 1
        if attempts > COLLECTION_SIZE * 200:
            raise SystemExit(
                f"Could only find {len(combos)} unique safe combos after {attempts} tries"
            )
        picked = pick_combo(traits, compat, rng, seen)
        if not picked:
            continue
        key = dna_key(picked)
        seen.add(key)
        combos.append(picked)

    print(f"DNA ready in {attempts} attempts. Compositing images...")

    images_dir = OUT_DIR / "images"
    json_dir = OUT_DIR / "json"
    images_dir.mkdir(parents=True, exist_ok=True)
    json_dir.mkdir(parents=True, exist_ok=True)

    # Clear old images to avoid stale tokens if count changes
    for p in images_dir.glob("*.png"):
        p.unlink()
    for p in json_dir.glob("*.json"):
        p.unlink()

    rows: list[dict] = []
    t0 = time.time()
    for i, selected in enumerate(combos, 1):
        # double-check collision before save
        e_img = load_layer(index, "EYES", selected["EYES"], cache)
        h_img = load_layer(index, "HEAD", selected["HEAD"], cache)
        cov = cover_ratio(e_img, h_img) if not is_blank(selected["HEAD"]) else 0.0
        if cov > COVER_MAX:
            print(f"  WARN token {i}: cover {cov:.2f} still high, skipping save logic shouldn't happen")
        img = compose(index, selected, cache)
        img.save(images_dir / f"{i}.png", format="PNG", optimize=True)

        labels = meta_labels(selected)
        write_json(json_dir / f"{i}.json", i, selected, labels)

        row = {
            "tokenID": i,
            "name": f"Moze #{i}",
            "description": DESCRIPTION,
            "file_name": f"{i}.png",
        }
        for k in CSV_ATTR_ORDER:
            row[f"attributes[{k}]"] = labels[k]
        rows.append(row)

        if i == 1 or i % 50 == 0 or i == COLLECTION_SIZE:
            elapsed = time.time() - t0
            rate = i / elapsed if elapsed else 0
            print(f"  [{i}/{COLLECTION_SIZE}] {rate:.1f} img/s  last={selected['EYES']}+{selected['HEAD']}")

    write_csv(OUT_DIR / "metadata.csv", rows)
    write_csv(ROOT / "data" / "metadata.csv", rows)

    # Also refresh collection.json for the website gallery if used
    col = []
    for row in rows:
        tid = int(row["tokenID"])
        item = {
            "id": tid,
            "name": row["name"],
            "image": f"assets/Collection/{tid}.webp",
            **{k: row[f"attributes[{k}]"] for k in CSV_ATTR_ORDER},
        }
        col.append(item)
    (ROOT / "data" / "collection.json").write_text(
        json.dumps(col, indent=2) + "\n", encoding="utf-8"
    )

    # Verify sample collisions
    print("\nVerifying random sample for collisions...")
    bad = 0
    sample_ids = list(range(1, COLLECTION_SIZE + 1))
    rng.shuffle(sample_ids)
    for tid in sample_ids[:100]:
        sel = combos[tid - 1]
        e_img = load_layer(index, "EYES", sel["EYES"], cache)
        h_img = load_layer(index, "HEAD", sel["HEAD"], cache)
        cov = cover_ratio(e_img, h_img) if not is_blank(sel["HEAD"]) else 0.0
        if cov > COVER_MAX:
            bad += 1
            print(f"  BAD #{tid}: {sel['EYES']} × {sel['HEAD']} cover={cov:.2%}")
    print(f"Sample check: {bad}/100 bad (threshold {COVER_MAX:.0%})")

    # Stats
    from collections import Counter

    print("\n=== Trait distribution (top) ===")
    for layer in LAYER_ORDER:
        c = Counter(combo[layer] for combo in combos)
        print(f"{layer}: {len(c)} unique")
        if layer == "BACKGROUND":
            neon = sum(1 for combo in combos if combo[layer] == "Neon")
            print(f"  Neon count: {neon}")
        if layer == "EYES":
            for name, n in c.most_common(5):
                print(f"  {n:4d}  {name}")
        if layer == "HEAD":
            for name, n in c.most_common(5):
                print(f"  {n:4d}  {name}")

    print(f"\nDone → {OUT_DIR}")
    print(f"  images: {len(list(images_dir.glob('*.png')))}")
    print(f"  json:   {len(list(json_dir.glob('*.json')))}")
    print(f"  csv:    {OUT_DIR / 'metadata.csv'}")


if __name__ == "__main__":
    main()
