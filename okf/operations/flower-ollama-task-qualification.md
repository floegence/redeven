---
type: Qualification Contract
title: Flower Ollama task qualification
tags: [flower, ollama, tasks, qualification]
lifecycle: active_evidence
reviewed_at: "2026-10-25"
---
# Summary

The opt-in task qualification calls the selected installed Ollama model through
the production Flower service and published Floret runtime. The model chooses
real tool calls; assertions inspect actual files, terminal processes, canonical
views, and the workspace stream. A failed scenario remains a failure, with no
simulated replacement or automatic rerun. Tests own isolated state and stop only
their own services and tools. Source configuration and credentials stay unchanged.

# Contract

Run `scripts/check_flower_tasks_ollama.sh` explicitly; `--interleavings` selects
combined operation cases. Every request uses the selected installed model, with
real chosen tools and exact Ollama Chat history. Observe actual effects and canonical
state; retain failure without simulation or automatic reruns.

| Scenario | Required observable result |
| --- | --- |
| Data/file task | Read structured data, compute sum, write/verify, modify in a later turn |
| Stop generation | Prompt acceptance, cancelled terminal state, no failure retry of cancellation, later task accepted |
| Stop terminal | Preserve confirmed initial effect, kill owned process, prevent delayed write, accept later task |
| Queue edits | Optimistic text match, stale edit rejection, reorder/delete and exact execution/user-text order |
| Send now | Cancel active provider request and execute selected queued task |
| Concurrent duplicate input | One retained task; conflicting content for same key rejected across stop/restart/promotion |
| Stop/restart at generation, approval or Ask User | Original stop identity, stale response rejection and exactly-once retained queue promotion |
| Queue edits during approval | Stop/restart before promotion; late approval cannot execute cancelled tool |
| Duplicate approvals | Same answer replays before/after restart, conflicting answer rejects, one actual effect |
| Cancel Ask User | Replacement input runs after restart; stale answer cannot revive task |
| Two interrupted continuations | Concurrent Retry/queued input retain original write exactly once |
| Duplicate send-now | Consumed items reject edits; restart replay does not reexecute |
| Permission/model change | Queued permission changes, active model-change rejection and immutable existing approval snapshot |
| Repeated permission transitions | Readonly/approval, stop/restart, stale/fresh approval, post-effect failure, downgrade/retry and restored full-access effects |

Tests own isolated state, services and tools. Remove temporary stores/files after
each case while retaining reports; source configuration and credentials stay unchanged.

# Boundaries

[Thread runtime](../ai/floret-thread-runtime.md) owns command/cancellation/queue/Retry
semantics. Controlled transport faults qualify recovery, not natural endpoint
reliability. Passing service tests does not certify Desktop click-through with the
live model. Deterministic delegation/permission tests remain separate evidence.

# Evidence

- `redeven:scripts/check_flower_tasks_ollama.sh`: explicit published-dependency runner.
- `redeven:internal/ai/run_e2e_ollama_tasks_test.go`: model-driven effects, faults and product commands.
- `redeven:internal/ai/run_e2e_ollama_interleavings_test.go`: races, stale responses, restart and compaction.
- Deterministic cases cover role-free schema, exact delegation text, all three inherited
  permission modes, historical readonly and canonical steering/spawn replay.
