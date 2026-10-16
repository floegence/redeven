---
type: AI Runtime Contract
title: Model provider surface and history
description: Keep provider-visible model history, tool surface refresh, and render lineage under Floret ownership.
tags: [ai, models, providers, history]
timestamp: 2026-10-15T00:00:00Z
---
# Summary

Floret owns the provider-visible history and render lineage for each Turn. Redeven supplies the current model surface, prompt, permission snapshot, and ephemeral overlays at the declared boundaries. Historical tool facts remain readable without reintroducing removed tools or rewriting canonical history; provider-surface changes create a new compatible lineage and never become a second continuation store.

# Contract

## Native web-search observation

OpenAI Responses hosted search requests include
`web_search_call.action.sources` so returned source URLs can reach the canonical
Activity. The provider adapter passes the action `type`, supplied singular or
multiple queries, target URL and find pattern through the existing published
Floret hosted-tool contract. It projects only supplied source URLs and optional
titles, preserving the distinction between an absent source list and an explicit
empty list. It neither invents titles or snippets nor assigns final-answer
citations to individual searches. Qwen requests keep their existing tool shape.

## Provider surface and history

Flower's provider prefix has one owner. Published Floret v7.37.0 keeps one append-only canonical history and keys each render lineage by the complete provider request surface: provider, model, reasoning, System Prompt, local and hosted tools, adapter, context policy, and provider-state compatibility. Accepted user input, reasoning, assistant text, historical tool calls, and results enter later requests exactly once. `ask_user` remains an Assistant tool call and its durable public answer is the matching Tool result, never a synthetic Assistant explanation plus User JSON. Secret answers leave one redacted Tool result while the real value exists only in the current resume overlay. A provider-surface change sends the full canonical history on its own lineage and clears incompatible exact-surface continuation. Native state marked `canonical_history` remains eligible only when the adapter validates its canonical prefix. It does not compact unless the selected model's context window is actually insufficient. Completed compaction starts one new global generation; other prefix shrinkage or mutation fails as `context_prefix_drift`.

Floret's Engine-owned effective reuse policy and canonical queue-state boundaries also govern [OpenAI connection reuse](model-request-reuse.md). Native response IDs are optimization metadata and never independent conversation authority.

Redeven builds each new hosted Agent from the current product version, persisted thread settings, current System Prompt, and current tool registry. Floret fixes model and reasoning configuration for the Turn. Redeven resolves current permission before provider requests and tool authorization batches. `RefreshProviderSurface` enables the corresponding current prompt and local tools on every request. Hosted search definitions come from Floret's detached `InitialProviderSurface` once a checkpoint exists, preserving unrelated search settings across continuation and restart. No refresh rewrites an earlier request or canonical message. The user's objective stays in Floret's canonical user message and restart recovery reads the original `AgentRequest.CanonicalTurnInput`; an Ask User answer is never promoted into a new objective. Current date, working directory, rule-source manifests, available skills are one durable `UserInput.Context` snapshot accepted with each new user message. Canonical references and these snapshots use the same model-history projection for execution, continuation, retry, fork, restart, and compaction. Later snapshots apply from their admission point and never rewrite earlier facts.

Only explicitly ephemeral material, such as secret answers, uses `SupplementalContext`. Sensitive supplemental context disables opaque provider continuation reuse for that request. Redeven sends the complete canonical message prefix again rather than allowing a provider response id to hide host-context drift. Floret still checkpoints the current provider surface and typed canonical lineage before dispatch, but records only that an ephemeral overlay exists and omits overlay-derived payload hashes, estimates, pressure, request shape, provider state, and response IDs. Permission changes refresh the next authorization boundary and the next provider envelope; model and reasoning remain busy-locked.

Flower has one completion rule: a provider natural stop completes the Turn. Ordinary tool results continue the provider loop, and `ask_user` alone enters a waiting interaction whose answer resumes the same Turn with current permission and unchanged model/reasoning.

Historical tool calls and results remain canonical facts even when their definition is absent from the current product version. New Turns expose only current definitions. A newly emitted call to an unavailable tool is not executed; Floret records a safe ordinary unavailable result and continues. Provider-context v8 hashes these typed conversation facts without transient runtime or journal entry identities, so reconstructing the same unavailable pair for a later Turn cannot create false prefix drift. Previous projection checkpoints cross an explicit render-lineage boundary without compaction or journal mutation. Reference display facts are rendered before hashing; opaque resource locators remain excluded. Flower reads persisted Activity first and otherwise uses a neutral label and renderer without exposing arguments or unknown JSON.

## Provider rendering and estimation

Published Floret v7.26.0 owns `EstimateRenderedRequest` for local Responses, Chat Completions, Gemini signatures, Moonshot, and Anthropic. Each adapter freezes its final SDK-rendered input once, and estimation plus dispatch use those same bytes. Verified model mappings select official vocabularies; unknown models use an explicit multilingual BPE proxy. Image parts use model and dimension budgets, opaque files retain conservative budgets, and Desktop/platform transports omit runtime IDs, routing, and product tool metadata. DeepSeek uses the official V4 tokenizer with 10% text headroom and documented image budgets; calibration invalidates when history, execution surface, model, compaction lineage, or estimator changes. These remain estimates because server rendering can differ; Redeven adds no network preflight or calibration ledger.

## Temporary provider failures

Published Floret v7.42.0 owns one cancellable recovery budget for each frozen model request, including parent turns, SubAgent turns, compaction batches and titles. Defaults allow four extra sends (three for timeouts), jittered exponential delays and a five-minute recovery window. Server retry deadlines are captured at response receipt; long waits terminate without early redispatch. Authentication, exhausted quota, invalid contracts, unknown errors and tool effects remain terminal boundaries.

One upstream physical-request owner bounds connection establishment and stream
reading: five minutes to first semantic output, two minutes of output idle time,
five minutes during provider-hosted tool execution, and fifteen minutes total.
Zero configuration uses these defaults; negative limits fail startup before state
opens. Text, reasoning, argument fragments and valid tool-state transitions renew
progress. Heartbeats, empty deltas and usage do not. Returning from a hosted tool
restores the ordinary output limit. Local tools, approvals and user answers lie
outside a physical request. The same owner covers direct and prepared requests,
compaction and titles; Redeven only passes `ProviderRequestTimeoutPolicy`.

Timeout cancels only the physical attempt and enters the same frozen-request
recovery budget. Incomplete arguments never execute tools, confirmed tool results
remain checkpointed, and hosted tools without explicit replay safety prohibit
automatic retries. Exhaustion remains a typed Provider failure; user Stop remains
cancellation. Independent storage and unknown-effect errors retain priority.

Responses terminal events end reading immediately and enter one result-building
path; neither ordinary nor ChatGPT-native completion waits for EOF. Complete
items, final output fallback, native continuation checks, truncation and content
filtering retain their protocol semantics. Deferred cleanup closes the response
and releases the connection lease on success, failure or cancellation. HTTP,
WebSocket and Desktop transports propagate the upstream attempt context.

Redeven disables SDK retries, maps structured HTTP/SSE/WebSocket facts into `provider.RetryAdvice`, and preserves the original cause and sanitized diagnostics. A consumed prepared request can replay only its immutable rendered bytes; attachments and mutable tool lists are never resolved again. Each real send receives Floret's new AttemptID/Epoch and passes admission again. The failed attempt's known usage remains billable; missing usage stays unknown. Only explicitly read-only hosted search is marked replay safe.

Flower reads `ThreadRunProgress.Retry` from the authoritative current view. Main and companion surfaces display the absolute-deadline countdown and draft-replacement hint without admitting another turn. Stop stays available; manual retry appears only after terminal failure. No product retry loop, timer queue, or durable retry ledger exists.

# Boundaries

Redeven maps product model and permission state into Floret's typed surface. It does not persist provider envelopes, reconstruct canonical history, or infer execution authority from rendered Flower state. Usage accounting, compaction, and capacity errors belong to [Model context usage and compaction](model-context-usage-and-compaction.md).

# Evidence

- `redeven:internal/ai/floret_request_timeout_integration_test.go` - Heartbeat and incomplete-argument deadlines, typed failures, no dispatch, and released admission/HTTP resources.
- `redeven:internal/ai/model_gateway_terminal_deadline_test.go` - Terminal text, tools, truncation and content filtering release an open HTTP stream.
- `redeven:internal/ai/provider_failure.go` - Structured response-time retry advice and safe diagnostics.
- `redeven:internal/ai/floret_provider_prepared_test.go` - Single-use transports and frozen attachment replay.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.providerRetry.browser.test.tsx` - Countdown, draft replacement, reopen and Stop at desktop and narrow widths.

- `redeven:internal/ai/floret_runtime.go` - Hosted Agents receive the current prompt, tools, model, reasoning, and context policy.
- `redeven:internal/ai/prompt_builder.go` - Stable System Prompt construction.
- `redeven:internal/ai/floret_bootstrap.go` - Restart uses canonical Turn input and provider-safe state.
- `redeven:internal/ai/provider_state_reader_test.go` - Old and current native state validation and Desktop RPC round trips.
- `redeven:internal/ai/floret_approval_command_integration_test.go:118` - Invalid tool presentation remains canonical history without handler execution.
- `redeven:internal/ai/floret_tools.go:135` - Child tool calls validate parent execution identity.
- `redeven:internal/ai/subagents_floret.go:363` - Child hosts reuse the shared model gateway and Floret runtime.
- `redeven:internal/ai/send_user_turn.go:160` - Typed send freezes settings while Floret admits the Turn.
- `redeven:internal/ai/thread_model_switch_integration_test.go:23` - Model switching, restart, and render-prefix continuity.
- `redeven:internal/ai/model_gateway.go:3189` - Canonical tool-name aliases are collision checked.
- `redeven:internal/ai/model_gateway_result.go:36` - Final ToolCalls use one completeness validator.
