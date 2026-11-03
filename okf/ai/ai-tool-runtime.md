---
type: AI Tool Contract
title: AI tool runtime
tags: [ai, tools, runtime, floret]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven registers typed tools with product policy, presentation and effects; Floret owns admitted conversations, invocations, approval and history. This concept indexes focused tool, terminal, model, thread and subagent contracts. Detailed behavior belongs with its owner, without a duplicate implementation inventory.

# Contract

## Mechanism
Floret renders reference display content and snapshots into canonical model history for execution and compaction, preserving order across follow-ups.

Lease release follows the canonical terminal view, not the HTTP response or Desktop connection lifetime, so an existing session cannot admit hidden work after the final lifecycle snapshot.

# Boundaries

Redeven must consume published Floret releases and must not persist a second copy of Floret-owned conversation, tool, approval, todo, context, projection, or provider state. Tool and execution provenance must come from explicit contracts and results rather than inference.

# Evidence

- `redeven:internal/ai/tools/registry.go:98` - Source.
- `redeven:internal/ai/tools/types.go:126` - Source.
