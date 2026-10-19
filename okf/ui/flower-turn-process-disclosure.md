---
type: UI Contract
title: Flower terminal turn process disclosure
description: Collapse historical and successful work while protecting current abnormal work, explicit choices and active reading.
tags: [ui, flower, turns, disclosure, accessibility]
timestamp: 2026-10-18T00:00:00Z
---
# Summary

Published Floret v7.61.0 owns each turn's identity, outcome, final output boundary and durations. Flower consumes only validated detail accepted by ThreadCache. Successful ordinary turns default to collapsed, including legacy history whose explicitly typed process can be separated safely from assistant output. Failure, cancellation and interruption default to expanded only for the latest ordinary turn; older abnormal work defaults to collapsed once a newer ordinary turn starts. Users, resolved clarification answers and every final segment remain visible in their original order; unknown assistant output is never hidden. Pending interactions remain expanded without a turn disclosure control. Reading protection overrides automatic collapse once, without a later timer.

# Contract

## Canonical facts and eligibility

ThreadView and HistoryPage expose `turns`: exact TurnID and RunID, optional control kind, start and terminal time, outcome, elapsed/wait/work milliseconds, explicit ordered `intermediate_item_ids`, `final_item_ids` and `final_boundary_complete`. Redeven passes these facts through its typed current boundary. Summary updates cannot author them or trigger collapse. Invalid identities, durations or final references reject the current view before cache admission, preserving the prior valid detail.

Floret retains response segmentation and accepted final references. Output IDs stay stable; length continuation may produce several final segments. Tool work and semantic continuation are process output. Flower never infers boundaries from text, timestamps or the last assistant message. Legacy history without segmentation hides only typed process rows, preserving unknown prose and mixed-content rows.

A summary requires an authoritative ended ordinary turn, process content and no pending interaction for that turn. A completed outcome defaults to collapsed, including saved computer screenshots. Only the latest ordinary turn defaults to expanded on failure, cancellation or interruption. Canonical turn order selects the latest ordinary turn; timestamps, context compaction and queued requests do not supersede it. Only published intermediate_item_ids classify superseded prose, independently of final-boundary availability or terminal outcome. All accepted final segments and unsuperseded trailing partial answers stay visible. Unknown prose, attachments and clarification receipts stay visible; rows with nonempty blocks consisting entirely of tool activity or thinking also qualify as process. Typed Goal changes with exact turn/run ownership fold with that process, including model updates and completion; unowned or mismatched Goal changes stay visible. The independent Goal summary, editor and recovery controls remain outside disclosure. Empty blocks and ID prefixes cannot establish process identity. Tool failure, timeout or rejection does not change successful-turn eligibility. Direct answers produce no empty summary. Context compaction keeps its existing independent divider. Retry, queued Send now and child threads use their own turn identities. A newer admitted ordinary turn makes older abnormal work historical without changing its canonical outcome or terminal label. Parent completion does not hide the independent background-task entry. Parent events use only published parent_turn_id ownership, derived from canonical receipt order. Reports and ordinary terminal notifications fold with their owning process, including receipts after its terminal time. The single process projection supplies row ownership, foldable keys, summary location and the count of foldable child updates. Unresolved input/approval, effect_outcome_unknown safety blockers and unowned events remain visible; admitted never means resolved. A loaded event with unavailable turn facts stays visible until authoritative facts arrive.

Floret computes work duration from formal start to terminal minus the union of input and approval waits. Queue time is excluded; model wait, tools and automatic retries count. Parallel work is not summed. Flower has no duration timer. The summary shows at most two nonzero time units, with subsecond copy; expansion reveals the original process without extra timing rows.

## Reading and interface state

Running, preparing, retrying, finalizing and waiting turns remain expanded without a turn disclosure control. A Stop acknowledgement or disconnect is not a terminal outcome. The latest ordinary turn retains process output, open thinking previews and details by default on failure, interruption or cancellation; users may then manually hide confirmed intermediate prose and explicitly typed process rows. Their terminal label stays outside the collapsible content. When the latest turn already has a visible failure explanation, that explanation replaces its generic terminal label; older abnormal turns retain their labels. Closed tool details keep their existing defaults. Thinking segment completion and internal disclosure follow [Flower timeline ordering](flower-timeline-ordering.md). Neither disclosure writes the other's choice.

At successful completion or when a new ordinary turn supersedes default-expanded abnormal work, manual tool expansion, selection, focus, an active pointer/keyboard gesture, an associated menu, or process content being read away from following latest prevents automatic collapse. That choice settles once and remains expanded until manual collapse. There is no delayed second attempt. When a previously visible event resolves or prose gains canonical intermediate classification, the same protection runs before hiding or making it inert. If inspected, the existing disclosure choice becomes expanded until manual collapse. Newly arriving ordinary events follow the current choice. Full-report internal expansion remains mounted and unchanged. Automatic screenshot previews and thinking expansion alone are not reading-protection conditions; deliberate tool expansion, genuine focus, selection and gestures remain protected.

One interface-lifetime disclosure store keys choices by runtime, thread and turn. Navigation and reconnect preserve choices; refresh/restart restores defaults. Newly displayed successful and historical abnormal work starts collapsed without an initial expanded frame. Only the latest abnormal ordinary turn starts expanded. The same store tracks the observed default policy and whether a choice was explicitly made or retained for reading. A changed default may collapse untouched abnormal work once; manual choices and protected expansion persist until the user changes them. Detail replacements, navigation and reconnect never retry an already settled default. Main, embedded and child-detail timelines share the same renderer while using separate scroll controllers.

## Layout and accessibility

Messages and events share canonical Path ordering; timestamps never insert receipts. The summary occupies the first process row after the owning user and prior-turn boundary. Every row has a stable container and key from its first appearance. Completion commits final content and changes only process visibility; it does not move, copy or remount final rows. Process bodies stay mounted to preserve detail state. Inter-row spacing belongs inside each animated body, so hidden rows leave no repeated flex gaps before the conclusion. Expansion uses the existing 180 ms motion and collapse 140 ms; reduced motion switches immediately. Parent transitions do not close inner disclosures.

The summary aligns duration, an optional localized child-update count and a chevron with assistant output above a subtle separator. It has no permanent fill, border or shadow. Hover preserves geometry; keyboard focus has a visible outline and comfortable hit target. Theme colors update immediately. The label stays on one line.

FlowerScrollTailController is the only transcript scroll writer. Following latest stays at the tail; other reading preserves a visible content anchor. Manual disclosure fixes the summary's visual position, and user scroll can immediately take control. A native button exposes `aria-expanded` and process content IDs; collapsed rows are inert and hidden from the accessibility tree and Tab order. Manual collapse returns interior focus to the summary. Semantic colors, visible focus and forced colors cover themes, materials and narrow windows. All shipped locales provide explicit summary, duration and accessibility copy. Clarification receipts keep their existing secret-answer redaction.

# Boundaries

Disclosure is ephemeral UI state. Redeven adds no lifecycle table or inferred boundaries. Final content and dialogue stay mounted and ordered; summaries and network events cannot hide pending controls.

# Evidence

- `redeven:go.mod` - Published Floret v7.61.0 dependency.
- `redeven:internal/ai/flower_current_projection_test.go` - Preserves canonical historical turn facts through the public projection.
- `redeven:internal/flower_ui/src/runtimeCurrentView.ts` - Validates and maps current turn facts.
- `redeven:internal/flower_ui/src/flowerTurnPresentation.test.ts` - Eligibility, final segment and duration contracts.
- `redeven:internal/flower_ui/src/flowerTurnDisclosure.test.ts` - One-time protection and interface-lifetime choices.
- `redeven:internal/flower_ui/src/FlowerTurnTimeline.tsx` - Shared stable renderer and reading protection.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.turnProcess.browser.test.tsx` - Native DOM, disclosure, outcome and reading behavior.
- `redeven:internal/envapp/ui_src/src/styles/flowerMessageContrast.browser.test.tsx` - Theme/material and forced-color contrast checks.

## Canonical order qualification, 2026-10-18

Published Floret v7.61.0 passed the complete Go suite, v7 API comparison,
candidate and published-module adoption checks. Redeven passed its AI and
Session Go packages, dependency boundary, TypeScript and lint checks, 221
focused shared tests, all 60 process browser tests, and the isolated real
Service/Fork/restart qualification. The broader Flower run passed 1,974 node
tests and 740 browser tests before a newly added selection fixture was
corrected to blur the composer before selecting transcript text; the complete
60-test process browser file then passed.

Eight other browser failures reproduce on unchanged local baseline
002dcbd63772033e4a4d6e55be0250b361bac435: two Activity dialog-boundary assertions,
three approval-surface assertions, and three child avatar geometry assertions.
They are not passing evidence for this change. OKF source integrity passes;
strict content quality reproduces the same five existing errors on that
baseline (missing Contract/Boundaries in flower-goals, and missing top-level
Boundaries plus an oversized body in flower-context-distribution-qualification).
No Redeven push or pre-push integration gate is part of this qualification.
