#!/usr/bin/env bash
# Runs the customer flow at each ramp level (10, 50, 100, 250 VUs) for clean per-level numbers,
# saving a JSON summary per level under results-raw/. Local/dev only.
#
#   BASE_URL=http://localhost:3000/api/v1 bash load-tests/run-levels.sh
#
# Requires the k6 binary at load-tests/.bin/k6.exe (download instructions in README.md).
set -u
cd "$(dirname "$0")/.."
K6="load-tests/.bin/k6.exe"
BASE_URL="${BASE_URL:-http://localhost:3000/api/v1}"
DURATION="${DURATION:-30s}"
mkdir -p load-tests/results-raw
for VUS in 10 50 100 250; do
  echo "===== level: ${VUS} VUs for ${DURATION} ====="
  VUS="$VUS" DURATION="$DURATION" BASE_URL="$BASE_URL" \
    SUMMARY_OUT="load-tests/results-raw/level-${VUS}.summary.json" \
    "$K6" run load-tests/customer-flow.js
done
