#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1 && pwd)
if [ "$#" -ne 2 ]; then
  echo 'Usage: scripts/run_controlplane_capacity.sh <manifest.json> <private-output-directory>' >&2
  exit 2
fi
manifest=$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$1")
output=$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$2")
python3 - "$manifest" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)
if len(manifest.get("runtime_configs", [])) < 10000:
    raise SystemExit("capacity qualification requires at least 10,000 unique enrolled Runtime configurations")
if len(set(manifest["runtime_configs"])) != len(manifest["runtime_configs"]):
    raise SystemExit("Runtime fixture paths must be unique")
if not manifest.get("environment"):
    raise SystemExit("record the actual Region, Control Cell, database, and load-host specifications")
scenario = manifest.get("scenario", "steady")
if scenario not in ("steady", "recovery"):
    raise SystemExit("scenario must be steady or recovery")
workloads = {entry.get("name"): entry for entry in manifest.get("http", [])}
if scenario == "steady" and (workloads.get("environment_query", {}).get("rps", 0) < 500 or workloads.get("session_init", {}).get("rps", 0) < 50):
    raise SystemExit("steady qualification requires 500 environment queries/s and 50 session issuances/s")
if manifest.get("duration_seconds", 0) < 1800:
    raise SystemExit("qualification requires at least 30 minutes; use 7,200 seconds at the default 10s policy")
PY
mkdir -p "$output"
chmod 700 "$output"
cd "$ROOT_DIR"
REDEVEN_CAPACITY_MANIFEST="$manifest" REDEVEN_CAPACITY_OUTPUT="$output" \
  GOWORK=off go test ./internal/agent -run '^TestControlplaneCapacityQualification$' \
  -count=1 -timeout=4h
