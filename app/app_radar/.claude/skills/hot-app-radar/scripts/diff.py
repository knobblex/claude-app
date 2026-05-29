#!/usr/bin/env python3
"""Compute today's candidate apps from snapshots.

Reads today's and yesterday's snapshot JSONs, identifies apps that are:
  - newly entered chart, OR
  - jumped up >= RANK_JUMP_THRESHOLD ranks, OR
  - PH posts with >= PH_VOTES_THRESHOLD votes today

Filters out apps already in seen.json. Enriches App Store candidates with
full metadata via the iTunes lookup API. Writes data/candidates.json.

On first run (no yesterday snapshot), takes top FIRST_RUN_TOP_N from each chart.
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
SEEN_PATH = RADAR_DATA / "seen.json"
CANDIDATES_PATH = RADAR_DATA / "candidates.json"

RANK_JUMP_THRESHOLD = 20
PH_VOTES_THRESHOLD = 50
FIRST_RUN_TOP_N = 30

TODAY = date.today().isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()


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


def candidates_from_ph(seen: dict) -> list:
    today = load_snapshot(f"ph-{TODAY}.json")
    if not today:
        return []
    if "errors" in today:
        print(f"Warning: PH response has errors: {today['errors']}", file=sys.stderr)
        return []
    posts = today.get("data", {}).get("posts", {}).get("edges", [])
    out = []
    for edge in posts:
        node = edge.get("node", {})
        cid = f"ph-{node.get('id', '')}"
        if not cid or cid == "ph-":
            continue
        if cid in seen:
            continue
        votes = node.get("votesCount", 0) or 0
        if votes < PH_VOTES_THRESHOLD:
            continue
        topics = [
            t.get("node", {}).get("name", "")
            for t in node.get("topics", {}).get("edges", [])
        ]
        out.append({
            "id": cid,
            "source": "producthunt",
            "name": node.get("name", ""),
            "slug": node.get("slug", ""),
            "tagline": node.get("tagline", ""),
            "description": node.get("description", ""),
            "url": node.get("url", ""),
            "website": node.get("website", ""),
            "votes": votes,
            "topics": [t for t in topics if t],
            "reason": f"PH 当日票数 {votes}",
        })
    return out


def candidates_from_as(seen: dict) -> list:
    out = []
    seen_ids = set()
    countries = ("cn", "us", "jp")
    charts = ("top-free", "top-paid")
    for country in countries:
        for chart in charts:
            today = load_snapshot(f"as-{country}-{chart}-{TODAY}.json")
            if not today:
                continue
            yesterday = load_snapshot(f"as-{country}-{chart}-{YESTERDAY}.json")
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
                cid = f"as-{country}-{track_id}"
                if cid in seen or cid in seen_ids:
                    continue

                old_rank = yesterday_ranks.get(track_id)
                is_new = old_rank is None
                jumped = old_rank is not None and (old_rank - rank) >= RANK_JUMP_THRESHOLD

                if first_run:
                    if rank > FIRST_RUN_TOP_N:
                        continue
                    reason = f"{country.upper()} {chart} 首次扫描 #{rank}"
                else:
                    if not (is_new or jumped):
                        continue
                    if is_new:
                        reason = f"{country.upper()} {chart} 新进榜 #{rank}"
                    else:
                        reason = f"{country.upper()} {chart} 从 #{old_rank} 跳到 #{rank}"

                out.append({
                    "id": cid,
                    "source": f"appstore-{country}",
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


def enrich_as(candidates: list) -> None:
    by_country: dict = {}
    for c in candidates:
        if c.get("source", "").startswith("appstore"):
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
                    c["bundle_id"] = d.get("bundleId", "")


def main() -> None:
    seen = load_seen()
    ph = candidates_from_ph(seen)
    as_cands = candidates_from_as(seen)
    enrich_as(as_cands)
    candidates = ph + as_cands

    CANDIDATES_PATH.parent.mkdir(parents=True, exist_ok=True)
    CANDIDATES_PATH.write_text(
        json.dumps(candidates, ensure_ascii=False, indent=2)
    )
    print(f"Wrote {len(candidates)} candidates to {CANDIDATES_PATH}")
    print(f"  - {len(ph)} from Product Hunt")
    print(f"  - {len(as_cands)} from App Store")


if __name__ == "__main__":
    main()
