#!/usr/bin/env python3
"""Compute today's candidate games from App Store game-chart snapshots.

Mirrors diff.py but operates on the `games-*` snapshot family written by
fetch_games.sh. Writes data/game_candidates.json. Enriches with iTunes
lookup for description, sub-genres, IAP flag, average rating.

First run (no yesterday snapshot): takes top FIRST_RUN_TOP_N per chart.
"""

import json
import sys
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

# 运行时数据统一落在 <repo>/data/sub_app/radar/。
# parents[6] = hot_app/（scripts/ -> hot-app-radar/ -> skills/ -> .claude/ -> app_radar/ -> app/ -> hot_app/）
RADAR_DATA = Path(__file__).resolve().parents[6] / "data" / "sub_app" / "radar"
SNAPSHOT_DIR = RADAR_DATA / "snapshots"
SEEN_PATH = RADAR_DATA / "seen_games.json"
CANDIDATES_PATH = RADAR_DATA / "game_candidates.json"

RANK_JUMP_THRESHOLD = 20
FIRST_RUN_TOP_N = 30

TODAY = date.today().isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()

COUNTRIES = ("cn", "us", "jp")
CHARTS = ("top-free", "top-paid", "top-grossing")


def load_seen() -> dict:
    if SEEN_PATH.exists():
        return json.loads(SEEN_PATH.read_text())
    return {}


def load_snapshot(name: str):
    p = SNAPSHOT_DIR / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError as e:
        print(f"Warning: {name} is not valid JSON: {e}", file=sys.stderr)
        return None


def candidates_from_games(seen: dict) -> list:
    out = []
    seen_ids = set()
    for country in COUNTRIES:
        for chart in CHARTS:
            today = load_snapshot(f"games-{country}-{chart}-{TODAY}.json")
            if not today:
                continue
            yesterday = load_snapshot(f"games-{country}-{chart}-{YESTERDAY}.json")
            today_results = today.get("feed", {}).get("results", []) or []
            yesterday_results = (
                (yesterday or {}).get("feed", {}).get("results", []) or []
            )
            yesterday_ranks = {
                r.get("id"): i + 1 for i, r in enumerate(yesterday_results) if r.get("id")
            }
            first_run = yesterday is None

            for i, r in enumerate(today_results):
                rank = i + 1
                track_id = r.get("id")
                if not track_id:
                    continue
                cid = f"game-{country}-{track_id}"
                if cid in seen or cid in seen_ids:
                    continue

                old_rank = yesterday_ranks.get(track_id)
                is_new = old_rank is None
                jumped = old_rank is not None and (old_rank - rank) >= RANK_JUMP_THRESHOLD

                if first_run:
                    if rank > FIRST_RUN_TOP_N:
                        continue
                    reason = f"{country.upper()} games {chart} 首次扫描 #{rank}"
                else:
                    if not (is_new or jumped):
                        continue
                    if is_new:
                        reason = f"{country.upper()} games {chart} 新进榜 #{rank}"
                    else:
                        reason = (
                            f"{country.upper()} games {chart} "
                            f"从 #{old_rank} 跳到 #{rank}"
                        )

                out.append({
                    "id": cid,
                    "source": f"appstore-game-{country}",
                    "country": country,
                    "chart": chart,
                    "track_id": track_id,
                    "name": r.get("name", ""),
                    "artist": r.get("artistName", ""),
                    "genres": [g.get("name") for g in r.get("genres", []) or []],
                    "url": r.get("url", ""),
                    "rank_today": rank,
                    "rank_yesterday": old_rank,
                    "reason": reason,
                })
                seen_ids.add(cid)
    return out


def enrich(candidates: list) -> None:
    by_country: dict = {}
    for c in candidates:
        by_country.setdefault(c["country"], []).append(c)

    for country, items in by_country.items():
        for batch_start in range(0, len(items), 100):
            batch = items[batch_start : batch_start + 100]
            ids = ",".join(str(c["track_id"]) for c in batch)
            qs = urllib.parse.urlencode({"id": ids, "country": country})
            url = f"https://itunes.apple.com/lookup?{qs}"
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": "hot-app-radar/0.1"}
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read())
            except Exception as e:
                print(f"Warning: iTunes lookup failed for {country}: {e}", file=sys.stderr)
                continue

            details = {
                str(r.get("trackId")): r
                for r in data.get("results", [])
                if r.get("trackId")
            }
            for c in batch:
                d = details.get(str(c["track_id"]))
                if d:
                    c["description"] = d.get("description", "")
                    c["seller"] = d.get("sellerName", "")
                    c["price"] = d.get("formattedPrice", "")
                    c["primary_genre"] = d.get("primaryGenreName", "")
                    c["sub_genres"] = d.get("genres", []) or []
                    c["bundle_id"] = d.get("bundleId", "")
                    c["content_rating"] = d.get("contentAdvisoryRating", "")
                    c["avg_rating"] = d.get("averageUserRating")
                    c["rating_count"] = d.get("userRatingCount")
                    c["min_os"] = d.get("minimumOsVersion", "")
                    # IAP signal: empty list / missing means no IAP; iTunes returns it sporadically
                    c["has_iap"] = bool(d.get("isGameCenterEnabled")) or bool(
                        d.get("features")
                    )


def main() -> None:
    seen = load_seen()
    cands = candidates_from_games(seen)
    enrich(cands)

    CANDIDATES_PATH.parent.mkdir(parents=True, exist_ok=True)
    CANDIDATES_PATH.write_text(
        json.dumps(cands, ensure_ascii=False, indent=2)
    )
    print(f"Wrote {len(cands)} game candidates to {CANDIDATES_PATH}")


if __name__ == "__main__":
    main()
