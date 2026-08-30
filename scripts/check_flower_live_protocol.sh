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

obsolete_read_state_pattern='activity_signature|last_seen_activity_signature|last_seen_waiting_prompt_id|last_read_message_at_unix_ms|last_read_updated_at_unix_s'
obsolete_read_state_paths=(
  internal/threadreadstate/store.go
  internal/codeapp/appserver/thread_read_state.go
  internal/ai/flower_live_types.go
  internal/flower_ui/src
  desktop/src/welcome/flower
  internal/envapp/ui_src/src/ui
)
if rg -n "$obsolete_read_state_pattern" "${obsolete_read_state_paths[@]}" -S; then
  echo "obsolete Flower read acknowledgement fields are still present" >&2
  exit 1
fi

if rg -n 'anchor_message_id|AnchorMessageID|context\.compaction\.(started|applied)' internal/flower_ui/src desktop/src/welcome/flower internal/envapp/ui_src/src/ui internal/ai -S; then
  echo "old Flower context compaction timeline protocol is still present" >&2
  exit 1
fi

retired_effect_protocol_pattern='RetryEffect|retry_effect|effect_retry|retryEffect|AcknowledgeUnknownRisk|acknowledge_unknown_risk'
if rg -n "$retired_effect_protocol_pattern" "${paths[@]}" -S -g '!**/*test*'; then
  echo "retired Flower unknown-effect retry protocol is still present" >&2
  exit 1
fi

retired_projection_pattern='assistant_draft|thinking_draft|\.AssistantDraft|\.ThinkingDraft'
if rg -n "$retired_projection_pattern" "${paths[@]}" -S -g '!**/*test*'; then
  echo "retired Floret projection fields are still present" >&2
  exit 1
fi
