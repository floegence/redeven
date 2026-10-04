---
type: Qualification Contract
title: Flower Ollama context qualification
description: Exercise the selected installed model through Flower and compare compaction, native token usage, live observations, and restart recovery.
tags: [flower, ollama, context, qualification]
timestamp: 2026-10-05T00:00:00Z
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

[AI model and context runtime](../ai/model-context-runtime.md) owns model
capacity, budget, usage, and compaction semantics. This qualification observes
that boundary without duplicating the Floret engine or changing serving options.
It tests the environment profile's currently selected installed Ollama model,
including dynamic catalog discovery and current model overrides. It requires
at least 96,000 tokens of discoverable effective capacity so the manual scenario
crosses the compaction target before reaching automatic pressure.

The service runs with read-only tool permission in fresh state and agent-home
directories. The proxy forwards requests and responses to the selected endpoint
and records only request classification, model identity, system/tool digests,
marker presence, HTTP status, finish reason, and token counts. Credentials and
transcripts do not enter the report. The test closes its own services and proxy;
Go removes its temporary stores.

## Acceptance cases

- Small history: `/compact` returns one `noop/context_too_small` record, does
  not request a summary, and retains the original facts.
- Manual compaction: enough synthetic history is added to cross Floret's
  compaction target without reaching automatic pressure. `/compact` creates one
  completed record and one timeline decoration, with a positive estimated token
  reduction.
- Automatic compaction: only the isolated profile's effective context
  percentage is reduced to approximately 32,768 tokens. Bounded history growth
  must trigger the ordinary `engine/pre_request/threshold` path. This is a
  pressure-path qualification, not proof of saturation at the model's complete
  serving capacity.
- Configured-window automatic compaction: the complete current effective
  window remains unchanged. Up to twenty larger history turns must reach the
  same automatic boundary. This separately qualifies the user's actual budget
  rather than inferring it from the reduced-window case.
- All completed compactions require a real summary response, removal of the
  original marker-bearing message from subsequent provider requests, retained
  marker and port recall, and unchanged system/tool digests. Reloaded usage and
  compaction records must match exactly; another real turn after restart must
  recall the same facts without duplicating the compaction.
- Confirmed context equals the last provider `prompt_tokens`; output headroom,
  safe input limit, and displayed ratio match the effective model window.
  Cumulative uncached input, cache-read input, and output match the sum of main
  inference requests. Auxiliary summary/title requests are classified separately
  from Floret's main-turn usage totals.
- The workspace stream must publish estimated context, matching confirmed
  context and cumulative totals, and the same terminal compaction as canonical
  detail. Focused browser tests separately check the indicator's keyboard,
  tooltip, localization, and context-error recovery behavior.

## Execution and evidence

Run `scripts/check_flower_context_ollama.sh`. Set
`REDEVEN_FLOWER_CONTEXT_SOURCE_STATE_ROOT` to the existing local-environment
directory when it differs from `$HOME/.redeven/local-environment`. The script
sets `GOWORK=off`; it uses the published dependencies in `go.mod`. It is never
part of ordinary CI or the push gate.

Set `REDEVEN_FLOWER_CONTEXT_REPORT_ROOT` to a private evidence directory to save
one JSON result per scenario. Reports include runtime PID, temporary state path,
proxy port, served/effective capacity, request observations, compaction metrics,
and final usage. Retain the command log and the tested source commit alongside
these reports. A report's `pass` describes that scenario only; the Go process
exit status is authoritative for the complete run.

# Evidence

- `redeven:scripts/check_flower_context_ollama.sh` - Explicit real-provider entrypoint using the selected local profile.
- `redeven:internal/ai/run_e2e_ollama_context_test.go` - Isolated service, transparent proxy, exact accounting, checkpoint retention, live stream, and restart assertions.
- `redeven:internal/ai/model_catalog.go` - Discovers served capacity before theoretical model capacity.
- `redeven:internal/envapp/ui_src/src/ui/flower/FlowerContextIndicator.browser.test.tsx` - Browser indicator and localization acceptance.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.contextErrors.browser.test.tsx` - Context-budget recovery controls and unknown-effect boundary.
