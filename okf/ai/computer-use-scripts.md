---
type: Execution Contract
title: Computer script execution and semantic observations
tags: [ai, computer-use, scripts, accessibility]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

One computer.exec is one Floret effect attempt. ComputerUseRuntime checks each controlled ui/browser/log operation in QuickJS. Same-target loops and navigation may compose; new target, permission or private input stops at the existing interaction boundary. Preserve confirmed progress without uncertain replay.

# Contract

## Authority
computer.exec is one Floret invocation/effect attempt. QuickJS exposes ui/browser/log only; Runtime rechecks target policy, grant, cancellation and control per operation. One canonical turn retains target; live sampling may interleave. New target/permission stops with confirmed prefix. Private input/approval uses existing interaction, temporary approval bound to current target/URL/lease.

Unrestricted turns discover targets/select_target/exec under current permissions. Explicit/saved primitive consumers retain discovery, including read-only callers. Retry asks public canonical APIs for only source-Turn primitive names/current grants; Floret prepares missing metadata once before requery. No unrelated expansion/history store. BatchExclusiveGroup rejects conflicting prepared target calls before authorization/input; inventory/unrelated tools may coexist. Cross-batch gates apply. Rejection grants no replay, alias or rebinding.

## Guest and output
Require target, code, readable description. Bound each call to 30 s/50 operations and eight active namespaces; ui.budget/results expose remaining budget. Sequential awaits/loops/same-page navigation may compose; image judgments require returned screenshot/model review. No timers. const/let are call-local; globalThis survives healthy turn/target namespaces only.

SCRIPT_NO_PROGRESS means unresolved script without pending supported work; STALE_REFERENCE means invalid observed identity. Neither implies interference or permits replay/retargeting. Any failed host operation seals the call even if caught, retires namespace/dormant Promises and returns context_reset with confirmed effects. Unique missing/ambiguous lookup fails; optional query/count returns zero and waitFor timeout is data.

Closed diagnostics carry phase, known method/field, expected form, safe example and available source position/symbol. Keep raw interpreter text private; echo only known unsupported option names. Shared guide/help(read/visual/downloads/legacy) owns signatures: string names, numeric deltas, supported waits, validation before dispatch. CDP preserves actual correlated method and supplied signed code. Lost/malformed mutation exchange is helper_exchange/response_unavailable with unknown effect; diagnostics authorize nothing.

Limits: canonical snapshot 256 KiB; complete response 512 KiB; explicit UTF-8 logs 64 KiB. Stream logs before later operations. Retain earlier explicit output after read/navigation failure/timeout/uncertainty separately from current observations. Failed reads discard their data/pixels and stop later calls/logs; private pause discards invocation content. One bounded prefix buffer, no ledger/replay.

Only snapshot/observe/locator.snapshot accept emit; collections require log, screenshots/help always emit. emit:false preserves identity/budget. Default automatic snapshot is 32 KiB with opaque refs/parents; omissions are unknown/truncated. Full/node detail retains 2,000-code-point fields/flags; detail-mode change resets diff baseline. Failure uses the same bounded projection.

## Input
ui.type inserts, fill replaces. Native doubleClick/scroll keep parity; scroll centers the window and scrollAt selects coordinates without clicking. Semantic selector scroll is separate. Browser waits accept text|value, equals:string and optional timeout, read visible textContent/value without new input; native rejects these conditions. Completed waits survive later guest failure.

Drag duration_ms is integer 0..5000; straight held path, zero adds no delay. Monotonic scheduling avoids accumulated waits, not transport overhead. Cancel/takeover/document invalidation stops and releases only owned input at last confirmed position. Unknown replies never replay. NativeInputSequence starts timing after acknowledged down, retains authorization/cancellation and event receipts. Independent AppKit qualifies native timing; browser results cannot.

## Reads and identity
[Semantics](computer-use-semantics.md) owns schema v2; [read contract](computer-script-read-contract.md) owns strict shapes, branchable absence and bounds. getByRole(role,{name?, exact?, root_ref?}) uses canonical roles; snapshots/nodes/subtrees are direct, legacy observe/read wrappers remain.

locator.text reads one explicit unique HTML innerText through fixed isolated-world code: <=12,000 Unicode characters, rendered_element scope and truncation; no hidden/unloaded text or arbitrary DOM script. Document/text/SVG reject TARGET_CAPABILITY_UNAVAILABLE before reading, without substituting parent/body. Attributes are string|null, rejecting >2,000 code points. Method/capability/choose_supported_read facts survive all layers. Unknown reads stop but preserve valid refs; model may explicitly choose another supported read.

Image input handles bind immutable frame/document/image; editable metadata cannot retarget. Download results always include downloads and immutable cursor-bound wait. After export inspect existing ID instead of clicking again. Screenshots accompany results, never require paths/PNG export.

One needs_observation value drives execution/output. Safe snapshot (even emit:false) or screenshot clears it; input, staleness, failed reads or unknown effects require fresh observation. observation_status requires current safe evidence; title is insufficient. Private takeover excludes pixels/observations from model history.

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
