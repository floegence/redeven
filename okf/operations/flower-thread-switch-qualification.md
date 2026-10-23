---
type: Qualification Evidence
title: Flower conversation switch performance qualification
description: Reproduce point-read scaling, bounded read recovery and actual sidebar presentation with synthetic data.
tags: [flower, performance, qualification, navigation]
timestamp: 2026-10-19T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

Published Floret v7.79.0 owns canonical windows, bodies, View and Summary. Redeven consumes a
point summary and coordinates ephemeral read demand through one loader. The
[sidebar contract](../ui/flower-thread-sidebar.md) and
[Desktop bridge](../desktop/desktop-runtime-bridge.md) own the behavior.
Qualification uses copied released-writer fixtures and synthetic conversations;
it never continues real user tasks. The short-detail P95 target is at least a
70% reduction, with warm selection synchronous P95 below 8 ms and actual
selection feedback presented before transcript commit. These checks are local
qualification, outside ordinary CI and hooks.

# Contract

## Measurement method
Use the same machine, published dependencies, synthetic dataset and build mode for each comparison. The benchmark fails if the short-target P95 reduction is below 70%.

Keep artifacts locally; never commit user databases or credentials.

# Boundaries

Measurements use synthetic conversations and copied released-writer fixtures. Backend point-read timings and the loopback transport fixture are separate experiments; their durations must not be added. These explicit qualification suites stay outside ordinary CI and hooks.

Root detail now uses Floret's window subscription; the initial interval and explicit body expansion bound network demand. GET detail, PATCH detail, command receipts and root live observation use the same public projection. The service's cold actor initialization can still load complete canonical state. Child detail retains its existing full-view transport. Explicitly expanding a single very large item transfers that requested item in full.

The item-window budget excludes product metadata and pending controls. Cold backend timings below are isolated read timings, not remote end-to-end rendering measurements. Lazy collapsed tool content and bounded transport address separate costs.

# Evidence

- GOWORK=off go test ./internal/ai -count=1 -timeout=15m

- GOWORK=off go test ./internal/ai -run '^$' -bench BenchmarkFlowerThreadDetailPointRead -benchtime=1x -count=1 -timeout=10m

- python3 scripts/check_flower_storage_compatibility.py

## Recorded results
Apple M5 Pro, macOS arm64, Go 1.27.2, Node 26.7.0; synthetic paired samples: The structural no-root-list regression and paired scaling comparison establish the removed unrelated-history work.

## Reproduction and regression
Run explicitly from the repository root: Private baseline frames are explicitly validated before shared-frame assertions; tests never discard arbitrary frames to pass.

## Unopened tool content

The tool-sequence browser regression mounts 300 historical calls followed by an
active two-call sequence. Only the two visible activity rows initially exist.
Another historical call arrives while folded; expansion exposes all 303, and
folding and reopening preserves inspected DOM identity.
Streaming regressions open the outer sequence before its nested controls and
continue to verify selection, focus, readers and observer identity.

A local production-build Chromium diagnostic used 355 sidebar rows and 2,000
synthetic calls in twenty groups, separated by prose. Each variant used eight
selections, with the first reported separately as cold. On the same machine,
the seven warm-selection medians changed from 511.8 to 379.3 ms; mounted activity
rows changed from 2,000 to 100 and total surface elements from 57,320 to 30,720.
Median longest task per warm selection changed from 277 to 142 ms. These sequential
baseline/candidate samples include selection scheduling and rendering, exclude
backend/network latency, and are diagnostic rather than a smooth-frame release
gate. Canonical history and row shells remain complete.

## Bounded transport qualification

The deterministic fixture runs 180 calls with large UTF-8 Activity output and a large final answer. Its initial public response decreases from 2,015,243 to 136,355 bytes (93.2%). All 182 items remain reachable, and explicit expansion reconstructs exact Unicode tool and assistant bodies. The test runtime rejects full View calls during ordinary page and body reads. Ownership, cancellation, superseded interests, bounded pressure recovery, append revision preservation and background facts have focused regressions.

An isolated consistent copy of a long local conversation was opened and inspected read-only with the published runtime; no real task was continued. The public full detail was 11,058,337 bytes and the first page 183,597 bytes, a 98.34% reduction. Twenty pages covered all 2,945 items exactly once. First read was 5.159 seconds including cold runtime initialization; a warm bounded read was 4.939 milliseconds. Only aggregate measurements are retained here; user content and databases are never committed.

Browser regression coverage includes initial bounded loading, same-version page movement, explicit text expansion, tool disclosure retry and retained expansion, background status without detail fetch, and navigation cancellation with stale body completion. Existing disclosure/scroll failures were reproduced against the committed baseline separately; they are not evidence of a bounded transport regression.

Run focused qualification with GOWORK=off Go tests matching TestFlowerHistory, shared ThreadCache/runtime record unit tests, and FlowerSurface.history.browser.test.tsx plus streaming and tool-sequence browser suites. Typecheck both hosts and validate all shipped locale catalogs.
