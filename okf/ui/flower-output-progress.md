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
then use the confirmed tool result. Published Floret v7.42.0 owns the generic
in-memory progress and preview lifecycle; Redeven interprets its own tool JSON
and presents the safe observations. No new journal records or schema changes
are required.

# Contract

## Model request

Each logical request and attempt has its own start, first-output time, last
semantic-progress time and estimated received output tokens. Text, reasoning and append-only tool argument
fragments count; final complete arguments count once only when no fragments
were streamed. ASCII characters contribute 0.25 tokens and other Unicode scalars
1.5 tokens, rounded up after accumulation. This estimate is separate from billed
usage and context pressure. Empty events do not end the initial wait. Midstream
pauses retain the last count. A replacement request or attempt resets it. After
15 seconds without semantic progress, the status says Waiting for model to
continue and shows the pause duration beside the unchanged token estimate.
Heartbeats, usage and empty fragments do not advance semantic progress. Hosted
tool execution keeps its own status; returning from it restores the ordinary
output wait. Local tools, approvals and user input never use this model-pause
presentation.

The existing status row shows total waiting seconds from three seconds onward,
and tokens during generation. Preparation, retry backoff, approvals and tool
execution keep their own status. The transport attaches a server sample time;
Flower anchors sampled elapsed time to `performance.now()` in the existing
detail cache. One local timer updates whole seconds and catches up after hidden
presentation or selection changes. New samples for the same attempt cannot move
the displayed age backward. New semantic progress resets only the pause age.
Cached reopen and reconnect use the canonical current sample. This browser clock
controls display only; [Floret request deadlines](../ai/model-provider-surface-and-history.md)
own timeout, failure and recovery. No timer events, ViewVersion changes, polling or
additional network requests are introduced. Only phase text is a live region;
numerical updates are readable without repeated automatic announcements.

## Progress symbol

The shared Flower mark retains five opaque white petals and a warm yellow
center. A slate outline makes the bloom readable on light surfaces independently
of inherited text color; white petals preserve its identity on dark surfaces.
Navigation, headers and the standalone SVG use the same artwork. Compact
progress, companion and Workbench slots strengthen the petal stroke without
enlarging their layout boxes or adding a badge or glow.

During model progress only the center gently breathes; the petals remain still
so the 16px silhouette stays readable. Reduced-motion preferences stop the
animation completely. The symbol is decorative beside the existing localized
status text and does not create another live announcement or execution state.

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

The edit row labels this phase Preparing changes. Its line-count tooltip
explains that the values preview changes being prepared and that the completed
tool supplies the actual counts. Desktop and Env App use the same localized
copy. User-facing preparation text never exposes argument-generation details
or claims that a file has already changed.

While live presentation is confirmed, argument-generation rows animate the
shared [writing pencil](flower-activity-interaction.md). This is generation
feedback, not an Activity running status or evidence of dispatch. Reduced-motion preferences suppress
the animation. Unconfirmed live transport, approval waits and settled results
keep static icons; confirmed execution uses the normal running animation.

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

- `redeven:internal/flower_ui/src/icons/FlowerIcon.tsx` — Shared opaque petal outline and warm center artwork.
- `redeven:internal/flower_ui/src/styles/flower.css` — Compact progress sizing and reduced-motion center animation.
- `redeven:internal/envapp/ui_src/src/styles/flowerIconContrast.browser.test.tsx` — Rendered theme contrast, 16px stroke, static asset and motion acceptance.
- `redeven:internal/ai/flower_argument_preview.go` — Bounded incremental JSON and patch parsing without effects.
- `redeven:internal/ai/flower_argument_preview_test.go` — Byte partitions, Unicode, invalid JSON, independent calls and patch formats.
- `redeven:internal/ai/model_gateway.go` — True argument fragments across native adapters, including late identity.
- `redeven:internal/ai/flower_runtime_current_publisher_test.go` — Numerical coalescing and immediate first-output and attempt boundaries.
- `redeven:internal/flower_ui/src/providerRequestProgress.ts` — Server-sampled monotonic timer anchoring.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` — Preview presentation and exact canonical call joining.
- `redeven:internal/envapp/ui_src/src/ui/FlowerProgressIndicator.test.tsx` — The 2.999/3 second threshold, stalls, retries and cached waiting age.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.streamingStability.browser.test.tsx` — Stable row transition, absent unvalidated actions and actual zero replacement.
- `redeven:scripts/check_flower_streaming_performance.mjs` — Chromium and isolated Desktop production-renderer acceptance with numerical streaming updates.
