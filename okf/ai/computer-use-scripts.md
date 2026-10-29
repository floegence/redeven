---
type: Execution Contract
title: Computer script execution and semantic observations
tags: [ai, computer-use, scripts, accessibility]
lifecycle: contract
reviewed_at: "2026-10-29"
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

## Authority and default surface

One computer.exec is one Floret invocation/effect attempt. QuickJS exposes only ui/browser/log; ComputerUseRuntime revalidates target policy, grant, cancellation and control before every operation. One canonical turn retains the target; independent live sampling may interleave. New targets/permissions stop with confirmed prefix. Private input and approvals use the existing Floret interaction boundary; temporary approval binds current target/URL and expires with its lease.

New unrestricted turns discover computer.targets/select_target/exec after current permissions/allowlists. This grants no authority and removes no primitive executors. Explicit/saved primitive consumers retain discovery, including read-only consumers without exec. Canonical Retry queries only primitive names used by its source Turn through public canonical APIs/current permissions; missing released metadata is prepared once by Floret Host, then queried again. No unrelated expansion or second history store.

Floret tools.Definition.BatchExclusiveGroup owns selected-target computer batch exclusion. Conflicting prepared calls reject before authorization/input; inventory and unrelated tools may coexist. Target gates also fence cross-batch calls. No vocabulary-based safety, alias, input replay or target rebinding follows rejection.

## Guest lifetime and output

Required arguments: target, code, user-readable description. Limits:30seconds/50operations per call, eight active namespaces. ui.budget and results expose remaining resources. Sequential awaits, loops/conditions and same-target page navigation may compose; pixel-dependent decisions require returned screenshot and model judgment. No timers. const/let are invocation-local; explicit globalThis survives only in a healthy turn/target namespace.

SCRIPT_NO_PROGRESS means an unresolved script has no pending supported host work to advance it. STALE_REFERENCE means observed identity is invalid. Neither condition proves user interference or authorizes replay, retargeting or scope expansion. The model chooses the next observation, wait or revised call.

Any failed host operation seals the invocation even if guest code catches it. Failure retires the namespace/context_reset and dormant Promises, retaining confirmed earlier effects. Unique lookup missing/ambiguous is failure; optional count/query return zero and waitFor timeout is data. Closed diagnostics identify phase, known method/field, expected form, safe repair example and available source line/column/symbol. Raw interpreter stacks/exceptions stay private. Known unsupported option names may echo exactly; arbitrary keys/values cannot.

Budgets: canonical snapshot256KiB, response512KiB including metadata, explicit logs64KiB UTF-8. Logs stream before later operations. Runtime retains confirmed explicit output across later read/navigation failures, timeout and uncertainty, separately from current observations; failed reads discard their data/pixels and stop later operations/logs. Private pause still discards invocation content. The existing bounded prefix buffer is the only output owner; no replay or additional ledger. Snapshot/observe/locator.snapshot alone accept emit; collection results require explicit log, screenshots/help always emit. emit:false retains the same identity and canonical budget. Default ui.snapshot automatic presentation is32KiB with short opaque refs/parent links; omitted nodes/children are unknown and marked truncated. full:true/node details retain2,000-code-point name/description/value limits and flags; detail-mode changes reset diff baseline. Failed output uses the same bounded projection.

Selection/core guide and ui.help(read/visual/downloads/legacy) share authored help. Signatures require string names (no RegExp), numeric deltas and supported condition waits; validation precedes dispatch. Reference/type/syntax/argument/concurrency/output errors use closed codes, never arbitrary host text. Browser CDP diagnostics retain the correlated validated method, with a signed integer code only when supplied. Lost/malformed mutating helper exchanges report helper_exchange/response_unavailable and unknown effect; no diagnostic authorizes retry or effects.

## Input and waits

ui.type inserts at focus; fill replaces. doubleClick/scroll expose native parity. Native scroll uses window center; scrollAt(x,y,delta_y,delta_x=0) selects a region without clicking. Semantic selector scroll remains independent.

Browser drag duration_ms is integer0..5000, straight path while pressed; zero adds no delay. One monotonic schedule avoids extra per-call waits, though transport overhead can lengthen delivery. Cancel/takeover/document invalidation stop moves and release only owned input at last confirmed position. Lost reply remains unknown effect with no replay. Native input uses published FloeNativeDesktop NativeInputSequence scheduled after acknowledged down, checks authorization/target/cancellation and retains per-event receipts. No application-specific heuristic. Separate-process AppKit tests qualify native timing; browser tests cannot.

Browser waits accept state:text|value,equals:string,optional timeout_ms, matching visible-element textContent/value without resending input. Native rejects these conditions. Completed waits remain confirmed even if later JavaScript fails.

## Reads, observations and references

[Semantic snapshots](computer-use-semantics.md) own schema v2, normalized roles/tree/states/relationships/privacy. ui.getByRole(role,{name?,exact?,root_ref?}) uses canonical roles; snapshot is the direct flat schema, node/subtree reads are direct. Legacy observe/read wrappers remain. [Read validation](computer-script-read-contract.md) owns success shapes, strict arguments, branchable absence and bounded collections.

locator.text reads rendered innerText of one explicitly selected unique HTML element through a fixed isolated-world function:≤12,000Unicode characters, explicit truncation/rendered_element scope, no hidden/unloaded content or arbitrary DOM code. Document/text/SVG targets reject TARGET_CAPABILITY_UNAVAILABLE before reading; never substitute parent/body or widen scope. Scalar attributes remain string|null; >2,000code points reject rather than return a prefix. Closed method/capability/choose_supported_read diagnostics survive browser→Runtime→guest. Unknown reads stop without invalidating valid refs or replaying input; the model may choose an explicit fresh supported read.

Screenshot input handles bind immutable image/frame/document identity; changing returned metadata cannot retarget them. Download cursors always contain downloads (even empty) plus immutable cursor-bound wait. Recovery inspects an existing ID after confirmed export and never repeats the click. Screenshots accompany results automatically, not as paths/PNG buffers.

needs_observation has one script-owned value for execution and model output. Safe snapshot (including emit:false) or screenshot clears it; later input/staleness/read failure/unknown effect requires a fresh observation. observation_status means a safe current observation in this call; title alone is insufficient. Private takeover excludes observations/pixels from model history.

# Boundaries

No second history/recovery ledger. Paused/uncertain operations retain sanitized input_progress through script and assistance results. Posted/observed counts describe partial operation progress, never completed business action or replay authority. New target/permission needs explicit continuation under the existing owner.

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
