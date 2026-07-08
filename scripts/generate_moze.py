#!/usr/bin/env python3
"""Generate Moze NFT images by compositing trait layers."""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TRAITS_JSON = ROOT / "data" / "traits.json"
ASSETS = ROOT / "assets"
OUT_SIZE = 1000


def load_traits() -> dict:
    with TRAITS_JSON.open() as f:
        return json.load(f)


def trait_item(traits: dict, category: str, name: str) -> str | None:
    for cat in traits["categories"]:
        if cat["name"] != category:
            continue
        for item in cat["items"]:
            if item["name"] == name:
                rel = item["image"].replace("assets/", "")
                return str(ASSETS / rel.replace("%20", " ").replace("%23", "#"))
    return None


def is_blank(name: str | None) -> bool:
    return not name or name.lower().startswith("blank")


def open_layer(path: str) -> Image.Image:
    return Image.open(path).convert("RGBA")


def compose(traits: dict, selected: dict[str, str]) -> Image.Image:
    canvas: Image.Image | None = None

    for layer in traits["layerOrder"]:
        name = selected.get(layer)
        if is_blank(name):
            continue

        path = trait_item(traits, layer, name)
        if not path or not Path(path).exists():
            raise FileNotFoundError(f"Missing layer: {layer}/{name}")

        img = open_layer(path).resize((OUT_SIZE, OUT_SIZE), Image.Resampling.LANCZOS)

        if canvas is None:
            canvas = img if layer == "BACKGROUND" else Image.new("RGBA", (OUT_SIZE, OUT_SIZE), (255, 248, 238, 255))
            if layer != "BACKGROUND":
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Moze NFT PNGs from trait layers")
    parser.add_argument("-o", "--output", default="generated-moze.png", help="Output PNG path")
    parser.add_argument("-r", "--random", action="store_true", help="Randomize all traits")
    parser.add_argument("-t", "--traits", help="Traits as BACKGROUND=Army,SKIN=Doll,...")
    parser.add_argument("-n", "--count", type=int, default=1, help="How many to generate (with --random)")
    args = parser.parse_args()

    traits = load_traits()

    if args.random:
        out = Path(args.output)
        stem, suffix = out.stem, out.suffix or ".png"
        parent = out.parent
        parent.mkdir(parents=True, exist_ok=True)

        for i in range(args.count):
            selected = random_traits(traits)
            image = compose(traits, selected)
            path = parent / f"{stem}-{i + 1}{suffix}" if args.count > 1 else out
            image.save(path)
            print(path)
            print("  ", ", ".join(f"{k}={selected[k]}" for k in traits["layerOrder"] if not is_blank(selected.get(k))))
        return

    selected = parse_traits_arg(args.traits) if args.traits else dict(traits["defaults"])
    image = compose(traits, selected)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)
    print(out)


if __name__ == "__main__":
    main()