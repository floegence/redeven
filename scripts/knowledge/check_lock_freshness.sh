#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." &> /dev/null && pwd)
LOCK_PATH="$ROOT_DIR/internal/knowledge/generated/knowledge_lock.json"

REDEVEN_AGENT_ROOT="$ROOT_DIR" python3 - <<"PY"
import json
import os
import re
import sys
from datetime import datetime

root_dir = os.environ.get("REDEVEN_AGENT_ROOT", "").strip()
if not root_dir:
    print("missing REDEVEN_AGENT_ROOT", file=sys.stderr)
    sys.exit(1)
path = os.path.join(root_dir, "internal", "knowledge", "generated", "knowledge_lock.json")
with open(path, "r", encoding="utf-8") as f:
    lock = json.load(f)

errors = []
if int(lock.get("schema_version", 0)) <= 0:
    errors.append("schema_version must be positive")

commit = str(lock.get("redeven_source_commit", "")).strip()
if not re.match(r"^[0-9a-f]{40}$", commit):
    errors.append("redeven_source_commit must be a 40-char git commit hash")

model_id = str(lock.get("generator", {}).get("model_id", "")).strip()
if not model_id:
    errors.append("generator.model_id is required")

prompt_version = str(lock.get("generator", {}).get("prompt_version", "")).strip()
if not prompt_version:
    errors.append("generator.prompt_version is required")

generated_at = str(lock.get("generated_at", "")).strip()
try:
    datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
except Exception:
    errors.append("generated_at must be RFC3339 timestamp")

for key in ("inputs_sha256", "outputs_sha256"):
    value = str(lock.get(key, "")).strip()
    if not re.match(r"^[0-9a-f]{64}$", value):
        errors.append(f"{key} must be a 64-char sha256 hex")

if errors:
    print("knowledge lock freshness check failed:", file=sys.stderr)
    for item in errors:
        print(f"- {item}", file=sys.stderr)
    sys.exit(1)
PY
