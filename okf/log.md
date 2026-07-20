# Redeven OKF Update Log

## 2026-07-20
* **Security**: Kept `subagents wait` inside the root lifecycle authority gate with a canonical descendant join scope because waiting may admit pending child input and start provider work; only read-only list and inspect release before dispatch.
* **Boundary**: Upgraded to published Floret v0.19.0, removed the Service-wide Floret capability aggregate, split lifecycle/read/runtime ownership, bound ordinary and child execution to exact authority, and isolated interrupted-turn recovery to startup-only exact factories.
* **Security**: Added the lifecycle-gated `EffectAuthorizationGate` with strict permission snapshot v2, delete-intent exclusion, final policy reread, exact lease identity, and one-shot dispatch proof.
* **Fix**: Bound pending terminal settlement to the exact Floret effect-attempt identity, released the product lifecycle gate at the one-shot handler-dispatch boundary, and made SubAgent publication/input retry identities deterministic from canonical authority.
* **Boundary**: Replaced root-capability copying with exact child execution objects, enforced exact root host/product capability allowlists, and expanded startup recovery binders into immutable exact factories before any retry owner is retained.
* **Fix**: Made followup replacement one strict transaction, added deterministic SubAgent publication replay with terminal failed state and payload clearing, recovered creates before target enumeration and forks before publications, and preserved observable non-retryable terminal outcomes after post-dispatch stdin failure.
* **Storage**: Initialized fresh thread stores directly at schema v3, retained only the existing product v2-to-v3 migration, and rejected product v1 and older canonical schemas without mutation.
* **Security**: Froze attachment bytes before admission, bound canonical resource references to content digests, verified historical resources on every projection, and restricted inherited SubAgent attachments to canonical full-path children.
* **Coordination**: Claimed both fork identities, processed every startup delete page before turn recovery, installed recovered SubAgent hosts before callbacks, and treated child `ParentRunID` as lineage rather than current parent-turn authority.
* **Security**: Replaced the approximate pre-handler dispatch signal with shared effect authority held through concrete handlers, kept lifecycle mutations exclusive, fenced direct PTY writes, and removed arbitrary-child binders from run-reachable SubAgent runtime objects.
* **Migration**: Moved complete v2 upload, permission, fork, and delete payload validation before any Floret title write, required exact legacy reference literals, and validated full permission owner and lifecycle metadata.

## 2026-07-19
* **Boundary**: Upgraded to published Floret v0.17.0, confined Store and `HostBootstrap` to one composition-root adapter, replaced the broad provider host with thread/parent-bound execution, compaction, SubAgent read, and maintenance capabilities, and removed active-to-recovery pending settlement fallback.

## 2026-07-18
* **Fix**: Serialized per-thread run/compaction admission with fork/delete intent, made operation and queued-command JSON strict, bound create/fork replay to durable identity and fingerprints, preserved damaged queued uploads before admission, and isolated concurrent tool authorization to each dispatch refresh snapshot.
* **Boundary**: Upgraded to published Floret v0.16.0, removed the alternate thread-start API, restricted canonical thread creation to the durable create coordinator, made missing journals and parent-scoped SubAgent access fail closed, and froze Redeven thread-scoped writes after delete or fork intent.
* **Dependency**: Upgraded to published Floret v0.12.0 for canonical thread overview, title mutation, structured attachments, and unified Thread/SubAgent detail events.
* **Breaking**: Advanced Redeven threadstore to schema v3 with `ai_thread_settings`; removed Redeven title ownership, admitted TurnID/RunID upload mappings, permission snapshot v1, and canonical v15-v40 migration support.
* **Boundary**: Made Floret the only authority for admitted messages and attachments, titles, lifecycle, projections, approvals, todos, context, provider state, and SubAgent hierarchy; Redeven retains only host settings, resources, unadmitted queue, routing/read state, security audit, and durable cross-store intent.
* **Refactor**: Added explicit create/fork/delete coordinators with canonical-first ordering and immutable host-owned snapshots, without persisting Floret results or rebuilding Agent state.
* **Fix**: Made current permission, queued command decoding, attachment resolution, title migration, and canonical reads fail closed with no stale snapshot, legacy alias, filename-text, role-name, or default-value fallback.
* **Breaking**: Removed `subagent_id`, spawn `title`/`objective` aliases, and task-name guessing; Flower and model-facing contracts use child `thread_id` plus required `task_name`.
* **Governance**: Added enforceable OKF authoring rules for coherent retrieval units, Summary/Contract/Boundaries/Evidence structure, size budgets, canonical ownership, and representative evidence.
* **Refactor**: Split the largest AI, Flower, Desktop, and Workbench concepts into focused retrieval units while retaining stable overview paths.
* **Update**: Advanced the OKF bundle to schema 3 and OKF version 0.2 with structured summaries, sections, Evidence, query-aware search snippets, and section-aware opening.
* **Quality**: Added report-only and strict content validation and wired strict OKF quality into the final integration gate.

## 2026-07-17
* **Breaking**: Upgraded to published Floret v0.11.3 as the only authority for admitted Agent conversation, turn/run lifecycle, ordering, projection, control signals, approvals, and todos; Redeven threadstore now contains product metadata, pending commands, resource references, read acknowledgement, authorization audit, and coordination records only.
* **Fix**: Rebuilt Flower history and replacement snapshots from Floret `ListThreadTurns` ordinal order, bound live drafts to exact thread/turn/run identity, and removed unmatched tail append and client-side message ordering behavior.
* **Breaking**: Removed realtime transcript, transcript-reset, and message-commit injection contracts; terminal replacement now comes only from canonical Floret turn pages, and committed user-entry events atomically retire matching pending command text.
* **Refactor**: Kept Floret fork rewrite maps ephemeral during product reference materialization and removed Redeven task-completion validity gating.
* **Breaking**: Adopted published Floret v0.11.3 with one Service-owned Store, Floret-owned opaque provider-state persistence, canonical context bootstrap through `ReadThreadContext`, strict typed gateway messages, and a product-only Redeven threadstore v2 that transactionally upgrades known pre-release schemas while rejecting unknown kinds and future versions.
* **Refactor**: Separated Redeven compaction request identity from Floret operation identity and removed synthetic terminal, identity repair, and commit-compensation paths.
* **Fix**: Documented stable Flower activity rows that gain late presentation payloads without remounting, and removed the obsolete generic Activity renderer path from the maintained UI contract.

## 2026-07-16
* **Refactor**: Made published Floret the single persistent source of truth for tool identity, lifecycle, results, errors, completion output, and Activity projection; removed Redeven tool-state mirrors and bound terminal finalization to the creating Host and explicit settlement target.
* **Update**: Documented model-authored terminal read activity titles, command-focused terminal details, Floret v0.8.0 polling identity exclusions, and removal of the terminal execution timeout alias.
* **Fix**: Documented Floret v0.7.0 running live projections so Flower tool activity is visible before turn completion.
* **Refactor**: Moved Floret projection, stream, activity, event, and availability validation ownership to Floret public validators while retaining only Redeven run identity association and Flower block mapping.

## 2026-07-15
* **Breaking**: Documented Flower live `turn_projection_unavailable` decorations and the strict timeline decoration union shared by bootstrap, history, and replacement snapshots.
* **Breaking**: Advanced Runtime Service compatibility epoch to 7 with matched Desktop and Runtime minimum versions at `v0.9.0`.
* **Update**: Documented published Floret title ownership and typed lifecycle-reason contracts.
* **Update**: Added persistent Flower thread deletion coordination, fixed replay order, restart recovery, and DELETE operation outcomes.
