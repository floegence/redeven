---
type: Execution Contract
title: Computer script read and validation boundaries
description: Distinguish valid empty data, truncation, strict lookup failures and pre-dispatch rejection.
tags: [ai, computer-use, scripts, validation]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Browser and native script reads return promised shapes or explicit errors.
Missing observations never become empty data, and invalid input never dispatches.
[Script execution](computer-use-scripts.md) owns the namespace and failure barrier.
Completed input stays recorded even when a later read fails.

# Contract

## Successful reads and argument counts
All guest methods, including image and download-cursor methods, validate explicit
minimum/maximum argument counts before dispatch. Existing type and option
validation remains authoritative; extra arguments return SCRIPT_ARGUMENT_ERROR
with a closed method and documented_arity diagnostic. Valid signatures do not change.

Runtime requires the promised result for semantic observations, node/text/collection/
attribute reads and condition waits. Missing or invalidated reads fail through the
existing observation-error boundary, seal the invocation and retain completed
input without replay. Empty arrays, empty text, zero counts and null attributes
remain valid data. Snapshot projection never fills absent observations with an
empty tree. A confirmed action may invalidate an old observation and still be
followed by an explicit fresh read. A documented wait timeout remains a result;
requireState turns it into CONDITION_TIMEOUT. Takeovers and target changes keep
their existing control boundaries.

The browser controller routes node/text/query/table/attribute/condition reads
through one observation boundary, including direct lower-level read exceptions.
It supplies the required semantic_read failure stage, retains the live source,
and uses the existing bounded read retry only; inputs never enter that retry.
A rejected read cannot become a malformed transport response that disconnects
the target. A later explicitly requested read can recover on the same page.

## Validated inputs and bounded browser reads
The browser adapter validates the complete operation before virtual focus,
scroll preparation or input. Invalid arguments retain a closed diagnostic with
phase, field, expected form and recovery; page errors and supplied secrets are
never copied into it. Keys use characters or documented names with
Alt/Control/Meta/Shift modifiers; physical codes such as Equal are not names.
Primitive computer.wait defaults to zero milliseconds and adds no settling
promise. Legacy waitFor retains its returned state. requireState throws CONDITION_TIMEOUT and seals later host operations, even if guest code catches the error. Earlier completed input remains recorded.
Its closed diagnostic retains method, requested state, timeout_ms and zero-based
operation_index, mirrored in failed_action/failed_operation_index. Matching text
and raw exceptions stay private. completed_actions records completed operations;
a completed wait operation does not imply its requested condition was met.

Browser locators expose query({limit,cursor}) over the authorized loaded AX
scope and an attribute allowlist. Results carry total, truncation, document and
cursor; changed contents invalidate pagination. Only returned page references
enter the bounded reference table. Each page is at most 200 items and 48 KiB of
items. Virtualized, unloaded rows are never counted as visited. href removes
credentials, query and fragment and must not be reconstructed as an action URL.
Browser rows reads a unique table/grid and returns header/data rows and cell roles,
with explicit loaded-tree scope. Pages contain at most 200 rows/48 KiB of item
content; each row is limited to 200 cells/44 KiB, each cell to 2,000 Unicode
characters. cells_truncated/text_truncated mark loss; exact totals cannot be
inferred from incomplete rows. Cursor identity includes full cell contents.
Nested tables are excluded. count reports loaded matches. attribute returns a
scalar safe attribute; linkSummary labels its redacted URL as non-actionable.
Native targets reject these browser reads inside scripts before adapter dispatch.

scroll_progress belongs to the scroll return value. It reports immediate
before/after measurements, with null or unchanged values remaining inconclusive.
Semantic wheel input uses the visible intersection of the target, not clickable-control
enabled state or its offscreen full-box center. Browser-native intersection geometry
owns ancestor clipping and transforms; document targets use their viewport. Existing
hit testing checks target ancestry and embedding-frame overlays before one wheel.
Scroll-into-view preparation remains separately reported when the wheel is rejected;
it can move the viewport. No alternative-point search or automatic input replay is
added. Immediate offsets do not select the next action for the model.

The core help demonstrates awaited node reads and logging the returned scroll
result; node and snapshot objects do not carry scroll measurements.

Repeated identical observations in the same script namespace/document/scope
receive a bounded advisory after two repeats. This never replays input, changes
target, adds a planner, or persists a second lifecycle.

Single-node detail does not enumerate a subtree. child_refs describes only
returned relationships; check children_truncated, use snapshot for a subtree
and browser rows/query/count for loaded collections.

# Boundaries

Collection results describe only the authorized loaded tree; they do not certify
unloaded content. Native targets reject browser-only reads before dispatch.
Validation and observation recovery never replay completed input.

# Evidence

The browser read-contract and script Node suites, Runtime script tests and
[real-provider acceptance](computer-use-qualification.md) exercise these boundaries.
