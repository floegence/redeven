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

# Evidence

- GOWORK=off go test ./internal/ai -count=1 -timeout=15m

- GOWORK=off go test ./internal/ai -run '^$' -bench BenchmarkFlowerThreadDetailPointRead -benchtime=1x -count=1 -timeout=10m

- python3 scripts/check_flower_storage_compatibility.py

## Recorded results
Apple M5 Pro, macOS arm64, Go 1.27.2, Node 26.7.0; synthetic paired samples: The structural no-root-list regression and paired scaling comparison establish the removed unrelated-history work.

## Reproduction and regression
Run explicitly from the repository root: Private baseline frames are explicitly validated before shared-frame assertions; tests never discard arbitrary frames to pass.
