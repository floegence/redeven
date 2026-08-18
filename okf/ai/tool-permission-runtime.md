---
type: AI Tool Contract
title: AI tool permissions and dispatch
description: Tool registration, scheduling, permission, readonly, and target-routing contracts.
tags: [ai, tools, permissions, dispatch]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Redeven owns the product tool registry, presentation metadata, concrete handlers, current permission setting, and approval UX, while Floret owns the generic invocation lifecycle. Visible tools are rebuilt from the exact current thread setting before provider steps and local dispatch. Missing, unreadable, empty, invalid, or unauditable permission state fails closed; no previous snapshot or default permission can authorize execution. Ordinary calls in one model response may execute concurrently, while dependent work must wait for a later response.

# Contract

## Mechanism

The builtin registry includes readonly file/search/fetch helpers, standard mutation, patch, terminal, web search, OKF, todo, interaction, skill, and subagent tools. Flower's product permission is `permission_type`, with `readonly`, `approval_required`, and `full_access` as the only current values. Readonly-exclusive file/search/fetch helpers appear only on the `readonly` surface; the other modes expose the standard host tools. Redeven projects builtins into Floret definitions with effects, read-only/destructive/open-world flags, resource extractors, dynamic permission, and Activity projection. `ToolPresentationSpec` remains the single Redeven display policy, while Floret remains the lifecycle authority; Flower renders only allowlisted semantic detail and never falls back to raw tool-state field tables.

Ordinary tool scheduling follows the model's response boundaries. When one model response contains multiple ordinary tool calls, published Floret v4.0.12 starts the batch concurrently; each call independently validates arguments, extracts resources, checks permission, waits for approval when required, dispatches, projects output, and records canonical facts. Result arrays and provider transcript entries retain the model's original call order, while observations retain actual start and completion order. A failed, rejected, or timed-out call does not stop an independent sibling. A dependent call must be emitted in a later response after the prerequisite result is visible. Neither Floret nor Redeven infers dependencies or conflicts from tool names, arguments, effects, resources, filesystem paths, shell commands, permissions, or approval requirements. `MaxToolCalls=200`, cancellation, timeouts, permission and approval gates, output limits, and terminal capacity remain protections; they are not ordering policies.

Floret owns the generic permission, approval, invocation, and effect lifecycle. Redeven decides product policy from `ai_thread_settings.permission_type` and tool metadata, then exposes that decision through Floret `PermissionSpec` and an `EffectAuthorizationGate`. `currentThreadPermissionType` has no fallback: store absence, query failure, missing settings, empty value, or unknown value returns an error. Each hosted turn installs a dynamic surface provider that rereads current product settings, rebuilds tools, signals, prompt, and host context, and validates a non-empty in-memory snapshot before each provider step and Floret dispatch. The snapshot is bound to the current run and canonical thread identity; it is not a durable permission ledger or recovery source. No stale surface, deleted audit row, or `approval_required` default can authorize execution.

Immediately before an irreversible local effect, Redeven validates the complete Floret effect request against the admitted run snapshot, rereads the current product permission, and rejects a tool or permission mode that is no longer authorized. Floret has already made its canonical approval decision; Redeven never creates or waits for a second approval. The gate registers one process-local authorization entry keyed by exact thread, turn, run, tool call, and argument hash and binds it to the exact effect-attempt identity, then enters the run's existing execution admission boundary. The concrete invocation consumes that entry exactly once and receives the exact Floret proof. Failure or cancellation before consumption calls no handler and creates no fallback authorization. Delete and shutdown effect fencing remain Floret runtime responsibilities rather than a Redeven lifecycle lease or recovery protocol.

Concurrent ordinary handlers do not consume a shared proof. Each effect request receives its own invocation-bound entry, and one call cannot overwrite or consume another call's authorization. A saved permission change affects the next dynamic surface and the dispatch-time reread; it cannot rewrite a provider request already sent.

The permission snapshot is a strict in-memory description of one run surface. Its visible tools, decisions, registry/schema/presentation hashes, identity, and epoch bind provider exposure to later dispatch validation, but current permission always comes from product settings. Missing owner identity, empty hashes, inconsistent surface state, or a mismatched epoch fails closed. In `approval_required`, mutating host actions ask through Floret's canonical interaction; in `full_access`, per-tool approval is skipped while schema validation, resource extraction, target routing, output limits, dispatch-time policy, and Floret activity projection still apply. Terminal process operations additionally require effective write and execute permission.

`subagents` control actions do not require approval, while each child tool invocation receives a surface derived from the latest parent setting and still flows through Floret permission, resource, approval, and effect lifecycle. Tool handlers execute only already-authorized domain actions. Floret remains the sole persistent source for tool identity, arguments, lifecycle, result, error, completion output, and Activity; Redeven's process-local permission snapshot never becomes a tool-state or Flower display source.

Readonly-exclusive helpers are not general convenience aliases. `read_file`, `read_files`, `rgrep`, `find`, and `web_fetch` are visible only in `readonly`; `approval_required` and `full_access` use the standard host surface instead. `web_fetch` is a host-provided Redeven tool with SSRF protections, manual redirect validation, resolver and dial-time public IP checks, proxy suppression, body and MIME limits, and public-network-only semantics. DNS-derived VPN fake-IP answers in `198.18.0.0/15` are allowed for named hosts so common transparent-proxy/VPN setups can fetch public pages, but literal `198.18.0.0/15` URL hosts and other blocked local/private/reserved targets remain denied. It is not a Floret builtin and must not appear as a Floret core tool or a capability available to non-readonly permission types.

When a thread is configured for explicit target routing, the runtime forwards target-scoped builtin calls through `TargetToolExecutor`. The target executor receives a `TargetToolCall` containing `target_id`, `tool_name`, sanitized arguments, and required capabilities. The run layer returns a result payload that preserves or injects `target_id` and `execution_location`, so target-routed tool results cannot lose provenance before they reach the model or activity timeline.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. Current repository knowledge access uses `okf.index`, `okf.search`, and `okf.open`: index for broad directory discovery, search for short candidate lists, and open for detailed concept content. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Target provenance is part of the tool contract, not a UI hint. Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

# Evidence

- `redeven:internal/ai/tools/registry.go:299` - OKF tools carry read-only structured presentation policy.
- `redeven:internal/ai/floret_tools.go:91` - Redeven projects active builtins into Floret definitions and invocation handlers.
- `redeven:internal/ai/prompt_builder.go:322` - Prompt construction routes information sources between workspace tools, OKF, and external web discovery.
- `redeven:internal/ai/target_tool_policy.go` - Target tool calls and results preserve explicit target and execution-location provenance.
- `redeven:internal/ai/subagents_floret.go` - Child runs receive the parent-derived product permission surface under Floret lifecycle ownership.
- `redeven:internal/ai/dynamic_permission_surface.go:48` - Hosted turns fail closed while rereading current thread permission and rebuilding the run surface.
- `redeven:internal/ai/permission_snapshot.go:27` - Run-local snapshots bind exact surface and canonical owner identity without durable lifecycle storage.
- `redeven:internal/ai/floret_effect_authorization.go:115` - Dispatch revalidates current policy and transfers one invocation-bound proof.
- `redeven:internal/ai/floret_approval_command_integration_test.go` - Published-runtime integration covers canonical approval and fail-closed correction.
- `redeven:internal/ai/readonly_web_fetch.go` - `web_fetch` enforces public-network-only SSRF and response limits.
