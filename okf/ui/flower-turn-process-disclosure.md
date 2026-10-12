---
type: UI Contract
title: Flower terminal turn process disclosure
description: Offer manual disclosure for ended work and automatically collapse successful work with canonical final boundaries.
tags: [ui, flower, turns, disclosure, accessibility]
timestamp: 2026-10-12T00:00:00Z
---
# Summary

Published Floret v7.29.0 owns each turn's identity, outcome, final output boundary and durations. Flower consumes only validated detail accepted by ThreadCache. Ended ordinary turns offer manual process disclosure; successful turns with complete final references default to collapsed. Failure, cancellation, interruption and incomplete history default to expanded. Users, resolved clarification answers and every final segment remain visible in their original order; unknown assistant output is never hidden. Pending interactions remain expanded without a turn disclosure control. Reading protection overrides automatic collapse once, without a later timer.

# Contract

## Canonical facts and eligibility

ThreadView and HistoryPage expose `turns`: exact TurnID and RunID, optional control kind, start and terminal time, outcome, elapsed/wait/work milliseconds, explicit ordered `final_item_ids` and `final_boundary_complete`. Redeven passes these facts through its typed current boundary. Summary updates cannot author them or trigger collapse. Invalid identities, durations or final references reject the current view before cache admission, preserving the prior valid detail.

The Floret journal retains optional response segmentation and accepted final-entry metadata. Output IDs remain stable from first publication; provider length continuation may contribute multiple final segments. Tool work and semantic continuation are process output. Flower never guesses from text, timestamps or the last assistant message. Existing journals recover outcomes and timing but lack reliable final references, so their process defaults to expanded and only explicitly typed process rows may be hidden by manual choice.

A summary requires an authoritative ended ordinary turn, process content and no pending interaction for that turn. Its policy is manual by default. Automatic collapse additionally requires a completed outcome, a complete nonempty final boundary and every referenced final item present. When that boundary is unavailable, only rows with nonempty blocks consisting entirely of tool activity or thinking qualify as process. Assistant prose, mixed rows, attachments and clarification receipts stay visible, even after manual collapse; empty blocks and ID prefixes cannot establish process identity. Tool failure, timeout or rejection does not change successful-turn eligibility. Direct answers produce no empty summary. Context compaction keeps its existing independent divider. Retry, queued Send now and child threads use their own turn identities; a new successful turn cannot change an older failure. Parent completion does not hide the independent background-task entry.

Work duration is elapsed time from formal start to terminal minus the union of user-answer and approval waits. Queue time is excluded; model wait, tools and automatic retries count. Parallel tools and children are not summed. Floret computes all statistics from canonical journal facts; Flower does not start a browser timer. The summary shows at most two nonzero hour/minute/second units, with explicit subsecond copy. Expansion also shows total elapsed and waiting time.

## Reading and interface state

Running, preparing, retrying, finalizing and waiting turns remain expanded without a turn disclosure control. A Stop acknowledgement or disconnect is not a terminal outcome. Failure, interruption and cancellation retain process output, open thinking previews and details by default; users may then manually hide explicitly typed process rows. Their terminal label stays outside the collapsible content and remains visible. Closed tool details keep their existing defaults.

At successful completion, manual thinking/tool expansion, selection, focus, an active pointer/keyboard gesture, an associated menu, or process content being read away from following latest prevents automatic collapse. That choice settles once and remains expanded until manual collapse. There is no delayed second attempt.

One interface-lifetime disclosure store keys choices by runtime, thread and turn. Navigation and reconnect preserve choices; refresh/restart restores defaults. Newly displayed successful history with exact boundaries starts collapsed without an initial expanded frame; manual-only history starts expanded. Manual choices settle once and detail replacements cannot trigger a later automatic collapse. Main, embedded and child-detail timelines share the same renderer while using separate scroll controllers.

## Layout and accessibility

Every row has a stable container and key from its first appearance. Completion commits final content and changes only process visibility; it does not move, copy or remount final rows. Process bodies stay mounted to preserve detail state. Expansion uses the existing 180 ms motion and collapse 140 ms; reduced motion switches immediately. Parent transitions do not close inner disclosures.

FlowerScrollTailController is the only transcript scroll writer. Following latest stays at the tail; other reading preserves a visible content anchor. Manual disclosure fixes the summary's visual position, and user scroll can immediately take control. A native button exposes `aria-expanded` and process content IDs; collapsed rows are inert and hidden from the accessibility tree and Tab order. Manual collapse returns interior focus to the summary. Semantic colors, visible focus, forced colors and wrapping timing text cover themes, materials and narrow windows. All shipped locales provide explicit summary, duration and accessibility copy. Clarification receipts keep their existing secret-answer redaction.

# Boundaries

Disclosure choices are ephemeral presentation state, not lifecycle authority. Redeven does not add a lifecycle table, infer legacy boundaries or time turns in the browser. Final content and dialogue stay mounted and ordered; pending controls cannot be hidden by a terminal summary or a network event.

# Evidence

- `redeven:go.mod` - Published Floret v7.29.0 dependency.
- `redeven:internal/ai/flower_current_projection_test.go` - Preserves canonical historical turn facts through the public projection.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Validates and maps current turn facts.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Eligibility, final segment and duration contracts.
- `redeven:internal/flower_ui/src/flowerTurnDisclosure.test.ts` - One-time protection and interface-lifetime choices.
- `redeven:internal/flower_ui/src/FlowerTurnTimeline.tsx` - Shared stable renderer and reading protection.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Native DOM, disclosure, outcome and reading behavior.
- `redeven:internal/envapp/ui_src/src/styles/flowerMessageContrast.browser.test.tsx` - Theme/material and forced-color contrast checks.
