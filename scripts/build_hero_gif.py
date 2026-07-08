#!/usr/bin/env python3
"""Build assets/moze-hero.gif from gallery.json."""

from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GALLERY = ROOT / "data" / "gallery.json"
OUT = ROOT / "assets" / "moze-hero.gif"
SIZE = 400


def main() -> None:
    with GALLERY.open() as f:
        gallery = json.load(f)

    frames = []
    for item in gallery:
        path = ROOT / "assets" / "collection" / f"{item['id']}.png"
        if not path.exists():
            continue
        img = Image.open(path).convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 248, 238, 255))
        bg.paste(img, (0, 0), img)
        frames.append(bg.convert("RGB").resize((SIZE, SIZE), Image.Resampling.LANCZOS))

    if not frames:
        raise SystemExit("No gallery frames found")

    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=700,
        loop=0,
        optimize=True,
    )
    print(f"Wrote {OUT} ({len(frames)} frames, {os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()