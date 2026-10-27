---
type: Execution Contract
title: Computer script execution and semantic observations
description: Execute bounded JavaScript against one authorized target without exposing host capabilities or replaying partial effects.
tags: [ai, computer-use, scripts, accessibility]
timestamp: 2026-10-13T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

One `computer.exec` is one Floret tool invocation and one effect attempt.
`ComputerUseRuntime` owns its isolated QuickJS process and checks every host
operation. The guest receives only the controlled `ui`, `browser` and `log`
interfaces. Partial progress survives failure; uncertain effects never replay.
A page change ends the batch with successful partial progress for the Agent.
A permission requirement or private input ends it through Floret's existing
interaction boundary.

# Contract

## Guest API and limits
`computer.exec` requires a target, code and a user-readable description.

Each call allows 30 seconds and 50 operations. ui.budget() and returned budget
metadata expose remaining time and operations. Explicit logs stream before later
operations under a 64 KiB UTF-8 budget, retaining safe findings on timeout or
uncertain effects. Private pauses, failed safety reads and navigation failures
discard content. Keep batches to one page or verified subtask. Argument
diagnostics identify the method when known, field, expected form and fixed repair
examples; raw errors remain private.

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

Default `ui.snapshot` automatic output uses a compact 32 KiB presentation budget, short opaque browser references and parent links. Truncation marks omitted nodes and children; omitted content is unknown. Guest reads retain the canonical 256 KiB budget. `full:true` and `locator.node()` provide details. Changing detail mode resets the diff baseline; failures use the same bounded output projection.

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

Computer calls other than inventory must be sent alone. The Floret authorization
request carries batch metadata into the host handler; a multiple-call batch returns
paired INVALID_REQUEST feedback before any target operation. It does not stop the
turn, replay input, change target binding or disable unrelated tool concurrency.

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

## Validated inputs and bounded browser reads
The browser adapter validates the complete operation before virtual focus,
scroll preparation or input. Invalid arguments retain a closed diagnostic with
phase, field, expected form and recovery; page errors and supplied secrets are
never copied into it. Keys use characters or documented names with
Alt/Control/Meta/Shift modifiers; physical codes such as Equal are not names.
Primitive computer.wait defaults to zero milliseconds and adds no settling
promise. Legacy waitFor retains its returned state. requireState throws CONDITION_TIMEOUT and seals later host operations, even if guest code catches the error. Earlier completed input remains recorded.

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

# Boundaries

## Partial effects and continuation
The Runtime revalidates target policy, grants, cancellation and current control before each host operation. The target remains owned by the same canonical turn across the batch; independent live sampling may run between operations.

No second history or recovery ledger exists.

# Evidence

- `redeven:internal/ai/computer_script.go` - namespace ownership, limits and partial results.

- `redeven:internal/ai/computer_observation.go` - bounded output diffs and document/scope resets.

- `redeven:internal/envapp/ui_src/scripts/redevenComputerScript.mjs` - restricted QuickJS API and process protocol.
