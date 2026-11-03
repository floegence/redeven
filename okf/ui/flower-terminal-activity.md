---
type: UI Contract
title: Flower terminal activity presentation
tags: [ai, flower, terminal, presentation]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Flower renders canonical Floret Activity with host task labels and safe details for every terminal operation, including writes/empty reads. Disclosure/scroll are ephemeral; no stdin/private paths/effect internals or invented lifecycle. Approval controls remain composer-owned.

# Contract

## Terminal facts
Floret owns the nested `ActivityItem.presentation` contract and merges results with their stable call presentation. Labels and descriptions are authoritative; the typed operation supplies localized fallback text.

The five-line independently scrolling output viewport retains its existing owner.

An omitted output field is pending content, never an empty canonical frame with a nonzero first sequence. Wait for small-field hydration before polling or installing its sequence; large fields use source-bound ranges, then acknowledge their watermark before adding process deltas. Existing output and selection survive handoff.

Published Floret v7.95.0 atomic activity reads own the bytes, sequence range, process identity and deferred source together. Flower never stamps a newer summary's range onto previously accepted bytes. Canonical activity status remains current independently. Check execution identity and range before publishing optional details; retain accepted output on failure. One in-flight read coalesces revisions; failure latches until explicit Retry, visibility reentry or connection change. Collapsed/offscreen rows do not read. No additional backend scan, transcript snapshot or transport contract is introduced.

Malformed process output stops its local poll and exposes a localized read-only Retry without raw diagnostics; other messages and stream observation continue. Canonical stream validation still fails at its existing connection boundary. Write acknowledgements never apply hidden output frames. Equal-watermark snapshots may fill an empty frame or extend its earlier coverage, but duplicate/older snapshots cannot replace a newer live suffix.

Inactive output caches have 200-entry / 8 MiB estimated-byte limits. Mounted outputs remain retained until release; frame metadata coalesces after 128 records without changing sequence checks. These cache limits do not truncate an active process output or its canonical history.

## Output, completion and restart
The model keeps four tools: terminal.exec/read/write/terminate. Read/write/terminate
descriptions are optional; read uses the last returned sequence. Each page is
bounded without an outer second truncation, and chunk boundaries preserve UTF-8.
The process retains at most 1 MB; gaps and invalid source encoding remain explicit.

Redeven binds the process identity to Floret before Start. Confirmed completion
seals bounded output and result facts through Floret, then supplies one bounded
notice at provider preparation or a natural idle continuation. Explicit final
reads suppress duplicate delivery. The original execution's model, tool scope,
reasoning and budgets are retained; cumulative budgets still apply per run.

Shutdown suspends new execution, reaps owned processes and persists observed
results before closing Floret. Abnormal exit preserves unknown outcomes without
replaying commands, resending stdin or adopting PIDs. Historical output reads
use authorized thread/process identity. Unknown observations stop UI polling;
readable sealed output remains paginated. Final Activity updates the original
item through Floret's canonical presentation sources.

## Interaction boundary
[Activity disclosure interaction](flower-activity-interaction.md) owns stable triggers, manual choices, animation, transcript following, and floating controls across all renderers. Approval state is never a row badge, chip, metadata line, title suffix, tooltip, detail, or ordinary activity ARIA label. Completing a decision removes that dock without inserting an approval outcome into history.

# Boundaries

Activity details are designed renderer views, never arbitrary payload inspectors.

Presentation never changes Floret status, ordering, persistence, read acknowledgement, audit state, or terminal settlement.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts` - Source.
- `redeven:internal/ai/terminal_activity_test.go` - Tests.
