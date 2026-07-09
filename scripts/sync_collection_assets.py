#!/usr/bin/env python3
"""Sync generated/images/*.png → assets/Collection/{id}.webp + rebuild collection.json."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "generated" / "images"
OUT = ROOT / "assets" / "Collection"
META = ROOT / "generated" / "metadata.csv"
META_FALLBACK = ROOT / "data" / "metadata.csv"
COLLECTION_JSON = ROOT / "data" / "collection.json"
WEBP_QUALITY = 85

CSV_ATTR_ORDER = [
    "BACKGROUND",
    "BASE",
    "SKIN",
    "CLOTHES",
    "EYES",
    "MOUTH",
    "HEAD",
]


def main() -> None:
    if not SRC.is_dir():
        raise SystemExit(f"Missing {SRC}")
    OUT.mkdir(parents=True, exist_ok=True)

    pngs = sorted(SRC.glob("*.png"), key=lambda p: int(p.stem))
    if not pngs:
        raise SystemExit(f"No PNGs in {SRC}")

    print(f"Syncing {len(pngs)} images → {OUT} (webp q={WEBP_QUALITY})")
    for i, src in enumerate(pngs, 1):
        tid = src.stem
        dest = OUT / f"{tid}.webp"
        img = Image.open(src).convert("RGB")
        if img.size != (1000, 1000):
            img = img.resize((1000, 1000), Image.Resampling.LANCZOS)
        img.save(dest, format="WEBP", quality=WEBP_QUALITY, method=4)
        if i == 1 or i == len(pngs) or i % 100 == 0:
            print(f"  [{i}/{len(pngs)}] {dest.name}")

    meta_path = META if META.exists() else META_FALLBACK
    if not meta_path.exists():
        print("WARN: no metadata.csv — skip collection.json rebuild", file=sys.stderr)
        return

    rows = list(csv.DictReader(meta_path.open(encoding="utf-8")))
    col = []
    for row in rows:
        tid = int(row["tokenID"])
        item = {
            "id": tid,
            "name": row.get("name") or f"Moze #{tid}",
            "image": f"assets/Collection/{tid}.webp",
        }
        for k in CSV_ATTR_ORDER:
            item[k] = (row.get(f"attributes[{k}]") or "").strip()
        col.append(item)
    col.sort(key=lambda x: x["id"])
    COLLECTION_JSON.write_text(json.dumps(col, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(col)} items → {COLLECTION_JSON}")
    print("Done.")


if __name__ == "__main__":
    main()
