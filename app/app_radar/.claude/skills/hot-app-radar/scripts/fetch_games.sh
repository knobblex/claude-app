#!/usr/bin/env bash
set -euo pipefail

# 运行时数据统一落 <repo>/data/sub_app/radar/。
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../.." && pwd)"
SNAPSHOT_DIR="$REPO_ROOT/data/sub_app/radar/snapshots"
DATE=$(date +%Y-%m-%d)
mkdir -p "$SNAPSHOT_DIR"

COUNTRIES=(cn us jp)
# legacy iTunes RSS feed names → normalized chart label
declare -a CHARTS=(
  "topfreeapplications:top-free"
  "toppaidapplications:top-paid"
  "topgrossingapplications:top-grossing"
)
GENRE_GAMES=6014
LIMIT=100

FAIL=0
for country in "${COUNTRIES[@]}"; do
  for entry in "${CHARTS[@]}"; do
    feed_name="${entry%%:*}"
    chart_label="${entry##*:}"
    OUTFILE="$SNAPSHOT_DIR/games-${country}-${chart_label}-${DATE}.json"
    URL="https://itunes.apple.com/${country}/rss/${feed_name}/limit=${LIMIT}/genre=${GENRE_GAMES}/json"
    RAW="$OUTFILE.raw.tmp"
    if curl -sSL -f -A "hot-app-radar/0.1" -o "$RAW" "$URL"; then
      # Normalize legacy iTunes RSS into the same shape diff_games.py expects:
      # { "feed": { "results": [ { "id", "name", "artistName", "url", "genres":[{"name"}] } ] } }
      python3 - "$RAW" "$OUTFILE.tmp" "$country" "$chart_label" <<'PY'
import json, sys, pathlib
src, dst, country, chart = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
data = json.loads(pathlib.Path(src).read_text())
entries = data.get("feed", {}).get("entry", []) or []
# When only one entry, iTunes returns dict instead of list
if isinstance(entries, dict):
    entries = [entries]
results = []
for e in entries:
    track_id = e.get("id", {}).get("attributes", {}).get("im:id")
    if not track_id:
        continue
    name = e.get("im:name", {}).get("label", "")
    artist = e.get("im:artist", {}).get("label", "")
    url = e.get("id", {}).get("label", "")
    cat = e.get("category", {}).get("attributes", {})
    genres = []
    if cat.get("label"):
        genres.append({"name": cat.get("label"), "genreId": cat.get("im:id")})
    results.append({
        "id": str(track_id),
        "name": name,
        "artistName": artist,
        "url": url,
        "genres": genres,
    })
out = {"feed": {"country": country, "chart": chart, "results": results}}
pathlib.Path(dst).write_text(json.dumps(out, ensure_ascii=False, indent=2))
PY
      mv "$OUTFILE.tmp" "$OUTFILE"
      rm -f "$RAW"
      echo "Wrote $OUTFILE"
    else
      echo "Warning: failed to fetch $URL" >&2
      rm -f "$RAW"
      FAIL=$((FAIL+1))
    fi
  done
done

if [[ "$FAIL" -gt 0 ]]; then
  echo "Note: $FAIL game chart(s) failed to fetch — continuing with what we have" >&2
fi
