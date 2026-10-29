---
type: UI Contract
title: Flower subagent detail window
tags: [ai, flower, subagents, ui]
lifecycle: contract
reviewed_at: "2026-10-29"
---
# Summary

The child detail window reads the complete canonical Floret `ThreadView`. HTTP and live updates share the selected parent-child identity, while Activity and queued-input controls remain attached to the same canonical child. The window preserves navigation and scroll state across updates without creating a second transcript or lifecycle owner.

# Contract

The detail GET returns exactly `{ summary, current }` and accepts no paging query. Child currents use the same bounded unsent-text coalescing and transient browser-frame rules as roots, described by [live current transport](flower-live-timeline.md).

The window stacks three in-flow regions: a facts band, the transcript region, and an optional run-progress footer. The footer is a sibling of the transcript region, never an overlay, so a live run indicator can neither cover message text nor change the transcript's measured top and height. The footer centers one fixed-width pill under the window's inline center; [received output progress](flower-output-progress.md) owns the pill's stability rules.

Floret remains the lifecycle owner described in [Subagent runtime](../ai/subagent-runtime.md).

# Boundaries

The detail window must not infer membership from activity, poll for updates, switch the selected parent conversation, persist a second transcript, or replay uncertain effects. [Subagent detail presentation](flower-subagent-detail.md) owns parent membership, task labels, dropdown and operation capsules.

# Evidence

- `redeven:internal/ai/flower_current_projection.go` - Shares the safe current projection between HTTP and SSE.

- `redeven:internal/flower_ui/src/threadCache.ts` - Owns bounded retained detail and root-inventory cleanup; cache tests cover capacity, reconnect, attention and release.

- `redeven:internal/envapp/ui_src/src/ui/flower/SubagentDetailWindow.progressDock.browser.test.tsx` - Asserts the footer rail sits below the transcript region, stays centered, and keeps its pill width and label inset while reported tokens grow from `11` to `1234567`.
