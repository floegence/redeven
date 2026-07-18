---
type: AI Tool Contract
title: AI tool runtime
description: Canonical navigation and ownership boundary for Redeven AI tools and Floret runtime integration.
tags: [ai, tools, runtime, floret]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Redeven exposes typed AI tools through product-owned registration, policy, presentation, and concrete execution adapters while Floret owns admitted conversation, turn, invocation, approval, and projection lifecycle. This overview is the canonical navigation point for the focused tool, terminal, model/context, thread, and subagent contracts. Detailed behavior belongs in those concepts rather than one cross-domain implementation inventory.

# Contract

## Mechanism

This concept is the stable overview for the subject. Detailed contracts are maintained in the focused concepts below:

- [AI tool permissions and dispatch](tool-permission-runtime.md)
- [AI tool approval runtime](tool-approval-runtime.md)
- [AI terminal tool runtime](terminal-tool-runtime.md)
- [AI model and context runtime](model-context-runtime.md)
- [Floret thread runtime integration](floret-thread-runtime.md)
- [Flower subagent runtime](subagent-runtime.md)

# Boundaries

Redeven must consume published Floret releases and must not persist a second copy of Floret-owned conversation, tool, approval, todo, context, projection, or provider state. Tool and execution provenance must come from explicit contracts and results rather than inference.

# Evidence

- `redeven:internal/ai/tools/registry.go:86` - Builtin tool definitions declare mutation, approval, and presentation specs.
- `redeven:internal/ai/run.go:4260` - `terminal.exec` dispatch starts the hosted terminal process lifecycle.
- `redeven:internal/ai/tools/types.go:126` - `ToolPresentationSpec` carries renderer, operation, label, fallback, compact payload, result payload, and activity chip fields.
- `redeven:internal/ai/builtin_tool_handlers.go:18` - Tool success summaries are normalized by builtin name or semantic activity category.
- `redeven:internal/codeapp/appserver/server.go:3737` - Appserver exposes the parent-scoped subagent detail route.
