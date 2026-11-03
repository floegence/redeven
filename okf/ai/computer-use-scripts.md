---
type: Execution Contract
title: Computer script execution and semantic observations
tags: [ai, computer-use, scripts, accessibility]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

One computer.exec is one Floret effect attempt. QuickJS exposes controlled ui/browser/log under ComputerUseRuntime. Same-target loops/navigation compose, but target/permission/private-input changes stop at existing interaction boundaries, preserving confirmed progress without uncertain replay.

# Contract

## Authority
Recheck target policy/grant/cancel/control per operation. Canonical turn retains target; live sampling may interleave. Target/permission change preserves confirmed prefix and stops. Existing private-input/approval interactions bind temporary consent to target/URL/lease.

Unrestricted turns discover/select_target/exec; explicit/saved primitives, including read-only callers, retain discovery. Retry admits only source-Turn names/current grants via canonical APIs; Floret prepares missing metadata once before requery. BatchExclusiveGroup rejects conflicting prepared targets before authority/input and preserves cross-batch gates; unrelated tools/inventory may coexist. No alias/rebind/replay.

## Guest and diagnostics
Require target/code/readable description. Limits:30s/50 operations/eight namespaces; ui.budget/results expose remainder. Await/loop/same-page navigation compose; image judgement waits for model. No timers; const/let call-local, globalThis only healthy turn/target lifetime.

SCRIPT_NO_PROGRESS=no supported pending work; STALE_REFERENCE=invalid observed identity. Neither implies interference or allows replay/retarget. Failed host calls seal even if caught, retire namespace/dormant Promises, return context_reset/confirmed effects. Unique missing/ambiguous lookup fails; optional query/count zero and waitFor timeout remain data.

Compilation phase=parse; rejected jobs/execution preserve execution/host_operation even for SyntaxError. Closed diagnostics include phase/known method/field/expected/example/available source position-symbol; raw interpreter text private. Echo known unsupported option names only. Guide/help(read/source/interaction/visual/downloads/legacy) owns signatures/deltas/waits/validation and observed roles, not business guesses. CDP retains method/signed code. Source-owner absent/closed/busy/identity rejection returns action_executed:false before dispatch. helper_exchange retains response_unavailable|invalid_response|helper_rejected and uncertainty regardless of wording; only exact request/target/validated evidence confirms non-execution.

## Output
Bounds: snapshot256KiB/helper512KiB/final1MiB/log64KiB UTF-8/explicit prefix384KiB encoded. Exact-size admission yields SCRIPT_OUTPUT_LIMIT/continuation, never replay or silent middle loss. Logs precede later operations. Explicit prefix survives later failure/timeout/uncertainty; failed read drops only its own data/pixels and stops subsequent calls/logs. Private pause removes invocation content.

One prefix retains emitted trees/operation_index/target_id; output_order indexes logs/observations/images; observation is compatibility view. Prior images survive but authorize no stale coordinates. Encoding/Activity keeps order and discloses preview limits. Only snapshot/observe/locator.snapshot accept emit; collections need log, screenshot/help always emit. emit:false retains guest structure/identity/budget.

Automatic tree_text avoids duplicate nodes;32KiB includes escaping/metadata. Title/URL each4KiB encoded with loss flags; document identity exact. Activity handles bounded/blank fields. Legacy observe/full:true/node keep structure. JSON-quoted ref/role/name and key=JSON prevent quote/newline/bidi forgery. Indent expresses ancestry; parent_ref handles sparse/depth>8. Frame inheritance only within full trees; frame_absent explicit. False/mixed/empty/loss flags survive. source_truncated vs output_truncated separates collection/presentation; truncated covers either.

Product emits parent-first depth-first prefix with sibling order/adjacent branches. Linear encoded charging reserves omissions/advice, no tokenizer guess/new budget API. Floret counts request tokens; published browser/native owns collection/input. Diff requires same document/scope/detail and complete source/output. Replace full records, remove absent fields, retain unlisted descendants. New/reordered/reparented nodes force full; use full when smaller. Detail change resets baseline. Full/node fields<=2000 code points plus loss flags.

## Reads/input
Model chooses trees/subtrees for controls, HTML text for prose/code, rows/query for loaded data, screenshots for visuals. Retain row headings/units/period/scope. Counts/cursors prove no unseen dataset; successful reads may show application errors. Bind findings to observed object keys; denied/unvisited stays unknown. Never infer business success or relocate findings; no site/industry policy.

Input returns delivery; optional checks cannot revoke ack. Explicit reads own [privacy/observation](computer-script-read-contract.md). type inserts/fill replaces. Native doubleClick/scroll parity: scroll centers window, scrollAt uses coordinates without click; selector scroll separate. Browser waits accept text|value,equals:string,optional timeout over visible textContent/value; native rejects. Completed waits survive guest faults.

Drag duration_ms integer0..5000, straight held path; zero no added delay. Monotonic scheduling avoids accumulated waits,not transport cost. Cancel/takeover/document change stops/releases at last confirmed point. NativeInputSequence starts after down ack, retains authority/cancel/receipts. Unknown reply never replayed; independent AppKit proves timing.

[Semantics](computer-use-semantics.md) owns v2; [read contract](computer-script-read-contract.md) shapes/absence/limits. getByRole(role,{name?,exact?,root_ref?}) uses canonical roles beside node/subtree/snapshot/legacy reads. locator.text uniquely reads HTML innerText with fixed isolated code,<=12000 Unicode/rendered_element/truncation. Document/text/SVG gives TARGET_CAPABILITY_UNAVAILABLE,no parent/body substitution. Attributes string|null, reject>2000 code points. Keep method/capability/choose_supported_read through transport. Unsupported read stops but leaves valid refs for explicit alternative. Source/collection help has no preference order; read_options/advice promises no completeness/readiness.

Immutable image handles bind frame/document/image regardless of edited metadata. Reuse globalThis.image until context_reset/turn/target change requires recapture. Downloads include downloads and immutable cursor wait; inspect exported ID,never click again. Screenshots attach without path/export.

One needs_observation: safe snapshot(including emit:false)/screenshot clears; input/stale/read failure/uncertainty sets. observation_status needs safe current evidence,not title. Private takeover excludes model pixels/content.

# Boundaries

No second history/recovery ledger. Sanitized input_progress preserves partial posted/observed facts, not business completion/replay authority. Changed target/permission requires explicit continuation.

# Evidence

- [Observation](../../internal/ai/computer_observation.go)/[text projection](../../internal/ai/computer_observation_text.go) and tests: order,grammar,diff,scope,native coverage.

## Qualified browser batch example


For inspected URLs and a unique Score region, combine navigation, reads, condition/computation and final screenshot. Visual interpretation follows the result.

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

TestComputerScriptExamplesQualification runs this exact batch and the download-help example through QuickJS/Runtime/installed Chromium: 1.4MB exact download, one export/identity, three scores, retained state and actual screenshot. Image metadata is not a path/PNG buffer.

- `redeven:internal/ai/computer_script.go` - Source.
- `redeven:internal/ai/computer_observation_text_test.go` - Tests.
- `redeven:internal/envapp/ui_src/scripts/redevenComputerScript.mjs` - Source.
