---
type: Validation Report
title: Flower persistent-index startup acceptance
tags: [flower, startup, performance, storage, validation]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Published Floret 7.52.0 on an isolated 710,344,704 B/219-thread database achieves full product construction/activation P95 9.429 s over 20 runs, with maximum GC-live heap 261.052 MiB upstream/295.018 MiB product. Targets≤10 s/350 MiB pass for this dataset; canonical validation still has substantial temporary allocation.

# Contract

October 17 macOS 26.5.2/M5Pro/Go 1.27.2, checksummed module, no overrides. Ten-run migration/first-index/reopen/binary-change P95 39.500/37.241/7.582/6.425 s. Full upstream/race/API/adoption and product permission/queue/restore tests pass.

# Boundaries

Peak is not idle heap; no canonical validation skip, production store mutation, effect replay or host index. Git retains all timing samples and cbad47d/acad18a/5be01b8 provenance. [Readiness](../architecture/ai-readiness-lifecycle.md) owns current lifecycle.

# Evidence

- `redeven:internal/ai/service_activation.go:1` - Source.
- `redeven:internal/codeapp/ai_readiness_test.go:1` - Tests.
