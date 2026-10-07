---
type: AI Tool Contract
title: AI tool permissions and dispatch
description: Tool registration, scheduling, permission, readonly, and target-routing contracts.
tags: [ai, tools, permissions, dispatch]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Redeven owns product visibility, presentation, current permission policy, prompt, and approval UX; Floret owns invocation and product-neutral tool implementations. Saved thread permission applies at the next authorization boundary within the same task, including queued work, continuation, retry and restart. Each prepared invocation keeps its own snapshot through approval and execution. Missing or invalid authority fails closed. Ordinary calls in one model response enter authorization together and may execute concurrently; dependent work waits for a later response.

# Contract

## Mechanism

The registry includes readonly file/search helpers, standard mutation, patch, terminal, web search, OKF, todo, interaction, skill, subagent, MCP, and Floret-native tools. MCP transport, configuration identity, and conservative effect mapping follow the [MCP runtime contract](mcp-runtime.md). Flower's product permission is `permission_type`, with `readonly`, `approval_required`, and `full_access` as the only current values. Readonly-exclusive file/search helpers appear only on the `readonly` surface; shared readonly tools appear in all three modes. Redeven projects host builtins into Floret definitions, but a native factory supplies `web_fetch` directly from `tools/webfetch`, preserving Floret's schema, effects, resources, executor, output policy, and Activity. `ToolPresentationSpec` remains the single Redeven display policy, while Floret remains the lifecycle authority. Structured detail uses Floret's bounded typed rows; operation, status, repeated names, and raw tool fields never create an expand affordance. Skill details use saved typed rows or the explicit missing-details notice. Every running Activity tool uses the existing lifecycle status to drive one title-only, theme-aware sweep. Settlement removes the sweep immediately; no row overlay, timer, or second lifecycle state exists. Reduced-motion and forced-colors modes keep the static title.

Ordinary tool scheduling follows the model's response boundaries. When one model response contains multiple ordinary tool calls, published Floret v7.25.2 starts the batch concurrently; each call independently validates arguments, extracts resources, checks permission, waits for approval when required, dispatches, projects output, and records canonical facts. Result arrays and provider transcript entries retain the model's original call order, while observations retain actual start and completion order. A failed, rejected, or timed-out call does not stop an independent sibling. A dependent call must be emitted in a later response after the prerequisite result is visible. Neither Floret nor Redeven infers dependencies or conflicts from tool names, arguments, effects, resources, filesystem paths, shell commands, permissions, or approval requirements. `MaxToolCalls=200`, cancellation, timeouts, permission and approval gates, output limits, and terminal capacity remain protections; they are not ordering policies.

Terminal PTYs retain raw bytes, sequence numbers, and byte totals. A single
Redeven text projection normalizes invalid UTF-8 before `terminal.exec`,
`terminal.read`, Activity, and API output; contract truncation then operates on
Unicode code points. Published Floret v7.25.2 normalizes that display text before
Effect fingerprinting and canonical persistence, and the committed Effect entry
is the sole result message. Identity, entry-integrity, and artifact checks still
fail closed, while serialization differences cannot authorize a rerun or create
a second result fact.

Floret owns permission, approval, invocation and effect lifecycle. `ai_thread_settings.permission_type` is the current product policy. Redeven reads it before each provider request and tool-dispatch batch, and exposes the resulting policy through `PermissionSpec` and an `EffectAuthorizationGate`. Execution authority retains admission permission for historical attribution only; it never overrides current settings during execution. The v9-to-v10 migration remains part of the permanent schema lineage.

Each hosted Agent uses published Floret v7.25.2 `WithAgentDynamicToolSurface` with `RefreshProviderSurface` enabled. Current local tools and permission instructions always refresh, even when queued work started under a mode different from admission. `InitialProviderSurface` retains the first checkpoint's hosted search definitions so unrelated search settings keep their existing Turn boundary, including after restart. A new snapshot binds current permissions, tool definitions and prompt to the authoritative thread and execution key. Floret refreshes the provider envelope at the next request while preserving model, reasoning, earlier checkpoints and canonical history. Dispatch refresh occurs before calls enter authorization; their snapshot stays stable while any approval or execution is pending. Invalid identity, policy or epoch fails closed. No second permission ledger is maintained.

The current system prompt ends with one capability section naming the live
permission mode and available tool names from the same refreshed surface as the
request's tool definitions.
Those current definitions govern model capability claims. Historical
runtime snapshots and assistant statements describe earlier permissions and must
not make a restored tool appear unavailable. A listed tool that requires approval
requests approval by submitting the intended call. The runtime asks before any
effect executes; missing prior approval is not a denial. An actual rejection
still binds the denied action and must not be bypassed with another tool.

Immediately before an effect, Redeven validates the Floret request against its invocation snapshot. Floret has settled any canonical approval; Redeven never creates or waits for a second decision. Each concurrent invocation receives one process-local proof. Cancellation, resource checks, target routing, effect fencing and output limits remain enforced. A setting change cannot settle a pending approval, cancel an executing tool or rewrite a provider request already sent. The next authorization batch reads the new setting.

In `approval_required`, mutating actions use Floret's canonical interaction; in `full_access`, per-tool approval is skipped while the remaining execution checks still apply. Terminal process operations require effective write and execute permission. Model and reasoning settings retain their separate busy guard.

`subagents` control actions do not require approval. Worker admission derives permission from the parent invocation's permission snapshot; reviewers remain readonly. Every child invocation still uses Floret's permission, resource, approval, and effect lifecycle. Tool handlers execute only authorized domain actions. Floret remains the sole persistent source of tool identity, arguments, lifecycle, results, errors, and Activity.

Readonly-exclusive helpers are not general aliases. `read_file`, `read_files`, `rgrep`, and `find` remain `readonly` only. Floret-native `web_fetch` appears once in every permission mode and normally needs no approval. Redeven binds invocation permission and enables only the DNS-resolved `198.18.0.0/15` exception; literal benchmark IPs and other private, metadata, mixed-DNS, or reserved targets remain blocked. Floret owns fetch security, decoding, conversion, output, and typed Activity. Activity carries requested and final URLs, metadata, and a 2,000-character preview; the full body stays in the result and artifact. Floret ignores page icons. Flower shows exactly one row indicator: Searching animates while running and freezes after success, while a failed fetch uses the shared error alert. There is no separate title icon.

When a thread is configured for explicit target routing, the runtime forwards target-scoped builtin calls through `TargetToolExecutor`. The target executor receives a `TargetToolCall` containing `target_id`, `tool_name`, sanitized arguments, and required capabilities. The run layer returns a result payload that preserves or injects `target_id` and `execution_location`, so target-routed tool results cannot lose provenance before they reach the model or activity timeline.

Computer and browser functions are always target-scoped, even when ordinary file tools use the local-runtime policy. Their screenshot attachments use opaque `computer://` references and are expanded only by a target attachment resolver at the Floret provider boundary. The resolver validates MIME, size, and digest through the target-owned media store; it never stores image bytes in durable tool state.

# Boundaries

Tool names are not aliases for deleted knowledge-era tools. Current repository knowledge access uses `okf.index`, `okf.search`, and `okf.open`: index for broad directory discovery, search for short candidate lists, and open for detailed concept content. OKF is an embedded project corpus and does not access the internet; external, current, recent, news, third-party, market, pricing, and general web facts must use direct authoritative URLs or web search discovery instead.

Target provenance is part of the tool contract, not a UI hint. Flower must not infer remote execution from thread context alone; it can only claim remote or target execution when a tool result or Redeven product command returns explicit execution provenance.

# Evidence

- `redeven:internal/ai/tools/registry.go:299` - OKF tools carry read-only structured presentation policy.
- `redeven:internal/ai/floret_tools.go:91` - Redeven projects host builtins and selects the direct Floret-native path.
- `redeven:internal/ai/floret_native_tools.go` - The unique native factory derives `web_fetch` from Floret and binds invocation product permission.
- `redeven:internal/ai/prompt_builder.go:322` - Prompt construction routes information sources between workspace tools, OKF, and external web discovery.
- `redeven:internal/ai/target_tool_policy.go` - Target tool calls and results preserve explicit target and execution-location provenance.
- `redeven:internal/ai/subagents_floret.go` - Child runs receive the parent-derived product permission surface under Floret lifecycle ownership.
- `redeven:internal/ai/run_tool_surface.go` - Hosted Agents resolve current permission at provider and dispatch boundaries.
- `redeven:internal/ai/permission_snapshot.go:27` - Run-local snapshots bind one exact surface to the stable execution identity without durable lifecycle storage or later ID rebinding.
- `redeven:internal/ai/floret_effect_context_integration_test.go` - One provider response dispatches two effects and proves both authorized handlers run, ordered results return, and the Turn completes.
- `redeven:internal/ai/floret_effect_authorization.go:115` - Dispatch validates the invocation policy and transfers one invocation-bound proof.
- `redeven:internal/ai/floret_approval_command_integration_test.go` - Published-runtime integration covers canonical approval and fail-closed correction.
- `redeven:internal/flower_ui/src/flowerActivityPresentation.ts` - Explicit renderer presenters consume typed Floret Activity data and use target references only for authorized product actions.
- `redeven:internal/flower_ui/src/FlowerSurface.tsx` - The collapsed card shows the requested URL with one status-aware indicator, using Searching for active and successful fetches and the shared alert for failures; the existing row status also scopes the running title sweep, and expansion lazily renders response metadata and the bounded preview without fetching or reconstructing content.
- `redeven:internal/flower_ui/src/styles/flower.css` - The running-state selector owns the title-only sweep and removes it for reduced-motion and forced-colors presentation.
- `redeven:internal/flower_ui/src/WebFetchSearchingOrb.tsx` - The product adapter drives the published `thinking-orbs` Searching engine, pauses completed and offscreen rows, and respects reduced motion.

- `redeven:internal/ai/thread_permission_admission_test.go` - Six permission transitions apply within an active task and queued work; settings do not settle pending approvals.
