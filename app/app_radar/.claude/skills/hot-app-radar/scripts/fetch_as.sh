#!/usr/bin/env bash
set -euo pipefail

# 运行时数据统一落 <repo>/data/sub_app/radar/。
# 6 个 .. 从 scripts/ 一路爬回 hot_app/ 根。
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../.." && pwd)"
SNAPSHOT_DIR="$REPO_ROOT/data/sub_app/radar/snapshots"
DATE=$(date +%Y-%m-%d)
mkdir -p "$SNAPSHOT_DIR"

COUNTRIES=(cn us jp)
CHARTS=(top-free top-paid)

FAIL=0
for country in "${COUNTRIES[@]}"; do
  for chart in "${CHARTS[@]}"; do
    OUTFILE="$SNAPSHOT_DIR/as-${country}-${chart}-${DATE}.json"
    URL="https://rss.marketingtools.apple.com/api/v2/${country}/apps/${chart}/100/apps.json"
    if curl -sSL -f -o "$OUTFILE.tmp" "$URL"; then
      mv "$OUTFILE.tmp" "$OUTFILE"
      echo "Wrote $OUTFILE"
    else
      echo "Warning: failed to fetch $URL" >&2
      rm -f "$OUTFILE.tmp"
      FAIL=$((FAIL+1))
    fi
  done
done

if [[ "$FAIL" -gt 0 ]]; then
  echo "Note: $FAIL chart(s) failed to fetch — continuing with what we have" >&2
fi
