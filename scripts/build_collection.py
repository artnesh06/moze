#!/usr/bin/env python3
"""Build data/collection.json from metadata.csv."""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METADATA = ROOT / "source" / "metadata.csv"
OUTPUT = ROOT / "data" / "collection.json"

LAYER_KEYS = [
    "BACKGROUND",
    "BASE",
    "SKIN",
    "CLOTHES",
    "EYES",
    "MOUTH",
    "HEAD",
]


def main() -> None:
    rows = []
    with METADATA.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            token_id = int(row["tokenID"])
            item = {
                "id": token_id,
                "name": row["name"],
                "image": f"assets/Collection/{token_id}.webp",
            }
            for key in LAYER_KEYS:
                item[key] = row.get(f"attributes[{key}]", "")
            rows.append(item)

    rows.sort(key=lambda x: x["id"])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
        f.write("\n")

    print(f"Wrote {len(rows)} items → {OUTPUT}")


if __name__ == "__main__":
    main()