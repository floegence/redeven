---
type: AI Product Contract
title: Flower plugin generation
description: Flower-generated plugins are Redeven product orchestration through Floret and released ReDevPlugin lifecycle APIs.
tags: [ai, flower, plugins, floret]
timestamp: 2026-07-24T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
A Flower-generated plugin flow is a sequence of approved product actions over released ReDevPlugin APIs.

A plugin-generation handler may run already-approved local steps and call released ReDevPlugin adapters, but it must not perform its own approval wait, bypass Floret dispatch, mutate Flower activity rows directly, or convert plugin audit rows into Flower timeline state.

If a generated plugin needs a platform capability that does not exist in released ReDevPlugin, the requirement is recorded upstream instead of hidden behind a Redeven-local helper.

# Boundaries

Flower must not write plugin registry rows, mint bridge tokens, place plugin UI assets directly under Env App routes, bypass package inspection, signature assessment, explicit confirmation, or trust policy, grant storage/network/ runtime access outside ReDevPlugin brokers, or call a business adapter before ReDevPlugin has built the request context.

A requested approval remains waiting until Floret resolves it.

# Evidence

- `redeven:AGENTS.md` - AI behavior should be prompt-first and contract guided.

- `redeven:okf/ai/ai-tool-runtime.md:15` - Floret owns permission lifecycle and Redeven returns allow, ask, or deny before dispatch.
