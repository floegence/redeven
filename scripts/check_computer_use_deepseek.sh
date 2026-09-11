#!/usr/bin/env bash
set -euo pipefail

: "${REDEVEN_COMPUTER_USE_E2E:?set REDEVEN_COMPUTER_USE_E2E=1 to run the online qualification}"
if [[ "${REDEVEN_COMPUTER_USE_E2E}" != "1" ]]; then
  echo "computer-use qualification disabled (set REDEVEN_COMPUTER_USE_E2E=1)"
  exit 0
fi
: "${REDEVEN_COMPUTER_USE_E2E_BASE_URL:?set the DeepSeek Responses base URL}"
: "${REDEVEN_COMPUTER_USE_E2E_API_KEY:?set the DeepSeek API key in the environment}"
model="${REDEVEN_COMPUTER_USE_MODEL:-deepseek-v4-flash-vision-exp}"
if [[ "$model" != "deepseek-v4-flash-vision-exp" ]]; then
  echo "qualification requires deepseek-v4-flash-vision-exp" >&2
  exit 1
fi

# The test owns a deterministic BrowserTarget fixture and sends only Redeven
# typed functions. The API key is consumed by the provider adapter and is
# never passed as a test argument or printed by the test process.
export GOWORK=off
go test ./internal/ai -run '^TestDeepSeekComputerUseQualification$' -count=1 -v
