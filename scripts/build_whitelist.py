#!/usr/bin/env python3
"""Build data/whitelist.json from moze snapshot.csv."""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source" / "moze snapshot.csv"
OUTPUT = ROOT / "data" / "whitelist.json"


def main() -> None:
    wallets: list[str] = []
    with SOURCE.open(newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            addr = row[0].strip().lower()
            if addr.startswith("0x") and len(addr) == 42:
                wallets.append(addr)

    wallets = sorted(set(wallets))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(wallets, f, indent=2)
        f.write("\n")

    print(f"Wrote {len(wallets)} wallets → {OUTPUT}")


if __name__ == "__main__":
    main()