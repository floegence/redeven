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

Published Floret v7.69.1 owns canonical View and Summary. Redeven consumes a
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

The detail endpoint still calls the complete Floret `ThreadService.View`.
Point-summary reads avoid unrelated conversations; they do not bound the selected
conversation's body, response size, decoding, timeline projection or mounted row
shells. Floret's window subscription is not yet the Flower detail transport.
Lazy content inside collapsed tool sequences reduces first presentation work
without claiming end-to-end pagination or a constant-time cold load.

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
