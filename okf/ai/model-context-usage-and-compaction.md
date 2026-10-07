---
type: AI Runtime Contract
title: Model context usage and compaction
description: Account provider usage, context pressure, compaction, and capacity failures without a second runtime authority.
tags: [ai, models, context, compaction]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Floret owns canonical context usage, compaction identity, token budgeting, and capacity failures. Redeven maps typed observations into Flower and applies the one-shot compact action. Confirmed usage remains distinct from estimates, compaction never replays an effect, and fixed overhead or unsupported capacity fails with an actionable typed error.

# Contract

## Usage and compaction

Context pressure and compaction presentation come from structured Floret runtime observations and the identity-bound context reader. During a live process, Redeven maps typed context status and compaction events into in-memory Flower events only; it does not persist those events, mapped context DTOs, or a context run cursor. Bootstrap and reconnect use the provider-free reader issued by the composition-root `runtime.Host`, validate the canonical `ThreadContextSnapshot`, and map usage plus terminal compaction facts into the response. Published Floret v7.25.2 rebuilds each snapshot identity from its canonical entry: a fork receives the destination ThreadID while retaining the historical TurnID, RunID, usage, and compaction facts. Redeven does not repair or reinterpret that identity. The legacy `Usage` field clears whenever a new canonical context policy starts. The split measurement snapshot retains confirmation across matching model and budget policies, while cumulative whole-thread totals remain preserved. A model switch therefore cannot expose the previous model as the new policy's latest sample or fail the identity check. A pure `/compact` turn with no attachment, context action, structured response, or secret answer receives one run-local `ManualCompactionSource` carrying the stable request identity. That source can be consumed once by the hosted turn; Redeven does not expose a separate idle compaction coordinator, public Host command, receipt, or lifecycle. Canonical operation identity and terminal outcome come only from validated Floret events and context reads.

Published Floret v7.25.2 owns canonical whole-thread token totals folded from committed final `provider_usage` journal facts. The same totals reach detail snapshots and committed live provider-usage events through one Redeven converter; failed, stale, stream-only, and uncommitted usage never enters the projection. Flower replaces totals when a confirmed live frame supplies them and preserves the last confirmed value when a projected-request frame omits them. It computes `cache_read / (input + cache_read + cache_write)` only for presentation, never accumulates samples, and shows unavailable only before valid totals arrive or when the denominator is zero. Published Floret v7.25.2 supplies `ContextUsage.Confirmed` and `ContextUsage.Estimate` through one canonical fold shared by live events and context reads. Redeven maps these snapshots once and replaces their samples; it never reconstructs confirmation from latest-status events. The composer shows only a small ring for the latest model-confirmed input; the percentage appears in its tooltip and accessible description. Estimates never replace that value, so estimate-to-measurement transitions cannot create artificial decreases. Before confirmation the ring remains unfilled and the tooltip shows a dash. The tooltip contains only context usage and Cache hit rate; current pressure still supplies warning color and a short actionable warning. No UI watermark or usage ledger is retained. Model or budget changes and successful compaction clear obsolete samples; failed, cancelled, and noop compactions retain them. Keyboard focus reveals details and Escape dismisses them. Runtime/Desktop compatibility follows the [current paired wire contract](../../internal/runtimeservice/compatibility_contract.json). Bootstrap, live transport, reconnect, and restart use the same mapper.

Run token limits preserve distinct field semantics across the Redeven/Floret boundary. Redeven passes `RunOptions.MaxInputTokens` directly to Floret `TurnLimits.MaxInputTokens`, where it limits cumulative provider input usage across the entire hosted run. An explicit `RunOptions.MaxOutputTokens` is both the per-provider-request output ceiling and the Floret context output headroom. When the run leaves that option unset, context policy reserves the resolved model capability's maximum output while the provider request remains unset and keeps its normal gateway default; model capability must not disappear into Floret's unrelated generic 64K fallback. Redeven does not add input and output limits into a derived `MaxTotalTokens`, and an unset input limit does not create an implicit cumulative token budget.

Real context qualification is opt-in and uses an isolated Store plus one configured official DeepSeek provider containing `deepseek-v4-flash` and `deepseek-v4-pro`. A loopback recording proxy forwards real requests unchanged but retains only hashes, model names, roles, tool names, finish reasons, marker presence, and the first differing index; it never records credentials or prompt bodies. Flash full access to Pro readonly to Flash full access must finish naturally, preserve complete canonical history and the returning Flash render prefix, use the current per-Turn System Prompt and tools, clear cross-surface continuation metadata, and avoid compaction for small input. A separate real Flash Turn must call `ask_user`, resume with one paired tool call/result, keep the same frozen System Prompt and tools, and then stop naturally. The same lane validates completed manual and pressure compaction, positive token savings, render-generation reset, and retained marker presence. Fake-provider tests remain the deterministic CI layer.

# Boundaries

Redeven owns presentation and localized recovery guidance. Floret owns provider usage folds, context snapshots, compaction, and typed capacity errors. The UI cannot create a context ledger, retry an unknown effect, or treat model weight metadata as proof of the active serving window.

# Evidence

- `redeven:internal/ai/floret_events.go:105` - Structured context observations update only the live Flower stream.
- `redeven:internal/ai/floret_manual_compaction.go:18` - Pure `/compact` input creates one run-local request.
- `redeven:internal/ai/floret_manual_compaction_test.go:10` - Covers exact compact admission and one-shot consumption.
- `redeven:internal/ai/floret_runtime_context_policy_test.go:5` - Model capability limits supply default Floret headroom without overriding explicit budgets.
- `redeven:internal/ai/run_e2e_deepseek_context_test.go:95` - Opt-in DeepSeek lane checks marker retention and continuation fences.
- `redeven:internal/ai/run_e2e_deepseek_compaction_test.go:29` - Covers manual and automatic compact checkpoints.
- `redeven:scripts/check_flower_context_deepseek.sh:1` - Runs isolated paid context qualification.
- `redeven:internal/flower_ui/src/chat/flowerContextPresentation.ts` - Context tooltip uses canonical cumulative totals.
- `redeven:internal/ai/run_error_code_test.go` - Actionable context failures and numeric-only diagnostics.
- `redeven:internal/ai/flower_current_projection_test.go` - Matching current/summary diagnostics and retry clearing.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.contextErrors.test.shared.tsx` - Recovery controls and unknown-effect boundary.
