---
type: AI Tool Contract
title: AI tool runtime
description: Canonical navigation and ownership boundary for Redeven AI tools and Floret runtime integration.
tags: [ai, tools, runtime, floret]
timestamp: 2026-10-08T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven exposes typed AI tools through product-owned registration, policy, presentation, and concrete execution adapters while Floret owns admitted conversation, turn, invocation, approval, and projection lifecycle. This overview is the canonical navigation point for the focused tool, terminal, model/context, thread, and subagent contracts. Detailed behavior belongs in those concepts rather than one cross-domain implementation inventory.

# Contract

## Mechanism
This concept is the stable overview for the subject.

Floret renders reference display content and snapshots into canonical model history for execution and compaction, preserving order across follow-ups.

Lease release follows the canonical terminal view, not the HTTP response or Desktop connection lifetime, so an existing session cannot admit hidden work after the final lifecycle snapshot.

# Boundaries

Redeven must consume published Floret releases and must not persist a second copy of Floret-owned conversation, tool, approval, todo, context, projection, or provider state. Tool and execution provenance must come from explicit contracts and results rather than inference.

# Evidence

- `redeven:internal/ai/tools/registry.go:98` - Builtin tool definitions declare mutation, approval, and presentation specs.

- `redeven:internal/ai/run.go` - `terminal.exec` dispatch starts the hosted terminal process lifecycle.

- `redeven:internal/ai/tools/types.go:126` - `ToolPresentationSpec` carries renderer, operation, label, fallback, compact payload, result payload, and activity chip fields.
