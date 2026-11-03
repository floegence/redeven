---
type: Execution Contract
title: Computer script read and validation boundaries
tags: [ai, computer-use, scripts, validation]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Browser/native reads deliver the promised shape or explicit failure; absent observation never becomes empty data. Later read failure preserves confirmed input without replay. [Scripts](computer-use-scripts.md) owns namespace/failure barriers; every read retains permission, privacy and publication checks.

# Contract

## Validation and lifetime
All guest/image/download-cursor methods validate min/max arity before dispatch. Extras yield SCRIPT_ARGUMENT_ERROR with method/documented_arity; existing signatures/type/options remain. Empty/zero/null are valid only where promised. Missing/malformed observations seal the call; never fabricate trees. Only explicit snapshot/observe on_invalidated:return can branch on the restricted typed document-change result defined by [scripts](computer-use-scripts.md).

One boundary covers node/text/query/table/attribute/condition and lower-level faults, retaining semantic_read/source identity. Whole-page reads/screenshots bind the page revision through publication. Ref-scoped content binds existing target/ancestor/main document records; unrelated child replacement alone need not invalidate it. Entry/final privacy scans remain page-wide and may fail independently. No second lifecycle ledger. Scan ordinary reads at entry/publication; failed publication retires image. No page-quiescence requirement.

Empty child-frame URL requires document.URL from that exact isolated frame with unchanged lifecycle/origin/privacy checks. Never substitute parent or allowlist blank. Missing/invalid URL fails without malformed reply/disconnection; later explicit same-page reads may recover. Keep input confirmation separate.

## Condition waits
One deadline covers preparation/entry safety/samples. Check privacy each sample without rereading title/URL. Return requested_state/timeout_ms/elapsed_ms/samples, not readiness. Timeout is data; requireState raises CONDITION_TIMEOUT, seals calls even if caught, preserves completed prefix. Diagnostics include method/state/timeout/zero-based operation_index and failed_action/failed_operation_index, excluding matching text/raw exception. Completed wait need not match.

Typed document_changed/candidate_changed invalidation distinguishes the actual lost identity and discards only its sample, preserving deadline/privacy latch. Protocol rejection needs independently observed revision change, never wording. Revalidate original unique query/scope after state read; even absence requires valid fixed scope. Invalid samples cannot mean absent/hidden. Ambiguity/stale refs or root_ref/unknown protocol or evaluation/permission/cancel stops. Ordinary reads/input never retry candidate faults.

## Navigation and delivery
Script navigate/back/reload: wait_until commit|domcontentloaded|load, timeout_ms0..30000, defaults load/20000. Return command_acknowledged/navigation_stage/wait{state:reached|timeout,wait_until,timeout_ms,elapsed_ms}. Correlate root/loader milestones, including pre-ack events; explicitly report same-document/download. Deadline begins before dispatch. Timeout permits explicit read/wait in same namespace; network/unknown ack/permission/cancel/target change stops. No replay/network-idle heuristic.

Pointer/key/text/fill/wheel/drag/sequences return closed delivery facts/needs_observation/observation_invalidated, no page read/business-success claim. Optional safety failure yields bounded post_action_check.state=unavailable, neither revoking ack nor publishing unchecked content. Confirmed private input pauses; permission/cancel/connection/target/cleanup/uncertain barriers stop. Later reads own full privacy; content-returning edits/legacy image calls retain observation boundaries.

## Evaluation and action facts
One Runtime.evaluate/callFunctionOn checker rejects exceptionDetails, missing or operation-invalid result; promised false/zero/empty/null and void install/reset undefined remain valid. Only same-document confirmed installation updates prepared-frame map. Explicit later read may prepare again, never replay input/navigation/call; observer readiness is not app readiness.

Evaluation facts: phase=evaluation, actual method, exception|invalid_result. DOMSnapshot validates used fields, accepts protocol-empty, omits unavailable offsets; invalid shape retains adapter/method/invalid_result. Transport retains known method without invented code; wrapping preserves typed invalidation. Unknown faults keep stage/internal_error. Canonical result/Activity/correlated logs exclude exception text/stacks/page values. Prior output survives except privacy takeover. Help uses observed roles/refs, not business guesses.

Separate preparation, acknowledged events and requested-operation completion: action_executed confirms completion; preparation_executed requests fresh read without adding click/scroll to completed_actions. Partial posted/observed counts imply no business success. Unknown delivery/release stays uncertain; mutating-evaluation exception cannot confirm completion. Hit-test diagnostics name point_coordinates/point_node/target_ancestry/embedding_frames/scroll_intersection without DOM text. Resolve CSSPseudoElement to origin before ordinary ancestor/shadow checks; unrelated overlays reject without alternate points/targets. Flower distinguishes prepared/partial interruption; failed_operation_phase never describes completed prefix.

Text layout uses Range rectangles; elements/documents use native geometry. Unsupported measurement fails explicitly, never invents hidden state. connected/rendered/visible/opacity_zero/enabled/editable/receives stay distinct. Offscreen text can be visible. Transparent rendered pointer targets require real hit ownership; hover need not be enabled, click must be enabled, fill must be editable. Rejections expose closed stage/state/bounds facts. Root hit checks avoid unrelated frame enumeration; OOPIF checks validate known ancestor documents and overlays.

## Bounded reads/input
Validate whole operation before virtual focus/scroll/input. Diagnostics contain phase/field/expected/recovery, not secrets/page errors. Keys are characters/documented names with Alt/Control/Meta/Shift; physical Equal invalid. Primitive computer.wait defaults zero, no settling promise; legacy waitFor retains state.

query(limit,cursor) reads authorized loaded AX/allowlisted attributes with total/truncation/document/cursor. Content change invalidates cursor; store only returned refs. Page<=200 items/48KiB; virtual unloaded rows unvisited. href retains relative/query/fragment, redacts credentials; linkSummary is normalized, non-actionable and query/fragment-free. Long fields use source reads.

rows requires unique table/grid, excludes nested tables, returns header/data/cell roles/source refs. Page<=200 rows/48KiB; row<=200 cells/44KiB; cell<=2000 Unicode characters. cells_truncated/text_truncated disclose loss; incomplete rows prove no exact total. Cursor binds full cell content. count=loaded matches; attribute=string|null. Native rejects browser-only before dispatch.

scroll_progress stays return-only; scope/measured_ref identifies requested element/viewport, not guessed wheel receiver. before/after/offset_changed are immediate; scroll_effect unknown; invalid/unavailable samples null. Preparation/input separate. Wheel uses clipped/transformed visible intersection (document viewport), not enabled state/offscreen center. Check ancestry/embedding overlay before one wheel; reject with preparation facts, no alternative search/replay.

After two equal observations per namespace/document/scope, bounded advice describes only observed sample. Truncation retains read_options/root/limit/continuation; model chooses. Node detail is not subtree; child_refs covers returned relations and children_truncated flags loss. Collections use snapshots/loaded rows/query/count.

# Boundaries

[Source reads](computer-source-reads.md) owns original AX/DOM fields/chunks/children/cursors/ref retention under the same privacy/publication boundary. Loaded collections prove no unseen dataset. Recovery never changes target, persists lifecycle or replays input.

# Evidence

Browser read-contract/script Node suites, Runtime script tests and [provider qualification](computer-use-qualification.md) cover these boundaries.
