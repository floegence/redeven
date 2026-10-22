---
type: Qualification Contract
title: Flower Ollama context qualification
description: Exercise the selected installed model through Flower and compare compaction, native token usage, live observations, and restart recovery.
tags: [flower, ollama, context, qualification]
timestamp: 2026-10-05T00:00:00Z
lifecycle: active_evidence
reviewed_at: "2026-10-22"
---
# Summary

The opt-in Ollama qualification uses the production Flower service, its model
gateway, and the published Floret thread runtime. Native provider usage must
agree with canonical Flower context and cumulative totals; compaction must
preserve facts through a real model-generated checkpoint and restart. Tests own
their temporary state and loopback recording proxy. A provider or assertion
failure fails the run; it never substitutes a simulated response or changes the
user's model configuration.

# Contract

## Scope and ownership
[AI model and context runtime](../ai/model-context-runtime.md) owns model capacity, budget, usage, and compaction semantics.

The test closes its own services and proxy; Go removes its temporary stores.

## Acceptance cases
- Small history: `/compact` returns one `noop/context_too_small` record, does   not request a summary, and retains the original facts. - Manual compaction: enough synthetic history is added to cross Floret's   compaction target without reaching automatic pressure. Bounded history growth   must trigger the ordinary `engine/pre_request/threshold` path. Focused browser tests separately check the indicator's keyboard,   tooltip, localization, and context-error recovery behavior.

## Execution and evidence
Run `scripts/check_flower_context_ollama.sh`. It is never part of ordinary CI or the push gate.

A report's `pass` describes that scenario only; the Go process exit status is authoritative for the complete run.

# Boundaries

Results qualify the selected installed model and its observed serving capacity, not every Ollama model or host. This suite does not replace the separate browser interaction checks.

# Evidence

- `redeven:scripts/check_flower_context_ollama.sh` - Explicit real-provider entrypoint using the selected local profile.

- `redeven:internal/ai/run_e2e_ollama_context_test.go` - Isolated service, transparent proxy, exact accounting, checkpoint retention, live stream, and restart assertions.

- `redeven:internal/ai/model_catalog.go` - Discovers served capacity before theoretical model capacity.
