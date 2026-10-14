#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git diff --cached --check
node scripts/check_staged_third_party_notices.mjs
node scripts/check_readme_localizations.mjs
./scripts/open_source_hygiene_check.sh --staged
