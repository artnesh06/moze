#!/usr/bin/env python3
"""Build data/traits.json by scanning assets/Traits/<CATEGORY>/*.png."""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
TRAITS_DIR = ROOT / "assets" / "Traits"
OUTPUT = ROOT / "data" / "traits.json"

# Bottom → top (compositing stack)
LAYER_ORDER = [
    "BACKGROUND",
    "BASE",
    "SKIN",
    "CLOTHES",
    "EYES",
    "HEAD",
    "MOUTH",
]

DEFAULTS = {
    "BACKGROUND": "Army Canvas",
    "BASE": "Moze",
    "SKIN": "Doll",
    "CLOTHES": "Baseball Green Jacket",
    "EYES": "Amazed Eyes",
    "MOUTH": "Bandana Mouth Punk",
    "HEAD": "Absolute King Crown",
}


def main() -> None:
    categories = []
    total = 0

    for layer in LAYER_ORDER:
        layer_dir = TRAITS_DIR / layer
        files = sorted(
            (f for f in layer_dir.iterdir() if f.suffix.lower() == ".png"),
            key=lambda f: f.stem.lower(),
        )
        items = [
            {
                "name": f.stem,
                "image": f"assets/Traits/{layer}/{quote(f.name)}",
            }
            for f in files
        ]
        total += len(items)
        categories.append({"name": layer, "count": len(items), "items": items})

        default = DEFAULTS.get(layer)
        if default and not any(i["name"] == default for i in items):
            raise ValueError(f"Default '{default}' missing from {layer}")

    data = {
        "total": total,
        "layerOrder": LAYER_ORDER,
        "defaults": DEFAULTS,
        "categories": categories,
    }

    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"Wrote {total} traits across {len(categories)} categories → {OUTPUT}")


if __name__ == "__main__":
    main()
