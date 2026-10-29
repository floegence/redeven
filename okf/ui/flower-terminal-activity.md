---
type: UI Contract
title: Flower terminal activity presentation
tags: [ai, flower, terminal, presentation]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Flower renders canonical Floret v7 Activity facts. Host-authored labels and descriptions explain the task; every terminal operation has safe expandable details, including writes and empty reads. Disclosure and output scrolling are local presentation state. They never create process lifecycle facts or expose stdin, private working paths, or effect internals. Actionable approval controls belong to the composer.

# Contract

## Terminal facts
Floret owns the nested `ActivityItem.presentation` contract and merges results with their stable call presentation. Labels and descriptions are authoritative; the typed operation supplies localized fallback text.

The five-line independently scrolling output viewport retains its existing owner.

An omitted output field is pending content, never an empty canonical frame with a nonzero first sequence. Wait for small-field hydration before polling or installing its sequence; large fields use source-bound ranges, then acknowledge their watermark before adding process deltas. Existing output and selection survive handoff.

Inactive output caches have 200-entry / 8 MiB estimated-byte limits. Mounted outputs remain retained until release; frame metadata coalesces after 128 records without changing sequence checks. These cache limits do not truncate an active process output or its canonical history.

## Interaction boundary
[Activity disclosure interaction](flower-activity-interaction.md) owns stable triggers, manual choices, animation, transcript following, and floating controls across all renderers. Approval state is never a row badge, chip, metadata line, title suffix, tooltip, detail, or ordinary activity ARIA label. Completing a decision removes that dock without inserting an approval outcome into history.

# Boundaries

Activity details are designed renderer views, never arbitrary payload inspectors.

Presentation never changes Floret status, ordering, persistence, read acknowledgement, audit state, or terminal settlement.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - The Env adapter maps authorized terminal output reads to the product API without owning process lifecycle.

- `redeven:internal/ai/terminal_activity_test.go` - Verifies typed terminal outcomes survive the public activity sanitizer.
