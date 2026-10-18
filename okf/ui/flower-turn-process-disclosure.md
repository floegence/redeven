---
type: UI Contract
title: Flower terminal turn process disclosure
description: Collapse successful work by default while preserving uncertain assistant output and expanded abnormal outcomes.
tags: [ui, flower, turns, disclosure, accessibility]
timestamp: 2026-10-12T00:00:00Z
---
# Summary

Published Floret v7.57.0 owns each turn's identity, outcome, final output boundary and durations. Flower consumes only validated detail accepted by ThreadCache. Successful ordinary turns default to collapsed, including legacy history whose explicitly typed process can be separated safely from assistant output. Failure, cancellation and interruption default to expanded. Users, resolved clarification answers and every final segment remain visible in their original order; unknown assistant output is never hidden. Pending interactions remain expanded without a turn disclosure control. Reading protection overrides automatic collapse once, without a later timer.

# Contract

## Canonical facts and eligibility

ThreadView and HistoryPage expose `turns`: exact TurnID and RunID, optional control kind, start and terminal time, outcome, elapsed/wait/work milliseconds, explicit ordered `final_item_ids` and `final_boundary_complete`. Redeven passes these facts through its typed current boundary. Summary updates cannot author them or trigger collapse. Invalid identities, durations or final references reject the current view before cache admission, preserving the prior valid detail.

The Floret journal retains optional response segmentation and accepted final-entry metadata. Output IDs remain stable from first publication; provider length continuation may contribute multiple final segments. Tool work and semantic continuation are process output. Flower never guesses from text, timestamps or the last assistant message. Existing journals recover outcomes and timing but lack reliable final references. Their successful turns also default to collapsed, hiding only explicitly typed process rows; every assistant prose or mixed-content row stays visible. This does not backfill or infer a final boundary.

A summary requires an authoritative ended ordinary turn, process content and no pending interaction for that turn. A completed outcome defaults to collapsed; other outcomes offer manual disclosure and default to expanded. A complete nonempty final boundary with every referenced final item present permits folding intermediate assistant prose while retaining all final segments. When that boundary is unavailable, only rows with nonempty blocks consisting entirely of tool activity or thinking qualify as process. Assistant prose, mixed rows, attachments and clarification receipts stay visible; empty blocks and ID prefixes cannot establish process identity. Tool failure, timeout or rejection does not change successful-turn eligibility. Direct answers produce no empty summary. Context compaction keeps its existing independent divider. Retry, queued Send now and child threads use their own turn identities; a new successful turn cannot change an older failure. Parent completion does not hide the independent background-task entry. Parent events use only published parent_turn_id ownership, derived from canonical receipt order. Reports and ordinary terminal notifications fold with their owning process, including receipts after its terminal time. The single process projection supplies row ownership, foldable keys, summary location and the count of foldable child updates. Unresolved input/approval, effect_outcome_unknown safety blockers and unowned events remain visible; admitted never means resolved. A loaded event with unavailable turn facts stays visible until authoritative facts arrive.

Work duration is elapsed time from formal start to terminal minus the union of user-answer and approval waits. Queue time is excluded; model wait, tools and automatic retries count. Parallel tools and children are not summed. Floret computes all statistics from canonical journal facts; Flower does not start a browser timer. The summary shows at most two nonzero hour/minute/second units, with explicit subsecond copy. Expansion reveals the original process directly, without an additional elapsed or waiting-time row.

## Reading and interface state

Running, preparing, retrying, finalizing and waiting turns remain expanded without a turn disclosure control. A Stop acknowledgement or disconnect is not a terminal outcome. Failure, interruption and cancellation retain process output, open thinking previews and details by default; users may then manually hide explicitly typed process rows. Their terminal label stays outside the collapsible content. When the latest turn already has a visible failure explanation, that explanation replaces its generic terminal label; older abnormal turns retain their labels. Closed tool details keep their existing defaults. Thinking segment completion and internal disclosure follow [Flower timeline ordering](flower-timeline-ordering.md). Neither disclosure writes the other's choice.

At successful completion, manual tool expansion, selection, focus, an active pointer/keyboard gesture, an associated menu, or process content being read away from following latest prevents automatic collapse. That choice settles once and remains expanded until manual collapse. There is no delayed second attempt. When a previously visible event resolves and becomes foldable, the same protection runs before hiding or making it inert. If inspected, the existing disclosure choice becomes expanded until manual collapse. Newly arriving ordinary events follow the current choice. Full-report internal expansion remains mounted and unchanged. Thinking expansion alone is not a reading-protection condition; genuine focus, selection and gestures remain protected.

One interface-lifetime disclosure store keys choices by runtime, thread and turn. Navigation and reconnect preserve choices; refresh/restart restores defaults. Newly displayed successful history starts collapsed without an initial expanded frame; abnormal history starts expanded. Manual choices settle once and detail replacements cannot trigger a later automatic collapse. Main, embedded and child-detail timelines share the same renderer while using separate scroll controllers.

## Layout and accessibility

Every row has a stable container and key from its first appearance. Completion commits final content and changes only process visibility; it does not move, copy or remount final rows. Process bodies stay mounted to preserve detail state. Inter-row spacing belongs inside each animated body, so hidden rows leave no repeated flex gaps before the conclusion. Expansion uses the existing 180 ms motion and collapse 140 ms; reduced motion switches immediately. Parent transitions do not close inner disclosures.

The summary is quiet inline metadata: duration text, an optional localized child-update count, then a chevron, aligned with assistant output, above a subtle separator. It has no permanent button fill, border or shadow. Hover changes text contrast without changing geometry; keyboard focus has a visible outline and the native button retains a comfortable hit target. Theme changes apply foreground colors immediately without interpolating incompatible light and dark values. The disclosure label remains on one line in both states.

FlowerScrollTailController is the only transcript scroll writer. Following latest stays at the tail; other reading preserves a visible content anchor. Manual disclosure fixes the summary's visual position, and user scroll can immediately take control. A native button exposes `aria-expanded` and process content IDs; collapsed rows are inert and hidden from the accessibility tree and Tab order. Manual collapse returns interior focus to the summary. Semantic colors, visible focus and forced colors cover themes, materials and narrow windows. All shipped locales provide explicit summary, duration and accessibility copy. Clarification receipts keep their existing secret-answer redaction.

# Boundaries

Disclosure choices are ephemeral presentation state, not lifecycle authority. Redeven does not add a lifecycle table, infer legacy boundaries or time turns in the browser. Final content and dialogue stay mounted and ordered; pending controls cannot be hidden by a terminal summary or a network event.

# Evidence

- `redeven:go.mod` - Published Floret v7.57.0 dependency.
- `redeven:internal/ai/flower_current_projection_test.go` - Preserves canonical historical turn facts through the public projection.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Validates and maps current turn facts.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Eligibility, final segment and duration contracts.
- `redeven:internal/flower_ui/src/flowerTurnDisclosure.test.ts` - One-time protection and interface-lifetime choices.
- `redeven:internal/flower_ui/src/FlowerTurnTimeline.tsx` - Shared stable renderer and reading protection.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Native DOM, disclosure, outcome and reading behavior.
- `redeven:internal/envapp/ui_src/src/styles/flowerMessageContrast.browser.test.tsx` - Theme/material and forced-color contrast checks.
