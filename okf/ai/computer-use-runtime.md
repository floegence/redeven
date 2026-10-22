---
type: AI Tool Contract
title: Computer and browser use runtime
description: Keep target execution, authorization and observation under one Runtime owner while composing semantic actions in bounded scripts.
tags: [ai, computer-use, browser-use, targets]
timestamp: 2026-09-19T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

`ComputerUseRuntime` owns targets, adapter resources, active control and script
processes. Published Floret owns Agent lifecycle, tool effects and canonical
results. Flower prefers authorized commands and integrations for data work,
semantic browser or desktop operations for interaction, and explicit images for
visual decisions. A missing target, permission or capability fails explicitly;
no adapter silently selects another tab, window or device.

# Contract

## Execution
`computer.observe` reads bounded semantic information, with an optional image.

See the [adapter result contract](floret-redeven-adapter-and-projection.md).

## Platform adapters
The [browser contract](computer-use-browser.md) covers managed profiles, explicit CDP tabs and same-device Chrome extension bindings.

Stage viewing uses its independent bounded sampler; those samples never enter model history. See [Computer media](computer-use-media.md).

## Task access
Each computer invocation receives the permission snapshot established at its tool authorization boundary. Opaque origins never become origin grants.

Target selection chooses where work runs; it is not another confirmation of an already authorized action.

## Packaging and compatibility
Browser execution JSONL and Native Messaging use protocol 6 for Runtime-owned pause control, explicit page selection, reveal, popup progress and confirmed progress on observation failure.

Native window capture continues to respect Desktop-window exclusion and never substitutes an unrestricted display capture after failure.

# Boundaries

The [qualification contract](computer-use-qualification.md) owns acceptance and performance evidence. The paired managed-browser benchmark, complete Linux UI scope and macOS native fixtures pass their declared scopes; complete Desktop qualification and exact-main integration remain required for delivery.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - target resources and readiness owner.

- `redeven:desktop/src/main/runtimeFlowerRoutes.ts` - exact Desktop IPC routing to Runtime endpoints.

- `redeven:internal/ai/run.go` - canonical tool boundary and partial error results.
