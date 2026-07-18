---
type: AI Product Contract
title: Flower plugin generation
description: Flower-generated plugins are Redeven product orchestration through Floret and released ReDevPlugin lifecycle APIs.
tags: [ai, flower, plugins, floret]
timestamp: 2026-07-02T00:00:00Z
---
# Summary

Flower can help users create plugins, but the generated-plugin flow is not a
second plugin platform. Redeven owns the user intent capture, prompt
orchestration, review UX, approval presentation, and product timeline
projection. ReDevPlugin owns templates, validators, package builders, lifecycle
APIs, runtime contracts, sandbox surfaces, and platform policy. Floret owns the
tool dispatch and approval lifecycle that Flower must use.

# Contract

## Mechanism

A Flower-generated plugin flow is a sequence of approved product actions over
released ReDevPlugin APIs. Flower may draft source and manifest content, call
released scaffold, validate, package, install, enable, open, diagnostics,
export/import, update, or uninstall APIs, and show the user review states. The
actual package validity, trust model, lifecycle state, sandbox bootstrap,
permissions, storage/network/runtime access, and operation details remain
ReDevPlugin facts.

Flower tool handlers execute only after Floret permission, resource extraction,
and approval gates allow the domain action. A plugin-generation handler may run
already-approved local steps and call released ReDevPlugin adapters, but it
must not perform its own approval wait, bypass Floret dispatch, mutate Flower
activity rows directly, or convert plugin audit rows into Flower timeline
state. Flower activity must come from Floret `ActivityTimeline` /
`ThreadTurnProjection` and Redeven `ToolPresentationSpec`; plugin operations
and build diagnostics are detail lookup material keyed from approved activity or
operation ids.

Prompt-first generation can propose source, manifest shape, capability intent,
and test plans, but validation is structural. Redeven should use prompt and
contract guidance for intent and complexity, then rely on released ReDevPlugin
validators, package builders, generated SDKs, and compatibility hashes for
platform correctness. If a generated plugin needs a platform capability that
does not exist in released ReDevPlugin, the requirement is recorded upstream
instead of hidden behind a Redeven-local helper.

# Boundaries

Flower must not write plugin registry rows, mint bridge tokens, place plugin UI
assets directly under Env App routes, bypass package signatures or trust
policy, grant storage/network/runtime access outside ReDevPlugin brokers, or
call a business adapter before ReDevPlugin has built the request context.

Flower must not create a Redeven-only manifest format, permissive validator,
package builder, WASM ABI, asset-ticket scheme, runtime supervisor, storage
broker, network broker, or generated SDK shape. Build and package actions are
ordinary Floret-approved Redeven tools over released ReDevPlugin commands or
libraries, not arbitrary shell shortcuts that become a hidden platform surface.

Pending approvals for generated-plugin actions come from Floret's current
pending approval model and Redeven's product projection, not from historical
plugin install audit, ReDevPlugin confirmation rows, or guessed UI state. A
requested approval remains waiting until Floret resolves it.

# Evidence

- `redeven:AGENTS.md:204` - AI behavior should be prompt-first and contract guided.
- `redeven:okf/ai/ai-tool-runtime.md:15` - Floret owns permission lifecycle and Redeven returns allow, ask, or deny before dispatch.
