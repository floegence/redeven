---
type: AI Tool Contract
title: Computer and browser use runtime
tags: [ai, computer-use, browser-use, targets]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

ComputerUseRuntime owns targets, resources, control and script processes; Floret owns Agent lifecycle/effects/history. Prefer authorized commands for data, semantics for interaction and images for visual decisions. Stage viewing uses its independent bounded sampler; those samples never enter model history.

# Contract

## Execution
`computer.observe` reads bounded semantic information, with an optional image.
Inside `computer.exec`, `await ui.observe({emit:false})` returns a local object with
`observation.nodes`; script reads receive the full observation. The `full:true`
option controls the emitted snapshot instead of the default diff.

See the [adapter result contract](floret-redeven-adapter-and-projection.md).

## Platform adapters
The [browser contract](computer-use-browser.md) covers managed profiles, explicit CDP tabs and same-device Chrome extension bindings.

See [Computer media](computer-use-media.md).

## Task access
Each computer invocation receives the permission snapshot established at its tool authorization boundary. Opaque origins never become origin grants.

Target selection chooses where work runs; it is not another confirmation of an already authorized action.

## Packaging and compatibility
Browser execution JSONL and Native Messaging use protocol 6 for Runtime-owned pause control, explicit page selection, reveal, popup progress and confirmed progress on observation failure.

Native window capture continues to respect Desktop-window exclusion and never substitutes an unrestricted display capture after failure.

# Boundaries

The [qualification contract](computer-use-qualification.md) owns acceptance and performance evidence. The paired managed-browser benchmark, complete Linux UI scope and macOS native fixtures pass their declared scopes; complete Desktop qualification and exact-main integration remain required for delivery.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - Source.
