---
type: Execution Contract
title: Computer script read and validation boundaries
tags: [ai, computer-use, scripts, validation]
lifecycle: contract
reviewed_at: "2026-11-03"
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
It supplies the required semantic_read failure stage and retains the live source.
One returned observation binds content, image, metadata and final safety to the
same document lifecycle through input cleanup and final publication. A private
invocation token carries the existing revision; no second lifecycle is stored.
Ordinary reads scan at entry and final publication after cleanup; failed publication retires the image anchor. Condition waits retain a privacy check after every sample, without repeatedly fetching title/URL metadata. Wait results expose requested_state, timeout_ms, elapsed_ms and samples; these measure this operation, not application readiness.
Ordinary content updates do not require page quiescence. Empty initial child-frame
URL metadata is resolved by reading document.URL in that exact isolated frame.
The same lifecycle, origin and privacy checks still apply; no parent-origin
substitution, blank-URL allowlist or website-specific rule is introduced. Missing
or invalid document URLs remain explicit evaluation failures.
Condition waits own one deadline covering observer preparation, entry safety and
independently validated read-only samples. A preparation lifecycle change remains
inside that explicit wait; it does not reset the deadline or the privacy latch.
Protocol rejection plus an independently observed revision change invalidates that
sample; protocol message wording alone never does. Ordinary reads still stop. Typed lifecycle or temporary query-candidate invalidation
discards only that sample; unknown protocol/evaluation failures, ambiguity, stale
fixed refs/root_ref, permission changes and cancellation stop. Semantic waits
revalidate the original unique match and scope after reading its state, keep the original query
and deadline, and never turn an invalid sample into an absent/hidden result.
Fixed scope identity is checked even when a descendant query has no matches.
Ordinary reads and input do not retry candidate failures.
The adapter owns this ephemeral boundary; Runtime adds no browser-state ledger.
Confirmed inputs are retained separately and never enter a read retry.
A rejected read cannot become a malformed transport response that disconnects
the target. A later explicitly requested read can recover on the same page.

## Navigation receipts
Script navigate/back/reload return a closed acknowledged load or download receipt,
with needs_observation and observation_invalidated. They do not perform an
optional post-navigation page read, export title/content/images, or assert page
safety. The next explicit read owns its privacy and document-lifetime checks.
Preflight permission, redirect barriers, target changes, cancellation, cleanup
and uncertain effects still apply through final publication. Navigation errors
and load timeouts retain their distinct outcomes. Legacy image-returning calls
keep their existing observation contract. No automatic action or read replay is
introduced; the model chooses the next observation.

## Input delivery receipts
Script pointer, key, text, fill, wheel, drag and input-sequence operations return
closed delivery facts, needs_observation and observation_invalidated. They do not
read title/content or assert application success. A failed optional post-input
safety scan adds post_action_check.state=unavailable with bounded diagnostics; it
does not revoke acknowledged input or publish unchecked content. Confirmed private
input still pauses, and permission, cancellation, connection, target-change, cleanup
and uncertain-effect barriers still stop. A subsequent explicit read owns its full
privacy checks, even within the same script. Content-returning edits and legacy
image-returning calls retain their observation contract. No input is retried.

## Controlled browser evaluation
One result checker owns Runtime.evaluate and Runtime.callFunctionOn responses.
A transport acknowledgement is not successful script execution: exceptionDetails,
missing results and invalid operation-specific values fail explicitly. Empty text,
false, zero, arrays and null remain valid when promised; void installation/reset
operations explicitly accept undefined. Optional scroll offsets may remain null
without changing confirmed input outcomes.

Only confirmed observer installation on the same document updates the existing
prepared-frame map. Failed installation leaves it unprepared; a later explicit
observation may prepare it again. No input, navigation or whole invocation is
replayed. Internal observer readiness does not imply application readiness.

Evaluation failures retain diagnostic phase evaluation, actual method and reason
exception or invalid_result through the helper, Runtime and canonical tool result.
DOMSnapshot validates the fields it consumes and accepts protocol-empty values;
optional missing scroll offsets omit geometry rather than fabricate coordinates.
Invalid structures retain phase adapter, actual method and invalid_result.
Rejected read transports retain the known protocol method even without a numeric code; typed document invalidation is not erased by safety wrapping. Unclassified adapter failures retain the known stage and internal_error.
Canonical results, Activity and correlated runtime logs retain these bounded facts.
These are distinct from protocol rejection codes and authorize no retry. Raw exception text, stacks and
page values do not enter diagnostics. Confirmed output survives later read failure;
privacy takeover still discards content. Core help directs models to observed roles
and refs instead of assigning roles from a control's business purpose.

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
items. Virtualized, unloaded rows are never counted as visited. getAttribute(href)
preserves source query/fragment and relative form; URL credentials are explicitly
redacted. linkSummary is the optional normalized view that removes query/fragment
and is not an action URL. Long attributes remain available through source reads.
Browser rows reads a unique table/grid and returns header/data rows, cell roles
and source-backed cell refs for explicit detailed reads,
with explicit loaded-tree scope. Pages contain at most 200 rows/48 KiB of item
content; each row is limited to 200 cells/44 KiB, each cell to 2,000 Unicode
characters. cells_truncated/text_truncated mark loss; exact totals cannot be
inferred from incomplete rows. Cursor identity includes full cell contents.
Nested tables are excluded. count reports loaded matches. attribute returns a
scalar safe attribute; linkSummary labels its redacted URL as non-actionable.
Native targets reject these browser reads inside scripts before adapter dispatch.

scroll_progress belongs to the scroll return value. scope and measured_ref identify
the exact requested element or viewport, never a guessed wheel receiver. before,
after and offset_changed describe only immediate offsets of that measurement;
scroll_effect remains unknown. Invalidated or unavailable samples are null. Input
dispatch and scroll-into-view preparation are separate facts.
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
receive a bounded advisory after two repeats. It states only that this bounded
sample is unchanged, not that unobserved content is unchanged or business data is
ready. Truncated snapshots retain read_options, requested root/limit and explicit
continuation guidance; the model chooses a read. This never replays input, changes
target, adds a planner, or persists a second lifecycle.

Single-node detail does not enumerate a subtree. child_refs describes only
returned relationships; check children_truncated, use snapshot for a subtree
and browser rows/query/count for loaded collections.


## Explicit source details
[Source detail and continuation reads](computer-source-reads.md) defines original
AX/DOM fields, long-value chunks, child paging, bound cursors and ref retention.
These reads share this contract's privacy and final-publication boundaries.

# Boundaries

Collection results describe only the authorized loaded tree; they do not certify
unloaded content. Native targets reject browser-only reads before dispatch.
Validation and observation recovery never replay completed input.

# Evidence

The browser read-contract and script Node suites, Runtime script tests and
[real-provider acceptance](computer-use-qualification.md) exercise these boundaries.
