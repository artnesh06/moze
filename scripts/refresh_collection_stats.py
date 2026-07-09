#!/usr/bin/env python3
"""Refresh data/collection-stats.json from OpenSea public API + Robinhood RPC."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "collection-stats.json"
CA = "0x0e579bcec21ae9dc5400db46cab67d5a8d0a58cc"
RPC = "https://rpc.mainnet.chain.robinhood.com"


def curl_json(url: str) -> dict:
    r = subprocess.run(
        ["curl", "-sS", "-m", "25", "-H", "Accept: application/json", url],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr or f"curl failed {url}")
    return json.loads(r.stdout)


def onchain_supply() -> int | None:
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{"to": CA, "data": "0x18160ddd"}, "latest"],
        }
    )
    r = subprocess.run(
        [
            "curl",
            "-sS",
            "-m",
            "20",
            "-H",
            "Content-Type: application/json",
            "-d",
            payload,
            RPC,
        ],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return None
    try:
        res = json.loads(r.stdout)
        return int(res["result"], 16)
    except Exception:
        return None


def eth_fmt(x) -> str:
    if x is None:
        return "—"
    x = float(x)
    if x == 0:
        return "0 ETH"
    s = f"{x:.5f}".rstrip("0").rstrip(".")
    return f"{s} ETH"


def main() -> None:
    col = curl_json("https://api.opensea.io/api/v2/collections/mozestreetart")
    stats = curl_json("https://api.opensea.io/api/v2/collections/mozestreetart/stats")
    t = stats.get("total") or {}
    minted = int(col.get("total_supply") or col.get("unique_item_count") or 0)
    chain_n = onchain_supply()
    if chain_n:
        minted = chain_n
    holders = int(t.get("num_owners") or 0)
    floor = t.get("floor_price")
    vol = float(t.get("volume") or 0)
    sales = int(t.get("sales") or 0)

    out = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "supply_max": 1000,
        "minted": minted,
        "price": "FREE",
        "collection": "Moze Street Art",
        "chain": "Robinhood",
        "platform": "OpenSea",
        "holders": holders,
        "offer": eth_fmt(floor),
        "floor_eth": floor,
        "volume_all": eth_fmt(vol),
        "volume_all_eth": vol,
        "sales": sales,
        "listed": None,
        "opensea_url": "https://opensea.io/collection/mozestreetart/overview",
        "source": "opensea-api-v2+rpc",
        "note": "offer = OpenSea floor price; listed count needs OpenSea API key",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(out, indent=2))
    print(f"Wrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
