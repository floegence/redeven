#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

cd "$ROOT_DIR"

paths=(
  internal/flower_ui/src
  desktop/src/welcome/flower
  internal/envapp/ui_src/src/ui
  internal/codeapp/appserver
  internal/ai
  cmd/ai-loop-eval
)

old_protocol_pattern='FlowerThreadLiveSnapshot|FlowerThreadLiveUpdate|FlowerThreadLiveUpdatesResponse|mapFlowerLiveSnapshot|projectFlowerLiveSnapshot|applyFlowerLiveUpdate|listThreadLiveUpdates|active_run\.patched|clear_active_run|live/updates|event_cursor|FlowerLiveActiveRun|FlowerRuntimeScopeID|liveSnapshot|live snapshot'

if rg -n "$old_protocol_pattern" "${paths[@]}" -S; then
  echo "old Flower live protocol surface is still present" >&2
  exit 1
fi

if rg -n 'transcriptRenderSignature|getActiveRunSnapshot|ActiveRunSnapshot' internal/flower_ui/src internal/ai cmd/ai-loop-eval -S; then
  echo "old Flower streaming snapshot/render signature path is still present" >&2
  exit 1
fi

if rg -n 'anchor_message_id|AnchorMessageID|context\.compaction\.(started|applied)' internal/flower_ui/src desktop/src/welcome/flower internal/envapp/ui_src/src/ui internal/ai -S; then
  echo "old Flower context compaction timeline protocol is still present" >&2
  exit 1
fi
