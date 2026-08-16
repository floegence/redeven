# Redeven OKF Update Log

## 2026-08-16
* **ReDevPlugin package-set readback**: Upgraded the complete published
  ReDevPlugin v2.0.7 Go, npm, and Rust source package set. The Host preserves
  the verified manifest model across durable JSON round trips and strictly
  recovers affected v2.0.3 rows from immutable installed manifest evidence. It
  also validates an environment invocation's session audience separately from
  its environment-only resource scope, retaining the authenticated user hash in
  the signed lease without adding that hash to resource ownership.
  Redeven retains one EnvAppShell-owned Plugin Panel state and no inventory or
  credential fallback state machine. Linux smoke resolves frozen v1.1.4
  fixtures from the exact published Go module instead of a machine-specific
  module-cache path.

## 2026-08-15
* **Canonical provider tool names**: Tool definitions, Floret history, current
  views, and Flower use dotted canonical names such as `terminal.read`.
  OpenAI-compatible transports use a single collision-detecting bidirectional
  alias table only at the wire boundary, while Anthropic receives dotted names
  directly. Published Floret v4.0.3 keeps schema-invalid calls inside provider
  correction and out of canonical and user-visible tool timelines.

## 2026-08-12
* **Control error presentation**: Upgraded to published Floret v3.2.40 so a
  malformed provider control signal retains its assistant prefix, control-call
  identity, waiting disposition, diagnostic, and canonical activity while
  exposing typed `control_error`. Redeven maps that code without parsing error
  text, and Flower keeps it scoped to the control activity instead of showing a
  message failure or global run-error card.
* **Approval action surface**: Batch reject, reject, and allow once now share
  one approval action row and one 32-pixel pill geometry. Narrow surfaces use a
  stable two-row order, and keyboard focus uses a shape-preserving inset rather
  than an external rectangular ring.

## 2026-08-11
* **Approval rejection recovery**: Upgraded to published Floret v3.2.39 for
  monotonic canonical projection ordinals and terminal approval precedence.
  Approval receipts no longer wait for provider continuation. Flower exits the
  interactive approval surface on the first frame, keeps the composer and Stop
  usable, and restores a decision only when canonical reload proves it is still
  requested. Stale requested projections cannot revive a cleared queue or
  regress a declined activity; waiting-user bootstrap settles stale assistant
  streaming state and clears its active cursor.

## 2026-08-04
* **Approval rejection continuation**: Adopted published Floret v3.2.27 so a
  user rejection settles as `rejected/user_rejected`, skips the authorization
  gate and handler, and returns an error tool result to the provider for normal
  same-turn continuation. Redeven no longer misclassifies host authorization or
  rejected-tool text as invalid Provider credentials.
* **Renewed approval cancellation**: Adopted published Floret v3.2.27 so
  stopping a turn while its effect waits for approval uses the current renewed
  lease authority, atomically cancels the approval batch, and leaves the
  canonical turn canceled and its admission replayable. Flower no longer has
  to recover this normal stop path as an interrupted failure after restart.
* **Durable delegated approval presentation**: Adopted published Floret v3.2.25
  so new canonical approval entries retain detached tool-authored presentation
  and earlier v3 journals recover it from the matching durable tool call after
  restart. Presentation remains outside approval identity, Redeven still uses
  the root queue as the only decision authority, and Floret schema v4 is
  unchanged.
* **Approval presentation continuity**: Adopted published Floret v3.2.24 so
  execution events and committed approval details share one Host-owned live
  projection recorder. Approval lifecycle details advance the existing tool
  item without replacing its command label, terminal renderer, description, or
  payload; exact thread, turn, run, and tool identity prevents cross-turn reuse.
  Flower omits separate approval-status transcript content; only approval-only
  history uses the neutral upstream fallback.
* **Idle companion summary backoff**: The visible companion still refreshes
  active work every 1.8 seconds, but idle full-inventory reads back off through
  5, 15, and 30 seconds. Hidden and disposed surfaces clear their timer, polls
  never overlap, and visibility restoration probes immediately.
* **Bootstrap execution continuity**: Adopted published Floret v3.2.24 so the
  atomic `ThreadReader.Bootstrap` path shares the process-local execution
  registry with ordinary reads. An admitted or executing turn stays `running`
  during live bootstrap, while restart without that proof remains a
  recoverable interruption.
* **Admission projection continuity**: Adopted published Floret v3.2.24 so a
  newly admitted turn remains `running` between its durable lease commit and
  exact process-local execution registration. Redeven's live reducer also
  rejects an older same-run thread summary after a newer run lifecycle event,
  while still applying unrelated summary fields.
* **Running lease projection continuity**: Adopted published Floret v3.2.24 so
  canonical thread reads preserve `running` across the durable-renewal and
  process-registry update interval. A new active run clears an older
  interrupted product error, while restart, expiry, replacement, and recovery
  claims retain fail-closed interruption semantics.
* **Validated Floret domain reads**: Adopted published Floret v3.2.24. Every
  complete-domain view still reads the exact durable envelope inside its
  backend transaction, while byte-identical validated state reuses the decoded
  projection. External changes, corruption, drift, and future versions retain
  strict decoding and fail-closed behavior without a Redeven-owned cache or
  schema change.
* **Canceled approval startup compatibility**: Adopted published Floret v3.2.24
  so an interrupted batch with a canceled tool result closes its requested
  approval before any run-end marker exists. Canonical startup inventory and
  latest-turn projection remain readable without rewriting the Floret Store or
  changing its schema v4 lineage.
* **Startup**: Reused the single published Floret `runtime.Open` Host for the
  complete AI service generation instead of opening and closing a disposable
  probe Host before the real startup, preserving upstream migration and
  fail-closed verification while removing duplicate cold-start work.

## 2026-08-03
* **Engine failure classification**: Adopted published Floret v3.2.13 so every
  failed result carries an explicit origin and AgentHarness preserves the
  original control-signal or validation failure instead of replacing it with a
  secondary failure-classification contract error.
* **Bootstrap deletion compatibility**: Adopted published Floret v3.2.13 so the
  single-snapshot path preserves `ErrThreadDeleted` for tombstoned identities
  without weakening absent-identity failure handling.
* **Single-snapshot Flower bootstrap**: Adopted published Floret v3.2.13 so one
  task open projects all canonical bootstrap surfaces from one backend snapshot
  and exact revision, preserving subscription handoff without a Redeven cache.
* **Invalid tool presentation**: Adopted published Floret v3.2.13 so parseable schema-invalid calls retain sanitized host presentation while remaining rejected before resource, permission, approval, effect, and handler execution.
* **Approval reconciliation**: Made canonical terminal run/tool Activity suppress stale in-memory approval controls during bootstrap and filter later stale queue replacements without resolving or mutating Floret authority.
* **Batch thread navigation**: Adopted published Floret v3.2.13 so thread-list refresh reads canonical root snapshots and latest turns from bounded inventory pages, preserves product ordering, rejects missing roots, and performs zero per-thread bootstrap or complete-domain reads.
* **Migration and inventory**: Adopted published Floret v3.2.13 so startup automatically migrates released domain schema v2 through v3 to current v4, atomically commits the strict derived root inventory, verifies current agreement before Host availability, and serves each root list without decoding the complete session-tree domain while Redeven remains outside upstream storage internals.
* **Recovery**: Adopted Floret's failed-approval timeline closure so supported historical requested approvals no longer make canonical Flower threads unloadable.
* **Batch recovery discovery**: Adopted Floret's read-only
  `Threads.ListInterruptedTurnRecoveryCandidates` scan so startup discovers
  root and direct-parent interrupted leases in one canonical read, then binds
  only the returned exact recovery proofs without per-root SubAgent inventory
  reads or forbidden root authority.

## 2026-08-02
* **Approval authority**: Adopted published Floret v3.2.3 so approval-gated effects, provider continuation, and terminal turn writes retain one renewable lease lineage across heartbeats while identity and acquisition drift remain fail closed.
* **Store compatibility**: Adopted published Floret v3.2.2 so supported historical interrupted approvals project to coherent terminal state automatically without a Store schema change, journal rewrite, or Redeven-owned migration.
* **Reliability**: Adopted published Floret v3.2.1 so approval resolution can proceed while a turn is active, and made the run idle watchdog honor the canonical approval queue without inventing a second approval lifecycle.
* **Dependency**: Upgraded Redeven to published Floret v3.2.0 with exact checksums and removed every remaining use of the deleted broad runtime methods from production and test integration.
* **Boundary**: Bound direct-child recovery through the parent `ThreadReader.Child` capability so child authority cannot be opened from the transient broad thread handle.
* **Quality**: Tightened the Containers operation observation summary to satisfy the strict OKF retrieval-size contract without weakening operation or release-trust boundaries.

## 2026-08-01
* **Dependency**: Upgraded Redeven to published Floret v3.1.1 with exact checksums and adopted native narrow capability views, atomic thread bootstrap, authoritative projection reads, receipt-only execution, Floret-owned todo invariants, and valid partial live tool projections.
* **Boundary**: Made `TurnAdmissionReceipt` the only live turn admission bind boundary before execution; committed-user events remain observation and presentation input only.
* **Boundary**: Removed deprecated broad Floret production calls and Redeven's duplicate canonical todo validator while retaining product authorization, coordination, and interaction guidance.

## 2026-07-31
* **Boundary**: Added an exact owner/consumer manifest for every threadstore schema object and all 238 production SQL calls, with explicit dynamic-query exceptions and receipt lookup restrictions.
* **Architecture**: Inventoried every Floret/Redeven cross-store mutation and formally classified v3.0.2 observation-based turn admission as requiring a product-neutral two-stage Floret acknowledgement.
* **Storage**: Removed unused terminal outcome fields from turn admission receipts so product coordination evidence cannot grow into lifecycle shadow state.
* **Dependency**: Upgraded Redeven to published Floret v3.0.2 and adopted its command/result, canonical identity, exact-read recovery, pending settlement, Todo, approval, reference, attachment, and SubAgent contracts.
* **Storage**: Established `ai_threadstore_product_v1` version 1 as the one-time pre-launch baseline, removed all discarded product migrations and legacy readers, and required read-only complete-schema rejection before any writable open.
* **Boundary**: Made Floret the sole allocator of ThreadID, TurnID, and RunID; Redeven now carries only stable client request and queue identities before canonical create, fork, or turn admission.
* **Recovery**: Added durable create, fork, and admission receipts with exact replay validation, atomic product binding, and committed-receipt exact-read recovery without reconstructing Agent lifecycle.
* **Fix**: Deferred pending terminal settlement until the exact turn authority barrier is released, preventing tool-callback mutation re-entry while preserving one canonical recovery settlement and timeline replacement.

## 2026-07-29
* **Dependency**: Upgraded Redeven to published Floret v2.2.0 with exact checksums, one composition-root `runtime.Host`, immutable `runtime.Agent` values, and identity-bound public handles.
* **Boundary**: Removed the v1 Store, binder, factory, and host-option integration path; explicit v2 storage migration and public runtime contracts now preserve Floret as the only admitted Agent authority.
* **Dependency**: Upgraded to published Floret v1.0.0 with exact module checksums and adopted its scoped validated turn, compaction, and SubAgent Host constructors.
* **Boundary**: Kept Redeven execution on narrow caller-owned capabilities, consumed typed Floret title and provider contracts, and preserved threadstore schema v8 plus the existing Runtime Service and Flower wire shapes.
* **Fix**: Restored first-message admission by resolving the atomic create operation and immutable command before canonical reads, reusing frozen identities across retries and restarts, and permitting exact `ReadThreadTurn` verification only after canonical root commit.

## 2026-07-28
* **Boundary**: Replaced dynamic threadstore schema expectations with a checked-in v2-through-v8 manifest covering complete SQLite object SQL, columns, indexes, triggers, CHECK clauses, and UNIQUE clauses, verified against fresh, historical, and migrated databases.
* **Boundary**: Added a repository-wide durable sink closed set for Go, SQL, TypeScript, TSX, Desktop, JSON/file, and browser persistence, with exact source digests and reviewed owner, authority, table, key, codec, and DTO metadata.

## 2026-07-27
* **Breaking**: Removed persistent Flower composer drafts, leases, conflict/takeover recovery, and cross-connection hydration; Activity, Workbench, floating drawers, and remounts now share only one connection-local in-memory coordinator.
* **Storage**: Advanced threadstore to schema v8 with capability-hash upload staging scopes, isolated legacy-draft migration, and atomic new-thread settings/create intent/immutable first-command/staging-claim freeze.
* **Fix**: Unified new and existing conversation sends on the strict thread-turn endpoint, converted malformed or empty transport responses into typed uncertain admission, placed Attach immediately before More, and autosized the composer through five visual lines.
* **Feature**: Added working-directory file and directory references through the full Flower composer's whitespace-boundary `@` interaction, with bounded deterministic discovery, keyboard and IME behavior, separate draft chips, and the attachment control fixed immediately before More.
* **Boundary**: Added the strict `flower_composer` context-action source, rejected client-authored labels and unknown fields, and kept paths as non-authorizing metadata while Floret remains the sole canonical source after admission.
* **Storage**: Advanced threadstore to schema v7, atomically upgraded verified v6 draft JSON with an explicit empty reference array, and bound ordered references plus the exact normalized context-action projection to the existing lease/revision admission transaction so changed path, order, directory kind, source, or JSON fails without draft, queue, upload-claim, or Floret side effects.

## 2026-07-26
* **Dependency**: Upgraded to published Floret v0.31.2 and adopted exact canonical `ReadThreadTurn` authority for known-Turn reconciliation, attachment membership, and reference activation.
* **Boundary**: Kept history, SubAgent transcript, and unknown-Turn attachment scans on canonical `ListThreadTurns`, rejected list fallback and non-not-found error downgrades, and exhausted pending commands through stable product keyset pages before startup, fork, or delete authority proceeds.
* **Dependency**: Upgraded to published Floret v0.30.0 with exact public checksums and opaque turn cursors.
* **Boundary**: Made typed Floret turn projections the only SubAgent transcript authority, hiding delegated missions only through `UserMessageOrigin` plus exact `UserEntryID` and removing browser metadata parsing and synthetic message identities.
* **Recovery**: Made Floret `ThreadInventoryHost` the startup root inventory authority while retaining paged Redeven settings solely for product configuration reconciliation.

## 2026-07-25
* **CI**: Canonicalized package-manager symlinks while keeping the Desktop Electron preflight bound to the in-repository package root, exact version pin, and standard npm binary path.
* **Dependency**: Upgraded to published Floret v0.30.0 and replaced Redeven's duplicate Store maintenance state machine with the standard `StartSQLiteStore` entrypoint while retaining product readiness and typed failure projection.
* **Architecture**: Isolated AI startup behind a process-local readiness controller with typed unavailability, request-scoped generation leases, serialized retry, and drain-before-close replacement while keeping unrelated Code App surfaces available.
* **UI**: Added a Flower-local AI maintenance surface and owner-grouped Settings diagnostics with fail-closed typed mapping, bounded recovery, same-source sanitized clipboard output, focus restoration, responsive accessibility, and explicit localization.
* **Dependency**: Upgraded to published Floret v0.27.1 and adopted its inspection-bound open contract with typed, fail-closed Store startup orchestration and published-version restart fixtures.

## 2026-07-24
* **Dependency**: Upgraded to published Floret v0.26.0 and aligned dependency contracts, notices, compatibility review, and current-state OKF ownership before adopting the public Store maintenance workflow.
* **Feature**: Added Flower file attachments and lossless automatic attachment staging for composer text above 50,000 Unicode code points.
* **Security**: Bound provisional and committed draft claims to authenticated user scopes, required audience-specific download context and public Floret membership for canonical reads, and enforced transactional quotas plus digest verification.
* **Storage**: Advanced threadstore to schema v6 with revisioned composer drafts, 30-day inactive-draft expiry, exact TurnID admission reconciliation, and last-reference cleanup that preserves bytes shared by other drafts, queues, threads, or forks.
* **Boundary**: Integrated the canonical text statistics and prepared attachment request lifecycle from published Floret v0.26.0.
* **UI**: Unified Activity, Workbench, Desktop, and mobile attachment drafts through revisioned leases, offline intent replay, upload progress, retry, cancellation, removal, preview, reference copy, and long-text restore.
* **Feature**: Added Flower conversation deletion to Env App and Desktop through one confirmed destructive menu action, durable receipt handling, and a non-persistent stale-response retirement fence.
* **Fix**: Serialized every delete replay through the thread lifecycle gate, treated missing Floret authority as terminal, excluded durable intent from product reads, and made failed delete integrity block every startup.
* **Dependency**: Upgraded to published Floret v0.24.0 after removal of its obsolete single-thread deletion primitive.

## 2026-07-20
* **Dependency**: Upgraded to published Floret v0.19.1 so a complete canonical user entry is publicly readable before its admission event and every provider, assistant, or tool event follows that boundary.
* **Fix**: Made `kind=start` wait for canonical admission and `timeline.replaced`, removed Flower synthetic pending user messages, and projected Redeven-owned unadmitted commands only as server-rebuildable `queued_turn` entries keyed by exact TurnID.
* **Fix**: Kept canonical image and file attachment blocks visible under atomic message decoding, and required live activity blocks to match their enclosing thread, turn, and run before presentation.
* **Fix**: Made canonical timeline arrays atomic, bound browser live drafts and SubAgent lineage to exact thread/turn/run/message authority, preserved owned empty queued-turn detail, and added real HTTP/RPC zero-side-effect rejection coverage.
* **Fix**: Classified Flower admission outcomes at typed transport boundaries, restored drafts only for explicit server rejection, kept response-loss or malformed-receipt attempts bound to an exact reconciliation identity, and required live block events plus canonical raw blocks to satisfy strict message identity and whole-message validation.
* **Fix**: Bound Flower admission uncertainty, pending reconciliation, canonical rows, and live assistant drafts to explicit thread/turn/message identities so lost receipts and stale queue snapshots cannot produce duplicate sends or duplicate user rows.
* **Fix**: Separated Flower turn admission receipts from canonical refresh, carried TurnID beside canonical message-row identity through bootstrap, history, and replacement events, and reconciled optimistic or queued rows only by exact thread and TurnID without a persisted correlation map.
* **Fix**: Migrated the one known reordered Code App registry v1 shape to strict schema v2 transactionally, preserving codespace metadata while rejecting unknown shapes without mutation.
* **Coordination**: Moved queued admission reconciliation into startup recovery, atomically released exact unadmitted `in_flight` command/turn/run identities before runtime reopened, and delayed every queued-thread wake until all recovery checks succeeded.
* **Security**: Kept `subagents wait` inside the root lifecycle authority gate with only its normalized exact requested-child join scopes because waiting may admit pending child input and start provider work; unrelated siblings remain fenced and only read-only list and inspect release before dispatch.
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
