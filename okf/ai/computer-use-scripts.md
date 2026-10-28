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
Observation diagnostics retain a validated CDP method and signed integer protocol
code when the connected-browser source supplies them. They reuse the existing
diagnostic field and invocation trace; raw exceptions never become model content.
Missing codes remain unknown, and no diagnostic authorizes retry or input replay.

Only snapshot/observe and locator.snapshot accept emit. Collection reads return
data for explicit logging; screenshots and help always emit.

Known unsupported option names are returned exactly; arbitrary keys and values
are never echoed. locator.snapshot still accepts only limit and emit.

Native ui.scroll uses the window center; ui.scrollAt(x,y,delta_y,delta_x=0)
targets a region without clicking first. Selector scroll remains semantic.
Browser drag accepts integer duration_ms from 0 through 5000. The shared managed
and connected-browser implementation holds the button while following a straight
path over the requested duration; zero adds no delay. A monotonic schedule avoids
accumulating one extra delay per transport call. Dispatch overhead can extend the
duration. Cancellation, takeover and document invalidation stop remaining moves;
cleanup releases at the last confirmed pointer position. A lost input reply keeps
its unknown-effect classification and is never replayed. Native delivery uses the published FloeNativeDesktop NativeInputSequence, with
one monotonic schedule after acknowledged mouse-down. It accepts the same
integer 0..5000 ms contract. The host checks authorization/target/cancellation,
retains exact per-event receipts, and releases only its outstanding input on
interruption. No application-specific timing heuristic or automatic retry is
added. Native qualification measures separate-process AppKit events; browser
tests do not certify native timing.
Browser locator.text() reads rendered innerText from one unique observed element
through a fixed isolated-world function, bounded to 12,000 Unicode characters
with explicit truncation and rendered_element scope. Hidden and unloaded content
is excluded. No arbitrary DOM execution is exposed.

Approval Required uses the current target and URL in the existing tool approval; temporary authorization expires with the target lease and never becomes a persistent origin grant.

The Runtime admits at most eight active script namespaces. The short tool definition teaches the entry point; selection returns the core guide and ui.help(topic) discloses read, visual, downloads or legacy signatures. Both selection and runtime help share one authored source. Exact signatures include: string names (no RegExp selectors), numeric scroll deltas, condition waits, and sequential awaited operations. Unsupported guest arguments fail before dispatch. Closed diagnostic codes distinguish reference/type/syntax/argument errors, operation concurrency and bounded output; raw interpreter exceptions remain private. A failed invocation retires its namespace while confirmed earlier actions survive.

Semantic snapshots retain their 256 KiB output budget. The script response allows a bounded 512 KiB envelope so metadata cannot make a valid snapshot fail at the transport boundary. Logs have a separate 64 KiB total budget. Local `emit:false` reads receive the same URL/title identity as emitted observations.

`context_reset` explicitly reports namespace retirement after failure. Safe diagnostics include phase and submitted-source line/column/symbol when available; raw exception text and stacks stay private. Failed namespaces cannot retain dormant Promise callbacks. Any failed host operation seals further operations, even when caught by guest JavaScript. Unique node/action lookups fail on missing or ambiguous matches; optional browser checks use count/query (zero is data) or waitFor (timeout is data). `const`/`let` are invocation-local; explicit `globalThis` values last only within a healthy turn/target namespace. Timers are unavailable.

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

## Read and validation contracts

See [script reads and validation](computer-script-read-contract.md) for success
shapes, strict argument boundaries, branchable absence/timeout and bounded
collections. Failed operations seal the invocation; they never replay input.

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

# Boundaries

## Partial effects and continuation
The Runtime revalidates target policy, grants, cancellation and current control before each host operation. The target remains owned by the same canonical turn across the batch; independent live sampling may run between operations.

No second history or recovery ledger exists.
Paused and uncertain operations retain their sanitized input_progress receipt
through both script and assistance results. Posted/observed event counts describe
the interrupted operation, not a completed action or evidence to replay it.

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
