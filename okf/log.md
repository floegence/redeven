# Redeven OKF Update Log

## 2026-07-18
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
