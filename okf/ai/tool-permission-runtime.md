---
type: AI Tool Contract
title: AI tool permissions and dispatch
description: Tool registration, scheduling, permission, readonly, and target-routing contracts.
tags: [ai, tools, permissions, dispatch]
timestamp: 2026-10-15T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven owns product visibility, presentation, current permission policy, prompt, and approval UX; Floret owns invocation and product-neutral tool implementations. Saved thread permission applies at the next authorization boundary within the same task, including queued work, continuation, retry and restart. Each prepared invocation keeps its own snapshot through approval and execution. Missing or invalid authority fails closed. Ordinary calls in one model response enter authorization together and may execute concurrently; dependent work waits for a later response.

# Contract

Default Flower tools omit write_todos; historical Todo results remain readable. The Floret-native goal tool has independent control ownership; see [Flower Goals](flower-goals.md).

## Mechanism
The registry includes readonly file/search helpers, standard mutation, patch, terminal, web search, OKF, interaction, skill, subagent, MCP, and Floret-native tools. Structured detail uses Floret's bounded typed rows; operation, status, repeated names, and raw tool fields never create an expand affordance.

The resolver validates MIME, size, and digest through the target-owned media store; it never stores image bytes in durable tool state.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

# Evidence

- `redeven:internal/ai/tools/registry.go:299` - OKF tools carry read-only structured presentation policy.

- `redeven:internal/ai/floret_tools.go:91` - Redeven projects host builtins and selects the direct Floret-native path.

- `redeven:internal/ai/floret_native_tools.go` - The unique native factory derives `web_fetch` from Floret and binds invocation product permission.
