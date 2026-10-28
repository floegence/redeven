---
type: Execution Contract
title: Computer script execution and semantic observations
description: Execute bounded JavaScript against one authorized target without exposing host capabilities or replaying partial effects.
tags: [ai, computer-use, scripts, accessibility]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

One `computer.exec` is one Floret tool invocation and one effect attempt.
`ComputerUseRuntime` owns its isolated QuickJS process and checks every host
operation. The guest receives only the controlled `ui`, `browser` and `log`
interfaces. Partial progress survives failure; uncertain effects never replay.
Loops, conditions and navigation within the same selected page may compose in one call.
A new target or permission boundary stops the batch with its confirmed prefix.
A permission requirement or private input ends it through Floret's existing
interaction boundary.

# Contract

Rendered text reads require an explicitly selected HTML element. Document, text
and SVG nodes return TARGET_CAPABILITY_UNAVAILABLE before reading; no parent/body
substitution or scope expansion occurs. Unknown observation failures stop the
operation; explicit fresh reads remain possible without input replay.

Floret owns batch exclusion through tools.Definition.BatchExclusiveGroup. Redeven
declares one computer-control group for selected-target calls. Conflicting
prepared calls are rejected before authorization; independent tools and inventory
can run alongside one computer call. Target gates still protect cross-batch use.

## Guest API and limits
`computer.exec` requires a target, code and a user-readable description.

Each call allows 30 seconds and 50 operations. ui.budget() and returned budget
metadata expose remaining time and operations. Explicit logs stream before later
operations under a 64 KiB UTF-8 budget, retaining safe findings on timeout or
uncertain effects. Private pauses, failed safety reads and navigation failures
discard content. Batch known steps across pages within the runtime budget; return
screenshots for model judgment when the next action depends on pixels. Argument
diagnostics identify the method when known, field, expected form and fixed repair
examples; raw errors remain private.
Known unsupported option names are returned exactly; arbitrary keys and values
are never echoed. locator.snapshot still accepts only limit and emit.

Native ui.scroll uses the window center; ui.scrollAt(x,y,delta_y,delta_x=0)
targets a region without clicking first. Selector scroll remains semantic.
Browser locator.text() reads rendered innerText from one unique observed element
through a fixed isolated-world function, bounded to 12,000 Unicode characters
with explicit truncation and rendered_element scope. Hidden and unloaded content
is excluded. No arbitrary DOM execution is exposed.

Approval Required uses the current target and URL in the existing tool approval; temporary authorization expires with the target lease and never becomes a persistent origin grant.

The Runtime admits at most eight active script namespaces. The short tool definition teaches the entry point; selection returns the core guide and ui.help(topic) discloses read, visual, downloads or legacy signatures. Both selection and runtime help share one authored source. Exact signatures include: string names (no RegExp selectors), numeric scroll deltas, condition waits, and sequential awaited operations. Unsupported guest arguments fail before dispatch. Closed diagnostic codes distinguish reference/type/syntax/argument errors, operation concurrency and bounded output; raw interpreter exceptions remain private. A failed invocation retires its namespace while confirmed earlier actions survive.

Semantic snapshots retain their 256 KiB output budget. The script response allows a bounded 512 KiB envelope so metadata cannot make a valid snapshot fail at the transport boundary. Logs have a separate 64 KiB total budget. Local `emit:false` reads receive the same URL/title identity as emitted observations.

`context_reset` explicitly reports namespace retirement after failure. Safe diagnostics include phase and submitted-source line/column/symbol when available; raw exception text and stacks stay private. Failed namespaces cannot retain dormant Promise callbacks. A caught argument error seals further operations. `const`/`let` are invocation-local; explicit `globalThis` values last only within a healthy turn/target namespace. Timers are unavailable.

Default `ui.snapshot` automatic output uses a compact 32 KiB presentation budget, short opaque browser references and parent links. Truncation marks omitted nodes and children; omitted content is unknown. Guest reads retain the canonical 256 KiB budget. `full:true` and `locator.node()` provide details with the same 2,000-code-point field budgets and explicit name/description/value truncation flags. Changing detail mode resets the diff baseline; failures use the same bounded output projection.

Browser waits additionally accept `{state:'text'|'value',equals:string,timeout_ms?}` for exact visible-element textContent/value matching. They only sample state and never resend input. Native targets reject these conditions. Download cursors always include a `downloads` array, including when empty.

## Small default surface
New unrestricted turns discover only computer.targets, computer.select_target and
computer.exec. Filtering occurs after current permission and explicit allowlist
selection, never grants authority, and does not remove primitive executors.
Explicit primitive consumers and saved provider surfaces retain legacy discovery.
Canonical Retry queries only primitive names actually used in its source Turn,
through authorized public canonical queries, then applies current permissions.
Missing released query metadata is prepared once through Floret Host before the
query is retried. It does not expand unrelated retries or create a second history store. Without exec permission,
primitive read-only consumers keep their existing tools.

Only one selected-target computer call may occupy a prepared batch. Independent
tools may share that batch; Floret owns conflict admission. Rejection never replays
input or changes target binding.

Scalar attribute reads preserve string|null: an attribute over 2,000 Unicode
code points returns TARGET_CAPABILITY_UNAVAILABLE, never a silent prefix. Closed
read diagnostics retain method, expected capability and choose_supported_read
through the browser, Runtime and script result. They do not infer a replacement
element, widen scope or repeat input. The model chooses another explicit read.

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

## Observation and references
The [semantic snapshot contract](computer-use-semantics.md) owns schema v2, role normalization, tree validation, states, relationships and privacy projection. `ui.getByRole(role, {name?, exact?, root_ref?})` uses a canonical role.

ui.snapshot returns the canonical flat snapshot directly, with one role per node;
locator.node and locator.snapshot provide direct node/subtree reads. Legacy
observe/read wrappers remain unchanged. ui.type inserts at current focus; fill
replaces contents. ui.doubleClick and ui.scroll provide native input parity.
browser.downloadCursor returns its existing fields plus an immutable wait method
bound to that cursor. Download recovery inspects existing IDs after a confirmed
click; it never repeats the export. Browser screenshots return immutable image-bound input methods with captured
frame/document identity; mutating returned metadata cannot retarget the handle.

Private takeover keeps observations and pixels out of model history.

needs_observation has one script-owned value for both execution facts and the
model result. A safe snapshot (including emit:false) or screenshot clears it;
later input, stale refs, observation failure or unknown effects require a fresh
read. observation_status describes a safe current observation in this call,
not the presence of a title. A title alone never establishes freshness.

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
The core help demonstrates awaited node reads and logging the returned scroll
result; node and snapshot objects do not carry scroll measurements.

Repeated identical observations in the same script namespace/document/scope
receive a bounded advisory after two repeats. This never replays input, changes
target, adds a planner, or persists a second lifecycle.

Single-node detail does not enumerate a subtree. child_refs describes only
returned relationships; check children_truncated, use snapshot for a subtree
and browser rows/query/count for loaded collections.

# Boundaries

## Partial effects and continuation
The Runtime revalidates target policy, grants, cancellation and current control before each host operation. The target remains owned by the same canonical turn across the batch; independent live sampling may run between operations.

No second history or recovery ledger exists.

# Evidence

- `redeven:internal/ai/computer_script.go` - namespace ownership, limits and partial results.

- `redeven:internal/ai/computer_observation.go` - bounded output diffs and document/scope resets.

- `redeven:internal/envapp/ui_src/scripts/redevenComputerScript.mjs` - restricted QuickJS API and process protocol.

## Qualified browser batch example

For an already inspected report whose three URLs and unique Score region are
known, one call can combine navigation, bounded reads, a condition, computation
and a final screenshot. Visual interpretation occurs after the call returns.

<!-- qualified-browser-batch -->
```javascript
globalThis.batchScores = [];
for (let page = 1; page <= 3; page++) {
  await browser.navigate('https://example.test/report?page=' + page);
  const value = await ui.getByRole('region', {name: 'Score', exact: true}).text();
  ui.assert(!value.truncated && Number.isFinite(Number(value.text)));
  batchScores.push(Number(value.text));
}
globalThis.batchTotal = batchScores.reduce((sum, value) => sum + value, 0);
log({scores: batchScores, total: batchTotal});
await ui.screenshot();
```

`TestComputerScriptExamplesQualification` runs this exact example and the
production download-help example through QuickJS, Runtime and real installed
Chromium. It verifies a 1.4 MB download byte-for-byte, one export and one identity,
three page scores, retained environment state, and an actual screenshot.
Screenshots automatically accompany the tool result. Their metadata is not a
file path or PNG buffer; no extra export is required to display a capture.
