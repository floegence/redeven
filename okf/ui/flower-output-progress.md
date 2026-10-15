---
type: UI Contract
title: Flower received output progress
description: Request-scoped output estimates, model waiting time, and safe streamed edit statistics.
tags: [flower, streaming, progress, tools]
timestamp: 2026-10-15T00:00:00Z
---

# Summary

Flower shows how long a dispatched model request has waited and how much output
has arrived. Edit rows show line counts while their arguments are generated,
then use the confirmed tool result. Published Floret v7.39.2 owns the generic
in-memory progress and preview lifecycle; Redeven interprets its own tool JSON
and presents the safe observations. No new journal records or schema changes
are required.

# Contract

## Model request

Each logical request and attempt has its own start, first-output time and
estimated received output tokens. Text, reasoning and append-only tool argument
fragments count; final complete arguments count once only when no fragments
were streamed. ASCII characters contribute 0.25 tokens and other Unicode scalars
1.5 tokens, rounded up after accumulation. This estimate is separate from billed
usage and context pressure. Empty events do not end the initial wait. Midstream
pauses retain the last count. A replacement request or attempt resets it.

The existing status row shows total waiting seconds from three seconds onward,
and tokens during generation. Preparation, retry backoff, approvals and tool
execution keep their own status. The transport attaches a server sample time;
Flower anchors sampled elapsed time to `performance.now()` in the existing
detail cache. One local timer updates whole seconds and catches up after hidden
presentation or selection changes. New samples for the same attempt cannot move
the displayed age backward. No timer events, ViewVersion changes, polling or
additional network requests are introduced. Only phase text is a live region;
numerical updates are readable without repeated automatic announcements.

## Edit arguments

The frozen tool definition supplies one optional argument preview parser per
call. Redeven registers parsers only for `file.edit`, `file.write` and
`apply_patch`. They receive append-only JSON fragments and completion, without
filesystem access, execution context, resource resolution or authorization.
Their input budget is 1 MiB per call, with bounded JSON depth and field counts.
Malformed, duplicate, excessive or incomplete arguments disable that preview
without changing official validation or dispatch.

`file.edit` counts received old and new lines, then corrects common prefix and
suffix using the existing pure diff rule once both strings close. `replace_all`
previews one replacement snippet. `file.write` shows received content additions;
unknown deletions are absent. `apply_patch` counts signed body lines in both
supported patch formats, excluding structural headers and context. Empty
content, CRLF and an optional trailing newline have explicit tests.

Unvalidated previews are separate typed presentation blocks appended to the
current response. They have no ordinal, ToolInvocation, Activity status, file
action, disclosure or approval control. Exact ThreadID, TurnID, RunID and CallID
join the preview to a validated call using one stable row identity. The current
request identity filters obsolete attempts. Counts remain through approval and
execution. Terminal results replace them entirely, including explicit zero;
failures, refusal, cancellation or missing actual statistics never inherit
preview counts. A typed `noop` result renders zero even when JSON omits zero
integer fields.

Floret's thread actor owns the sole current preview snapshot. Reconnect and
canonical refresh retain valid in-memory observations; restart does not recover
them. [Live current publication](flower-live-timeline.md) retains its sole 50 ms
coalescing boundary. Numbers are not structural boundary keys; first output,
request changes, preview removal, completion and terminal results flush promptly.
[Confirmed file Activity](flower-file-activity.md) remains the durable outcome.

# Boundaries

Floret owns request accounting and ephemeral thread snapshots. Redeven's pure
argument parsers supply only display names and optional counts; they cannot
authorize or execute edits. The browser derives presentation and elapsed time
from those snapshots. Canonical tool results remain the only durable change
facts, and supersede every provisional count.

# Evidence

- `redeven:internal/ai/flower_argument_preview.go` — Bounded incremental JSON and patch parsing without effects.
- `redeven:internal/ai/flower_argument_preview_test.go` — Byte partitions, Unicode, invalid JSON, independent calls and patch formats.
- `redeven:internal/ai/model_gateway.go` — True argument fragments across native adapters, including late identity.
- `redeven:internal/ai/flower_runtime_current_publisher_test.go` — Numerical coalescing and immediate first-output and attempt boundaries.
- `redeven:internal/flower_ui/src/providerRequestProgress.ts` — Server-sampled monotonic timer anchoring.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` — Preview presentation and exact canonical call joining.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProgressIndicator.test.tsx` — The 2.999/3 second threshold, stalls, retries and cached waiting age.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx` — Stable row transition, absent unvalidated actions and actual zero replacement.
- `redeven:scripts/check_flower_streaming_performance.mjs` — Chromium and isolated Desktop production-renderer acceptance with numerical streaming updates.
