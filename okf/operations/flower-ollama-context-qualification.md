---
type: Qualification Contract
title: Flower Ollama context qualification
tags: [flower, ollama, context, qualification]
lifecycle: active_evidence
reviewed_at: "2026-11-01"
---
# Summary

Opt-in Ollama acceptance uses production Flower, gateway and Floret. Native usage must match canonical totals; real compaction preserves facts through restart. Tests own state/proxy; failures never substitute simulated responses or alter the user model configuration.

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

- `redeven:scripts/check_flower_context_ollama.sh` - Tests.
- `redeven:internal/ai/model_catalog.go` - Source.
