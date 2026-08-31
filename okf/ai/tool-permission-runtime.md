---
type: AI Tool Contract
title: AI tool permissions and dispatch
description: Tool registration, scheduling, permission, readonly, and target-routing contracts.
tags: [ai, tools, permissions, dispatch]
timestamp: 2026-07-18T00:00:00Z
---
# Summary

Redeven owns product visibility, presentation, current permission, prompt, and approval UX, while Floret owns generic invocation and product-neutral tool implementations. Visible tools are resolved once from the exact thread setting when the hosted Agent is created, then remain fixed for its compaction generation. Dispatch rereads current permission and may only tighten authorization. Missing, unreadable, empty, invalid, or unauditable permission state fails closed; no previous snapshot or default permission can authorize execution. Ordinary calls in one model response may execute concurrently, while dependent work must wait for a later response.

# Contract

## Mechanism

The registry includes readonly file/search helpers, standard mutation, patch, terminal, web search, OKF, todo, interaction, skill, subagent, and Floret-native tools. Flower's product permission is `permission_type`, with `readonly`, `approval_required`, and `full_access` as the only current values. Readonly-exclusive file/search helpers appear only on the `readonly` surface; shared readonly tools appear in all three modes. Redeven projects host builtins into Floret definitions, but a native factory supplies `web_fetch` directly from `tools/webfetch`, preserving Floret's schema, effects, resources, executor, output policy, and Activity. `ToolPresentationSpec` remains the single Redeven display policy, while Floret remains the lifecycle authority. Structured detail uses Floret's bounded typed rows; operation, status, repeated names, and raw tool fields never create an expand affordance. Successful Skill activation is static unless it has a real error detail. Every running Activity tool uses the existing lifecycle status to drive one title-only, theme-aware sweep. Settlement removes the sweep immediately; no row overlay, timer, or second lifecycle state exists. Reduced-motion and forced-colors modes keep the static title.

Ordinary tool scheduling follows the model's response boundaries. When one model response contains multiple ordinary tool calls, published Floret v6.1.0 starts the batch concurrently; each call independently validates arguments, extracts resources, checks permission, waits for approval when required, dispatches, projects output, and records canonical facts. Result arrays and provider transcript entries retain the model's original call order, while observations retain actual start and completion order. A failed, rejected, or timed-out call does not stop an independent sibling. A dependent call must be emitted in a later response after the prerequisite result is visible. Neither Floret nor Redeven infers dependencies or conflicts from tool names, arguments, effects, resources, filesystem paths, shell commands, permissions, or approval requirements. `MaxToolCalls=200`, cancellation, timeouts, permission and approval gates, output limits, and terminal capacity remain protections; they are not ordering policies.

Terminal PTYs retain raw bytes, sequence numbers, and byte totals. A single
Redeven text projection normalizes invalid UTF-8 before `terminal.exec`,
`terminal.read`, Activity, and API output; contract truncation then operates on
Unicode code points. Published Floret v6.1.0 normalizes that display text before
Effect fingerprinting and canonical persistence, and the committed Effect entry
is the sole result message. Identity, entry-integrity, and artifact checks still
fail closed, while serialization differences cannot authorize a rerun or create
a second result fact.

Floret owns the generic permission, approval, invocation, and effect lifecycle. Redeven decides product policy from `ai_thread_settings.permission_type` and tool metadata, then exposes that decision through Floret `PermissionSpec` and an `EffectAuthorizationGate`. `currentThreadPermissionType` has no fallback: store absence, query failure, missing settings, empty value, or unknown value returns an error. Each hosted Agent resolves one non-empty provider surface and binds its snapshot to the current run and canonical thread identity. Before effect dispatch, Redeven rebuilds a non-committing permission snapshot only for authorization comparison; it does not replace the provider tools, signals, System Prompt, or host context. The snapshot is not a durable permission ledger or recovery source. No stale surface, deleted audit row, or `approval_required` default can authorize execution.

Immediately before an effect, Redeven validates the complete Floret effect request against the admitted run snapshot, rereads the current product permission, and rejects a tool or permission mode that is no longer authorized. Floret has already made its canonical approval decision; Redeven never creates or waits for a second approval. Host-implemented tools receive one process-local invocation proof before their handler runs. Floret-native tools execute directly inside the authorized Floret effect and do not create a redundant host-handler proof. Both paths enter the run's existing execution admission boundary. Failure or cancellation before dispatch calls no implementation and creates no fallback authorization. Delete and shutdown effect fencing remain Floret runtime responsibilities rather than a Redeven lifecycle lease or recovery protocol.

Concurrent ordinary handlers do not consume a shared proof. Each effect request receives its own invocation-bound entry, and one call cannot overwrite or consume another call's authorization. A saved permission change affects dispatch-time authorization and the next hosted Agent; it cannot rewrite the active Agent's provider surface or a provider request already sent.

The permission snapshot is a strict in-memory description of one run surface. Its visible tools, decisions, registry/schema/presentation hashes, identity, and epoch bind provider exposure to later dispatch validation, but current permission always comes from product settings. Missing owner identity, empty hashes, inconsistent surface state, or a mismatched epoch fails closed. In `approval_required`, mutating host actions ask through Floret's canonical interaction; in `full_access`, per-tool approval is skipped while schema validation, resource extraction, target routing, output limits, dispatch-time policy, and Floret activity projection still apply. Terminal process operations additionally require effective write and execute permission.

`subagents` control actions do not require approval, while each child hosted Agent receives a surface derived from the parent setting at admission and every child tool invocation still flows through Floret permission, resource, approval, and effect lifecycle. Tool handlers execute only already-authorized domain actions. Floret remains the sole persistent source for tool identity, arguments, lifecycle, result, error, completion output, and Activity; Redeven's process-local permission snapshot never becomes a tool-state or Flower display source.

Readonly-exclusive helpers are not general aliases. `read_file`, `read_files`, `rgrep`, and `find` remain `readonly` only. Floret-native `web_fetch` appears once in every permission mode and normally needs no approval. Redeven binds current permission and enables only the DNS-resolved `198.18.0.0/15` exception; literal benchmark IPs and other private, metadata, mixed-DNS, or reserved targets remain blocked. Floret owns fetch security, decoding, conversion, output, and typed Activity. Activity carries requested and final URLs, metadata, and a 2,000-character preview; the full body stays in the result and artifact. Floret ignores page icons. Flower shows exactly one row indicator: Searching animates while running and freezes after success, while a failed fetch uses the shared error alert. There is no separate title icon.

When a thread is configured for explicit target routing, the runtime forwards target-scoped builtin calls through `TargetToolExecutor`. The target executor receives a `TargetToolCall` containing `target_id`, `tool_name`, sanitized arguments, and required capabilities. The run layer returns a result payload that preserves or injects `target_id` and `execution_location`, so target-routed tool results cannot lose provenance before they reach the model or activity timeline.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. Current repository knowledge access uses `okf.index`, `okf.search`, and `okf.open`: index for broad directory discovery, search for short candidate lists, and open for detailed concept content. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Target provenance is part of the tool contract, not a UI hint. Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

# Evidence

- `redeven:internal/ai/tools/registry.go:299` - OKF tools carry read-only structured presentation policy.
- `redeven:internal/ai/floret_tools.go:91` - Redeven projects host builtins and selects the direct Floret-native path.
- `redeven:internal/ai/floret_native_tools.go` - The unique native factory derives `web_fetch` from Floret and binds current product permission.
- `redeven:internal/ai/prompt_builder.go:322` - Prompt construction routes information sources between workspace tools, OKF, and external web discovery.
- `redeven:internal/ai/target_tool_policy.go` - Target tool calls and results preserve explicit target and execution-location provenance.
- `redeven:internal/ai/subagents_floret.go` - Child runs receive the parent-derived product permission surface under Floret lifecycle ownership.
- `redeven:internal/ai/run_tool_surface.go` - Hosted Agents resolve one fixed provider surface while effect authorization may build a non-committing current-permission comparison.
- `redeven:internal/ai/permission_snapshot.go:27` - Run-local snapshots bind exact surface and canonical owner identity without durable lifecycle storage.
- `redeven:internal/ai/floret_effect_authorization.go:115` - Dispatch revalidates current policy and transfers one invocation-bound proof.
- `redeven:internal/ai/floret_approval_command_integration_test.go` - Published-runtime integration covers canonical approval and fail-closed correction.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - Explicit renderer presenters consume typed Floret Activity data and use target references only for authorized product actions.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - The collapsed card shows the requested URL with one status-aware indicator, using Searching for active and successful fetches and the shared alert for failures; the existing row status also scopes the running title sweep, and expansion lazily renders response metadata and the bounded preview without fetching or reconstructing content.
- `redeven:internal/flower_ui/src/styles/flower.css` - The running-state selector owns the title-only sweep and removes it for reduced-motion and forced-colors presentation.
- `redeven:internal/flower_ui/src/WebFetchSearchingOrb.tsx` - The product adapter drives the published `thinking-orbs` Searching engine, pauses completed and offscreen rows, and respects reduced motion.
