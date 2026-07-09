#!/usr/bin/env python3
"""Generate Moze NFT images + metadata from trait layers.

Layer order (bottom → top):
  BACKGROUND → BASE → SKIN → CLOTHES → EYES → HEAD → MOUTH

Examples:
  # Full collection from DNA metadata → generated/
  python3 scripts/generate_moze.py --collection

  # Regenerate token #11 only
  python3 scripts/generate_moze.py --token 11

  # Range
  python3 scripts/generate_moze.py --token 1-50

  # Single custom combo
  python3 scripts/generate_moze.py -t "BACKGROUND=Army,SKIN=Doll,..." -o generated/custom.png

  # Random samples
  python3 scripts/generate_moze.py --random -n 5 -o generated/random.png
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TRAITS_JSON = ROOT / "data" / "traits.json"
ASSETS = ROOT / "assets"
DEFAULT_DNA = ROOT / "data" / "metadata.csv"
FALLBACK_DNA = Path(
    "/Users/user/Documents/ANESH/PERSONAL/24. LAUNCHPAD MOZETWO/Moze (1)/metadata.csv"
)
COLLECTION_IMG = ROOT / "assets" / "Collection"
OUT_DEFAULT = ROOT / "generated"
OUT_SIZE = 1000
DESCRIPTION = "Rooted in street art!"

# Bottom → top (user-specified)
LAYER_ORDER = [
    "BACKGROUND",
    "BASE",
    "SKIN",
    "CLOTHES",
    "EYES",
    "HEAD",
    "MOUTH",
]

# These eye traits draw AFTER mouth so art stays in front
EYES_ON_TOP = {
    "Superstar Eyes",
    "Laser Eyes",
}

# CSV column order (matches launchpad metadata.csv format)
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


def load_traits() -> dict:
    with TRAITS_JSON.open(encoding="utf-8") as f:
        data = json.load(f)
    # Enforce compositing order even if traits.json is stale
    data["layerOrder"] = list(LAYER_ORDER)
    return data


def trait_index(traits: dict) -> dict[str, dict[str, dict]]:
    """category → name → item."""
    out: dict[str, dict[str, dict]] = {}
    for cat in traits["categories"]:
        out[cat["name"]] = {item["name"]: item for item in cat["items"]}
    return out


def resolve_path(item: dict) -> Path:
    rel = item["image"].replace("assets/", "")
    # URL-encoded paths in traits.json
    from urllib.parse import unquote

    return ASSETS / unquote(rel)


def is_blank(name: str | None) -> bool:
    if not name:
        return True
    n = name.strip().lower()
    return n.startswith("blank") or n in {"none", "null", "-"}


def resolve_name(index: dict[str, dict[str, dict]], category: str, raw: str) -> str | None:
    """Map metadata short names (Army) → asset names (Army Canvas)."""
    raw = (raw or "").strip()
    if not raw:
        return None
    items = index.get(category) or {}
    if raw in items:
        return raw

    # case-insensitive exact
    lower_map = {k.lower(): k for k in items}
    if raw.lower() in lower_map:
        return lower_map[raw.lower()]

    # Army → Army Canvas
    canvas = f"{raw} Canvas"
    if canvas in items:
        return canvas
    if canvas.lower() in lower_map:
        return lower_map[canvas.lower()]

    # strip " Canvas" reverse match
    for k in items:
        if k.lower().removesuffix(" canvas") == raw.lower():
            return k

    # unique prefix / contains
    hits = [
        k
        for k in items
        if k.lower().startswith(raw.lower()) or raw.lower() in k.lower()
    ]
    if len(hits) == 1:
        return hits[0]
    if hits:
        hits.sort(key=lambda k: (abs(len(k) - len(raw)), len(k)))
        return hits[0]

    return None


def open_layer(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA").resize(
        (OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS
    )


def compose_order(selected: dict[str, str]) -> list[str]:
    """Bottom→top. Superstar Eyes renders after MOUTH."""
    eyes = (selected.get("EYES") or "").strip()
    if eyes in EYES_ON_TOP:
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


def compose(index: dict[str, dict[str, dict]], selected: dict[str, str]) -> Image.Image:
    """Composite layers bottom→top. selected values should already be resolved asset names."""
    canvas: Image.Image | None = None

    for layer in compose_order(selected):
        name = selected.get(layer)
        if is_blank(name):
            continue
        item = index.get(layer, {}).get(name)  # type: ignore[arg-type]
        if not item:
            raise FileNotFoundError(f"Unknown trait: {layer}/{name}")
        path = resolve_path(item)
        if not path.exists():
            raise FileNotFoundError(f"Missing file: {path}")

        img = open_layer(path)
        if canvas is None:
            if layer == "BACKGROUND":
                canvas = img
            else:
                canvas = Image.new("RGBA", (OUT_SIZE, OUT_SIZE), (255, 248, 238, 255))
                canvas = Image.alpha_composite(canvas, img)
        else:
            canvas = Image.alpha_composite(canvas, img)

    if canvas is None:
        raise ValueError("No traits selected")
    return canvas.convert("RGB")


def random_traits(traits: dict) -> dict[str, str]:
    picked: dict[str, str] = {}
    for cat in traits["categories"]:
        picked[cat["name"]] = random.choice(cat["items"])["name"]
    return picked


def parse_traits_arg(value: str) -> dict[str, str]:
    selected: dict[str, str] = {}
    for part in value.split(","):
        key, _, val = part.partition("=")
        key, val = key.strip().upper(), val.strip()
        if key and val:
            selected[key] = val
    return selected


def load_dna(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f"Empty DNA file: {path}")
    return rows


def ensure_dna() -> Path:
    if DEFAULT_DNA.exists():
        return DEFAULT_DNA
    if FALLBACK_DNA.exists():
        DEFAULT_DNA.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(FALLBACK_DNA, DEFAULT_DNA)
        print(f"Copied DNA → {DEFAULT_DNA}")
        return DEFAULT_DNA
    raise SystemExit(
        f"No metadata DNA found at {DEFAULT_DNA} or {FALLBACK_DNA}"
    )


def dna_selected(row: dict) -> dict[str, str]:
    """Raw attribute values as stored in metadata (short names OK)."""
    out = {}
    for key in CSV_ATTR_ORDER:
        out[key] = (row.get(f"attributes[{key}]") or "").strip()
    return out


def resolve_selected(
    index: dict[str, dict[str, dict]], raw: dict[str, str]
) -> tuple[dict[str, str], list[str]]:
    resolved: dict[str, str] = {}
    missing: list[str] = []
    for layer in LAYER_ORDER:
        val = raw.get(layer, "")
        if is_blank(val):
            resolved[layer] = val or "Blank"
            continue
        name = resolve_name(index, layer, val)
        if not name:
            missing.append(f"{layer}={val}")
            resolved[layer] = val
        else:
            resolved[layer] = name
    return resolved, missing


def fallback_image(token_id: int) -> Path | None:
    for base in (COLLECTION_IMG, FALLBACK_DNA.parent / "images"):
        for ext in (".webp", ".png", ".jpg"):
            p = base / f"{token_id}{ext}"
            if p.exists():
                return p
    return None


def write_token_json(path: Path, token_id: int, raw_attrs: dict[str, str]) -> None:
    payload = {
        "name": f"Moze #{token_id}",
        "description": DESCRIPTION,
        "image": f"images/{token_id}.png",
        "attributes": [
            {"trait_type": k, "value": raw_attrs.get(k, "")} for k in CSV_ATTR_ORDER
        ],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_metadata_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in sorted(rows, key=lambda r: int(r["tokenID"])):
            writer.writerow(row)


def parse_token_spec(spec: str) -> list[int]:
    """'11' or '1-10' or '1,2,5-7' → list of ids."""
    ids: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            start, end = int(a), int(b)
            if end < start:
                start, end = end, start
            ids.extend(range(start, end + 1))
        else:
            ids.append(int(part))
    return ids


def generate_token(
    *,
    token_id: int,
    row: dict,
    index: dict[str, dict[str, dict]],
    images_dir: Path,
    json_dir: Path | None,
    force_fallback: bool = False,
) -> tuple[Path, dict[str, str], str]:
    """Returns (image_path, raw_attrs, mode) where mode is 'compose' or 'fallback'."""
    raw = dna_selected(row)
    # Prefer original attribute labels in metadata (not resolved Canvas names)
    out_img = images_dir / f"{token_id}.png"

    if not force_fallback:
        resolved, missing = resolve_selected(index, raw)
        if not missing:
            try:
                image = compose(index, resolved)
                out_img.parent.mkdir(parents=True, exist_ok=True)
                image.save(out_img, format="PNG", optimize=True)
                if json_dir is not None:
                    json_dir.mkdir(parents=True, exist_ok=True)
                    write_token_json(json_dir / f"{token_id}.json", token_id, raw)
                return out_img, raw, "compose"
            except FileNotFoundError as e:
                missing = [str(e)]

        # missing layers → try fallback original art
        fb = fallback_image(token_id)
        if fb:
            out_img.parent.mkdir(parents=True, exist_ok=True)
            im = Image.open(fb).convert("RGB").resize(
                (OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS
            )
            im.save(out_img, format="PNG", optimize=True)
            if json_dir is not None:
                json_dir.mkdir(parents=True, exist_ok=True)
                write_token_json(json_dir / f"{token_id}.json", token_id, raw)
            print(
                f"  ! token {token_id}: missing {missing} → fallback {fb.name}",
                file=sys.stderr,
            )
            return out_img, raw, "fallback"

        raise FileNotFoundError(
            f"Token {token_id}: cannot compose ({missing}) and no fallback image"
        )

    fb = fallback_image(token_id)
    if not fb:
        raise FileNotFoundError(f"No fallback for token {token_id}")
    out_img.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(fb).convert("RGB").resize(
        (OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS
    )
    im.save(out_img, format="PNG", optimize=True)
    if json_dir is not None:
        json_dir.mkdir(parents=True, exist_ok=True)
        write_token_json(json_dir / f"{token_id}.json", token_id, raw)
    return out_img, raw, "fallback"


def row_for_token(dna: list[dict], token_id: int) -> dict:
    for row in dna:
        if int(row["tokenID"]) == token_id:
            return row
    raise KeyError(f"tokenID {token_id} not in DNA metadata")


def run_collection(out_dir: Path, dna_path: Path, only: list[int] | None = None) -> None:
    traits = load_traits()
    index = trait_index(traits)
    dna = load_dna(dna_path)

    images_dir = out_dir / "images"
    json_dir = out_dir / "json"
    images_dir.mkdir(parents=True, exist_ok=True)
    json_dir.mkdir(parents=True, exist_ok=True)

    # Build full metadata rows (preserve existing DNA for all tokens)
    meta_rows: list[dict] = []
    id_set = set(only) if only is not None else None

    composed = fallback = 0
    targets = []
    for row in dna:
        tid = int(row["tokenID"])
        # normalize row for CSV output
        meta_rows.append(
            {
                "tokenID": tid,
                "name": row.get("name") or f"Moze #{tid}",
                "description": row.get("description") or DESCRIPTION,
                "file_name": f"{tid}.png",
                **{f"attributes[{k}]": (row.get(f"attributes[{k}]") or "").strip() for k in CSV_ATTR_ORDER},
            }
        )
        if id_set is None or tid in id_set:
            targets.append((tid, row))

    targets.sort(key=lambda x: x[0])
    total = len(targets)
    print(f"Generating {total} token(s) → {out_dir}")
    print(f"Layer order: {' → '.join(LAYER_ORDER)}")
    print(f"DNA: {dna_path}")

    for i, (tid, row) in enumerate(targets, 1):
        path, _raw, mode = generate_token(
            token_id=tid,
            row=row,
            index=index,
            images_dir=images_dir,
            json_dir=json_dir,
        )
        if mode == "compose":
            composed += 1
        else:
            fallback += 1
        if i == 1 or i == total or i % 50 == 0:
            print(f"  [{i}/{total}] {path.name} ({mode})")

    # If partial regenerate, merge with existing metadata.csv if present
    meta_path = out_dir / "metadata.csv"
    if only is not None and meta_path.exists():
        existing = {int(r["tokenID"]): r for r in load_dna(meta_path)}
        for r in meta_rows:
            existing[int(r["tokenID"])] = r
        meta_rows = list(existing.values())

    write_metadata_csv(meta_path, meta_rows)

    # Also keep a flat copy of DNA in data/
    write_metadata_csv(DEFAULT_DNA, meta_rows)

    print(f"Done. compose={composed} fallback={fallback}")
    print(f"Images: {images_dir}")
    print(f"JSON:   {json_dir}")
    print(f"CSV:    {meta_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Moze NFT PNGs + metadata")
    parser.add_argument(
        "-o",
        "--output",
        default=str(OUT_DEFAULT),
        help="Output dir (collection) or PNG path (single)",
    )
    parser.add_argument("-r", "--random", action="store_true", help="Randomize traits")
    parser.add_argument("-t", "--traits", help="BACKGROUND=Army,SKIN=Doll,...")
    parser.add_argument("-n", "--count", type=int, default=1, help="Count with --random")
    parser.add_argument(
        "--collection",
        action="store_true",
        help="Generate full collection from DNA metadata.csv",
    )
    parser.add_argument(
        "--token",
        help="Regenerate specific token id(s): 11 or 1-10 or 1,5,9",
    )
    parser.add_argument(
        "--dna",
        help="Path to metadata.csv DNA (default: data/metadata.csv)",
    )
    args = parser.parse_args()

    # Collection / token modes
    if args.collection or args.token:
        dna_path = Path(args.dna) if args.dna else ensure_dna()
        out_dir = Path(args.output)
        if out_dir.suffix.lower() in {".png", ".jpg", ".webp"}:
            out_dir = out_dir.parent if out_dir.parent != Path(".") else OUT_DEFAULT
        only = parse_token_spec(args.token) if args.token else None
        run_collection(out_dir, dna_path, only=only)
        return

    traits = load_traits()
    index = trait_index(traits)

    if args.random:
        out = Path(args.output)
        # if pointing at generated/, write samples under it
        if out.is_dir() or str(out) == str(OUT_DEFAULT):
            parent = out if out.suffix == "" else out
            parent.mkdir(parents=True, exist_ok=True)
            for i in range(args.count):
                selected = random_traits(traits)
                image = compose(index, selected)
                path = parent / f"random-{i + 1}.png"
                image.save(path)
                print(path)
                print(
                    "  ",
                    ", ".join(
                        f"{k}={selected[k]}"
                        for k in LAYER_ORDER
                        if not is_blank(selected.get(k))
                    ),
                )
            return

        stem, suffix = out.stem, out.suffix or ".png"
        parent = out.parent
        parent.mkdir(parents=True, exist_ok=True)
        for i in range(args.count):
            selected = random_traits(traits)
            image = compose(index, selected)
            path = parent / f"{stem}-{i + 1}{suffix}" if args.count > 1 else out
            image.save(path)
            print(path)
            print(
                "  ",
                ", ".join(
                    f"{k}={selected[k]}"
                    for k in LAYER_ORDER
                    if not is_blank(selected.get(k))
                ),
            )
        return

    raw = parse_traits_arg(args.traits) if args.traits else dict(traits.get("defaults", {}))
    resolved, missing = resolve_selected(index, raw)
    if missing:
        raise SystemExit(f"Unknown traits: {missing}")
    image = compose(index, resolved)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)
    print(out)


if __name__ == "__main__":
    main()
