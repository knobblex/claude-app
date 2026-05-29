#!/usr/bin/env bash
set -euo pipefail

# 运行时数据统一落 <repo>/data/sub_app/radar/；凭证读 <repo>/.env。
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../.." && pwd)"
SNAPSHOT_DIR="$REPO_ROOT/data/sub_app/radar/snapshots"
DATE=$(date +%Y-%m-%d)
OUTFILE="$SNAPSHOT_DIR/ph-$DATE.json"

mkdir -p "$SNAPSHOT_DIR"

if [[ -z "${PRODUCT_HUNT_TOKEN:-}" && -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$REPO_ROOT/.env"
  set +a
fi

if [[ -z "${PRODUCT_HUNT_TOKEN:-}" ]]; then
  echo "Error: PRODUCT_HUNT_TOKEN not set." >&2
  echo "Get one at https://www.producthunt.com/v2/oauth/applications and add to $REPO_ROOT/.env:" >&2
  echo "  PRODUCT_HUNT_TOKEN=your_developer_token_here" >&2
  exit 1
fi

read -r -d '' QUERY <<'GRAPHQL' || true
{
  "query": "{ posts(order: VOTES, first: 50) { edges { node { id slug name tagline description votesCount url website createdAt topics(first: 5) { edges { node { name } } } } } } }"
}
GRAPHQL

HTTP_CODE=$(curl -sS -o "$OUTFILE.tmp" -w "%{http_code}" -X POST https://api.producthunt.com/v2/api/graphql \
  -H "Authorization: Bearer $PRODUCT_HUNT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$QUERY")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Error: Product Hunt API returned HTTP $HTTP_CODE" >&2
  cat "$OUTFILE.tmp" >&2
  rm -f "$OUTFILE.tmp"
  exit 1
fi

mv "$OUTFILE.tmp" "$OUTFILE"
echo "Wrote $OUTFILE"
