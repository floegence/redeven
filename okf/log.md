# Redeven OKF Update Log

## 2026-09-08
* **DeepSeek Responses**: Flower consumes the published Floret gateway for full
  history requests, reasoning streams, validated tool calls, native web search,
  and inclusive usage accounting. Search follows the Agent tool surface; titles
  remain search-free and supplemental-context privacy remains unchanged.

## 2026-09-07
* **Visible npm Host installation output**: Managed npm install and lifecycle
  commands now emit informational logs and drain stdout and stderr before the
  process wait closes their pipes. Redacted bounded output therefore remains
  observable in live Managed Service operation progress, including final lines
  written immediately before command exit.

## 2026-09-05
* **Stable provisional Flower settings**: New-thread admission now keeps the
  effective permission, model, reasoning, and working directory with its
  short-lived transport entry. Typed current state can render those settings
  while canonical product detail is pending, without inheriting a changed
  environment default or treating presentation state as authorization.

## 2026-09-04
* **Current-template Managed Service Runtime**: Installed services now persist
  only template ID, instance configuration, selected application release,
  RuntimeBinding, workspace and resource state, and the digest of the Runtime
  actually applied. Every lifecycle, settings, recovery, and Open path resolves
  the current verified template through one typed boundary; presentation-only
  or revision-only edits preserve the Runtime digest, while executable changes
  become stale and rebuild through the ordinary explicit lifecycle. Open starts
  or joins one Restart for a stale digest or missing dynamic Host URL. The
  user-approved `portforward_registry_v2` version-1 pre-release baseline removes
  installed snapshots and duplicated projections, rejects every v1 shape
  read-only, and becomes the permanent migration lineage once distributed.

## 2026-09-03
* **Coherent Flower permission controls**: The shared preference-editability
  projection now disables permission mutation while a thread is active, queued,
  or waiting on an interaction, matching the canonical service guard. The
  permission menu retains its check and background selection without a left
  accent bar, and the obsolete active-turn update path and copy are removed.
* **Visible and stable Managed Service operations**: TemplateSpec v5 adds an
  explicit Host startup-output URL contract, while Redeven validates and stores
  the process-bound path outside Registry, logs, diagnostics, and audit. One
  Reporter now persists bounded redacted command output as operation-progress
  v2, including real npm install and rebuild output. The service-row disclosure
  stays under user control across list and SSE refreshes. The Desktop loopback
  gateway maps redirects under the current protected Forward back to the
  isolated application root, and Registry v5 migrates existing template and
  progress documents atomically.
* **Unified Flower turn admission**: Welcome and in-product launchers allocate
  one request ID per open intent and reuse it after an unresolved response.
  Desktop and Env App share one mutually exclusive HTTP request shape and one
  strict receipt classifier. Explicit rejection is the only send failure;
  disconnects and unusable success receipts preserve the original request for
  reconciliation, while the launcher owns the only inline presentation.
* **Stable Flower request identity**: Desktop existing-thread sends now carry
  the original top-level client request ID, and accepted receipts must echo the
  exact request and Thread identities. The core service rejects missing IDs;
  only the legacy RPC adapter allocates one before using that core path. This
  keeps accepted messages, composer settlement, and transport outbox
  reconciliation on one identity without false failure feedback or duplicates.
* **WAL-aware product database preflight**: Redeven's shared SQLite opener now
  validates existing Threadstore and Port Forward databases through the complete
  read-only main-plus-WAL view before writable migration. It no longer uses
  immutable mode, restores SHM bytes and temporary sidecar existence on
  rejection, and is the only production owner of direct SQLite connections.
* **Deterministic npm Host installation**: npm Host staging now owns one exact
  private application manifest and passes the same explicit prefix and hoisted
  layout to install and lifecycle rebuild. Package metadata and executable
  identity must verify both before and after third-party scripts run.
* **Compact Flower product storage**: Threadstore schema v6 now keeps exactly
  seven product tables and removes persisted provider capability, thread
  routing, delete tombstone, and unused audit/resource columns through one
  automatic migration. Capability and canonical target authority use current
  configuration only. Upload attempts and ordinary execution authority have a
  seven-day idempotency window, active recovery facts remain protected by
  Floret `ThreadView`, staging scopes delete immediately, and bounded
  maintenance schedules threshold-based incremental vacuum.
* **Recoverable Managed Service release picker**: Version browsing now keeps
  every close path available during source work, aborts one generation-scoped
  request on close or service switch, and ignores late results. OCI discovery
  pages at most 100 tags on demand near the list end, verifies at most 20
  visible items with four workers, consumes opaque cursors only after success,
  preserves partial and restart-restored candidates, tries anonymous access
  before bounded credential lookup, and reports distinct safe source failures.
  Registry v4 migrates release-check summaries to the digest-verified
  progressive schema v2.
* **Accurate Flower send feedback**: Successful Turn receipts now settle the
  request and bind its optimistic outbox row by exact request and Thread
  identity without requiring an immediate current view. Missing or unusable
  receipt detail recovers through the canonical thread load and live stream,
  so an accepted send is not reported as failed. Welcome-to-Flower handoff no
  longer adds a redundant success toast after navigation.
* **Dense Managed Service release browsing**: The version drawer now assigns
  all remaining body height to one compact, divided candidate list while its
  summary, filters, advisory hints, and footer remain fixed. The outer body no
  longer scrolls, update-plan review replaces release browsing, and real
  browser-wheel coverage verifies scrolling from candidate content and the
  list viewport in both directions at wide and narrow sizes.
* **Migration-only Flower storage**: Product threadstore schema v5 converts any
  retired queue input directly into Floret's canonical idempotent import path
  during the contiguous startup migration, persists restart authority, and
  removes the migration table before commit. Upload references now use their
  natural composite identity; the unused surrogate ID, redundant indexes, and
  residual SQLite sequence table are removed automatically while reference data
  is preserved.

## 2026-09-02
* **Advisory Managed Service version risks**: Version selection and update plans
  now show non-recommended, preview, deprecated, npm-script, downgrade,
  unknown-order, and moved-tag facts as compact read-only hints. Ephemeral update
  plan schema v2 exposes `risk_ids` for presentation and removes release-risk
  acknowledgement fields and checkbox gates; source verification, platform
  compatibility, and stopped-state requirements remain enforced by the Manager.
* **Usable Managed Service version drawer**: OCI release discovery now treats
  container-engine credentials as optional until the Registry actually requires
  authentication, so a broken or empty credential helper cannot block public
  anonymous metadata. The fixed-footer drawer and candidate list are explicit
  local wheel viewports, and stable release-source codes produce localized
  diagnostics instead of backend English text.
* **Resumed-Run startup migration**: Redeven now consumes Floret v7.1.2, whose
  v8-to-v9 migration follows canonical Run changes after interaction resumes
  within one Turn. Valid Agent data opens through the existing single runtime
  path; Redeven adds no schema inspection, repair, or fallback.
* **Recommended release and free version choice**: The external template catalog
  advances to v0.2.0 and defines its release only as Redeven's recommendation
  and no-choice default. ReleaseIdentity remains the installed authority;
  direct npm and OCI checks persist source summaries, and one expiring update
  plan composes an explicit candidate with the latest compatible TemplateSpec
  v4 revision. Registry v2 removes duplicate version columns and migrates v1
  atomically. The version drawer defaults an installed service to its current
  release, permits preview, deprecated, special, and older verified releases
  with explicit risks, and never silently returns it to recommendation.
* **Stable streamed SubAgent disclosures**: Child ledger groups and entries now
  reconcile only by canonical semantic keys, retain one activity owner while a
  single operation becomes a batch, and update content through accessors. Main
  and child timelines pass separate explicit viewport scopes, so opening a
  streamed child tool preserves its row, terminal output, disclosure motion,
  and child scroll anchor without changing parent scrolling. Removed the
  object-reference render paths, batch-only disclosure state, global anchor
  revision, parent-scroll fallback, and proximity capture that re-enabled child
  tail following after an explicit interaction.
* **Fork context identity**: Redeven now consumes Floret v7.1.2. Canonical
  context snapshots for direct and nested forks use the destination ThreadID,
  preserve historical Turn and Run identity plus cumulative usage, and remain
  stable after restart. Redeven keeps one public `ThreadContextReader` path and
  adds no downstream repair or compatibility read.
* **Complete SubAgent handoffs**: Wait and inspect now prove parent membership
  from bounded summaries, then read each completed child's exact current-Turn
  Assistant result from the canonical Floret View. Model results use one
  `handoffs` contract; previews remain status-only, Activity never copies report
  content, and the stale dual summary, local budget, and fallback fields are
  removed.
* **Stable SubAgent window presence**: Window visibility is now one
  boolean-equality projection of the active detail selection. Live current,
  summary, request, and error updates change content without restarting the
  floating-window enter transition; explicit close and parent navigation remain
  the only visibility mutations.
* **Stable live SubAgent detail**: The parent workspace stream now forwards
  every safely projected child `ThreadView` as `subagent_current`, independently
  from lifecycle-driven membership replacement. One stable floating-window
  selection orders HTTP and SSE by canonical parent-child identity and
  `view_version`, survives temporary inventory omission and initial failure,
  and refreshes once after reconnect. Fake pagination, detail timeline DTOs,
  polling, load-more state, syncing copy, pulse animation, and the flashing
  bottom status lane are removed.
* **Stable hosted effect authorization**: Redeven now consumes Floret v7.1.0
  and binds one defensive copy of correlation and permission-snapshot labels to
  every production Agent. Fresh runs, retries, Ask User continuations, and
  restored execution share the upstream provider-host injection point. The
  admitted snapshot ID is frozen once; provider admission and current-policy
  refresh no longer rebind or overwrite it. Two effects from one provider
  response therefore reach independent authorization checks and handlers while
  preserving provider result order. Missing or tightened authority still fails
  closed, and the fixed tool surface remains the only production path.
* **Generic Managed Service baseline**: Redeven now consumes the released
  `github.com/floegence/redeven-service-templates` v0.1.0 bundle and contains no
  built-in service identity, presentation asset, package, image, or specialized
  lifecycle branch. The user-approved pre-release reset establishes
  `portforward_registry_v1` version 1 with exact configuration, release,
  RuntimeBinding, resource, progress, and retry-lineage state. Generic Host,
  Container, and Compose drivers use one binding and capability contract;
  failures wait for explicit Start, Restart, Retry, release selection, or
  reconfigure preflight instead of executing automatic repair.

## 2026-09-01
* **Structured tool history and stable lineage**: Redeven now consumes Floret
  v7.0.5. Ask User resumes with one typed Assistant tool call and matching Tool
  result, supplemental requests checkpoint only redacted lineage facts, and
  provider-context v6 keeps unavailable-tool history valid across later Turns
  without restoring deleted definitions or compacting. A new context policy
  also starts without the previous model's latest usage while retaining the
  canonical whole-thread totals.
* **Required interactive control**: The Flower System Prompt now requires
  `ask_user` whenever another user answer is needed and forbids ending that
  Turn with a prose question. Natural stop remains valid when no answer is
  required.
* **Friendly Agent startup progress**: Redeven now consumes Floret v7.0.2 and
  forwards its real migration and verification phases. Startup shows neutral
  phase copy, real elapsed time after ten seconds, a calm long-history note
  after thirty seconds, sanitized details, and one non-blocking ready notice.
  Polling countdowns, guessed progress, and obsolete commit or rollback facts
  are removed from the readiness contract.
* **Transparent managed Host lifecycle**: Host template queries project the
  actual generic Runtime driver, safe package identity, and ordered install,
  start, stop, and uninstall plan without persisting or hashing that
  projection. User-authored Hooks remain authoritative fields and appear in the
  plan only through safe placeholders.
* **Host package download progress**: Audited host packages now publish their
  safe filename and digest, exact downloaded and total bytes, smoothed rate,
  and elapsed time through the existing persisted operation stream. Host
  install stages without byte-level telemetry keep elapsed time visible and do
  not invent transfer totals or expose source URL query data.
* **Floret v7 Turn surfaces and natural completion**: Redeven now consumes
  Floret v7.0.2. Each new Turn uses the current persisted settings, System
  Prompt, and tools; Ask User, tool loops, retries, and restart recovery reuse
  the immutable checkpointed surface. Natural provider stop completes the
  Turn, and removed historical tools use the neutral Activity presentation.
  The known legacy continuation-prompt repair crosses one explicit context
  projection boundary without compaction or stale continuation reuse.

## 2026-08-31
* **Stable Flower menus and title summaries**: Thread menus now keep only
  semantic ThreadID and trigger identity across summary refreshes and row
  replacement. Floret title events request one lifecycle-owned canonical
  summary publisher outside the event callback; publication failure fences the
  live stream so reconnect restores the authoritative title baseline.
* **Cross-Turn model switching and stable context**: Persisted thread settings are the only model authority for an
  existing thread; request model fields only validate the frozen choice. Idle
  Flash to Pro to Flash switches retain append-only canonical history and
  model-specific render prefixes without carrying provider continuation state
  across models or compacting small context.
* **Append-only Flower context**: Flower restores the original canonical Turn
  input after Ask User, appends mutable environment facts as per-turn
  supplemental context, and keeps one fixed model surface during an active
  Turn.
* **Ask User live continuation**: Floret publishes a clean `preparing` Run before
  provider dispatch and fences attempts per Run. Redeven forwards the resulting
  waiting-response, streaming reasoning, and assistant growth before terminal
  settlement without polling or UI-generated progress.

## 2026-08-30
* **Flower readiness admission**: Env App now mounts Flower only for `ready` or
  `degraded` AI readiness. Startup migration and recovery states issue no
  Flower business requests; losing readiness cleans up the live surface, while
  the Shell-owned composer coordinator preserves unsent drafts for one clean
  remount.
* **Floret fork migration adoption**: Redeven consumes the published
  Floret release that automatically removes verified terminal Effect Attempt
  history copied by legacy forks and prevents new forks from copying source-
  thread effect authority. Redeven keeps the Floret Store opaque and adds no
  SQL repair, downgrade, or migration fallback.
* **Terminal unknown-effect lifecycle and Floret v6.0.0 adoption**: Redeven now
  projects Floret's `effect_outcome_unknown` terminal failure through one shared
  summary, detail, and live-current lifecycle mapper. Flower explains that the
  task stopped to prevent duplicate operations, keeps the composer available,
  and removes the retired effect retry route, transport, protocol, and control.
* **Exact multi-turn Flower identity and bounded detail loading**: Redeven adopts
  Floret v5.0.16, requires each current item and interaction to carry its exact
  TurnID and RunID, and rejects malformed history before cache admission. One
  per-thread coordinator deduplicates cold selection, coalesces only the latest
  advancing revision, stops automatic retry after failure, preserves valid
  cached content, and gives uncached failures and empty conversations explicit
  states instead of leaving the transcript loading indefinitely.
* **Revision-only Flower read acknowledgements**: Redeven advances the read-state
  store to schema v4, retains only each user's last seen activity revision, and
  removes signature, prompt, and message-time validation. Flower sends each
  displayed revision once per selection cycle, coalesces concurrent updates to
  the newest revision, and does not automatically retry a failed acknowledgement.

## 2026-08-29
* **Exact Flower run progress and stable status animation**: Redeven adopts
  Floret v5.0.15 as the sole owner of active RunID and process-local run phase.
  Flower removes its model-I/O stream, message-derived lifecycle, and timeline
  wait placeholder; one fixed indicator above the composer keeps the same DOM
  nodes throughout a run. The collapsed Bottom Bar keeps only the left
  thread-switcher Flower glyph, while the status button retains its marker,
  text, target-thread action, and accessible name.
* **Subagent admission latency and parent-only presentation**: Floret v5.0.14
  supplies segmented domain persistence and canonical task-name titles.
  Redeven removes post-admission child reads and title writes, treats wait
  timeout as a normal result, routes child current views to one parent-scoped
  inventory replacement, keeps children out of the root rail, and opens their
  detail only in the existing floating window.
* **Typed SubAgent operation Activity and Floret v5.0.14 adoption**: Redeven now
  preserves each SubAgent action, ordered target list, completion and missing
  counts, and timeout state through Floret Activity and Flower bootstrap/live
  projection. Flower uses one localized action-and-outcome title formatter,
  exact `ThreadID` joins, and a first-two-plus-count collapsed summary. Manual
  detail disclosure pauses
  transcript tail following, anchors the clicked title through measured-height
  animation, and removes the obsolete auto-open, settle, and intrinsic-height
  paths.

## 2026-08-28
* **Live Flower cache totals and Floret v5.0.12 adoption**: Committed final
  provider usage now supplies canonical cumulative thread totals in the live
  context frame. Redeven uses the same strict converter for live events and
  detail snapshots; Flower replaces confirmed totals and preserves them only
  across projected-request frames that omit totals, with no polling or local
  accumulation.
* **Typed file Activity and Floret v5.0.11 adoption**: File mutation rows now
  show aggregate added and deleted line counts and expand to the canonical
  unified diff. Protocol chips and payload action IDs are removed, while old
  rows without typed mutation evidence remain concise and non-expandable.
* **Acknowledgement-only Flower Stop**: Flower now treats Stop as one
  idempotent command shared by Composer and the thread menu. The response is
  only `{ok:true}`; canonical workspace SSE supplies subsequent thread state,
  and transport failures remain diagnostic and immediately retryable without a
  false user-facing Stop error.
* **Running tool title sweep**: Flower gives every running Activity tool title a
  theme-aware left-to-right sweep with a short end pause. The effect never
  covers the icon, metadata, duration, detail, or row background, stops on
  settlement, and is absent in reduced-motion and forced-colors modes.
* **Single Web Fetch status indicator**: Flower uses the `thinking-orbs`
  Searching style while Web Fetch is running and after success, with animation
  stopped for the completed state. Failed fetches use the shared error alert.
  The indicator pauses offscreen, respects reduced motion, and never appears
  beside a second title or status icon.
* **Floret v5.0.10 adoption**: Floret no longer discovers, requests, or emits
  page icons, and Redeven drops the deprecated icon field at its public Activity
  boundary.

## 2026-08-27
* **Readable Web Fetch Activity and Floret v5.0.9 adoption**: Flower now shows
  the requested URL in the collapsed title, then lazily renders response
  metadata and Floret's bounded content preview when expanded.
  Old records fall back to `target_refs` and no longer expose an empty panel.
* **Floret v5.0.8 provider-usage convergence**: Adopted the published fix that
  projects final provider usage through the attempt-scoped event envelope into
  canonical thread totals. This protected canonical accounting and existing
  snapshots; live first-turn publication was added later in v5.0.12.
* **Floret-native web fetch and v5.0.7 adoption**: Flower now exposes one shared
  readonly `web_fetch` in every permission mode. Floret owns secure fetching,
  parsing, output policy, and typed Activity; Redeven keeps current product
  authorization, prompt routing, and UI presentation.
* **Typed Flower turn failures and Floret v5.0.6 adoption**: Redeven now
  classifies canonical terminal failures from Floret's typed failure code across
  list, detail, current, and live responses. Engine-contract and storage
  details remain internal, while historical entries without the typed field
  retain one bounded legacy classification path.
* **Flower conversation cache metrics**: Adopted published Floret v5.0.5,
  normalized provider cache-read and cache-write usage across local and Desktop
  model sources, and added canonical whole-thread cache hit rate to the context
  tooltip without changing the context-pressure ring or adding client-side
  accumulation.
* **Flower compaction qualification**: Added an isolated real-provider test for
  `deepseek-v4-flash` that requires both manual and pre-request automatic
  compaction to commit canonical checkpoints, reduce estimated tokens, and
  preserve an older marker. Floret context policy now derives default output
  headroom from the resolved model capability while leaving the provider's
  unset output request behavior unchanged.
* **Floret v5.0.4 startup convergence**: Redeven now reports storage
  verification before `runtime.Open`, consumes Floret's exact legacy UTF-8 Raw
  repair, and classifies remaining authority failures only through the public
  runtime error contract. Startup diagnostics retain phase and class without
  backend or conversation detail.

## 2026-08-26
* **Terminal UTF-8 boundary and Floret v5.0.3 adoption**: Redeven now keeps
  terminal byte accounting inside the PTY owner but normalizes invalid UTF-8 at
  the single text projection boundary. Published Floret v5.0.3 consumes the
  committed Effect entry as the canonical result without replaying a duplicate
  payload comparison.
* **Authority failure presentation**: Canonical consistency failures retain
  their historical facts and fail closed, while server-side classification and
  localized Flower copy hide internal storage wording and state explicitly that
  an Effect was not rerun.

## 2026-08-25
* **Flower New Chat admission handoff**: Canonical request-key confirmation now
  settles the submitted draft, caches the real thread, transfers a still-current
  New Chat selection, and removes the optimistic outbox row in one UI batch.
  Live-current and send-receipt reordering can no longer flash the New Chat
  empty state, while later user navigation remains authoritative.

* **Desktop model-source ToolCall integrity**: Desktop RPC now preserves
  explicit empty argument objects and reuses one fail-closed validator for
  final ToolCalls across provider completion, RPC transport, and Floret mapping.

* **Storage**: Adopted published Floret v5.0.2, added one bounded pre-open SQLite maintenance call with explicit readiness and sanitized space diagnostics, and retained runtime open as the final store validation authority.
* **Performance**: Replaced per-thread full runtime views with one summary-only list projection, kept detail loading selected-thread-only, and hid the empty-list state until the first authoritative list response.
* **Refactor**: Removed the independent Workbench Flower runtime tree; Activity and Workbench now place one retained EnvAIPage, adapter, cache, list bootstrap, and live stream into explicit hosts.

## 2026-08-24
* **Floret v5.0.1 adoption**: Redeven now consumes the published Floret
  v5.0.1 module with exact checksums and no local replacement or workspace
  wiring. Current runtime and Flower contracts remain unchanged.

## 2026-08-23
* **Flower outbox admission convergence**: Flower now confirms transport input
  by canonical request key independently of runtime detail-version acceptance.
  New-thread live-current races atomically replace the optimistic row, while
  equal text with different stable request identities remains distinct.

* **Floret v5 terminal presentation and setting revisions**: Redeven now
  consumes published Floret v5.0.0. Canonical tool results preserve call
  descriptions and commands. Flower localizes every terminal tool title,
  suppresses empty terminal detail, and merges runtime `view_version` with the
  independent product `settings_revision`. Permission changes use one PATCH
  receipt and apply to later operations in an active turn without a second GET.

* **Authoritative Stop and Floret v4.0.19 adoption**: Redeven now consumes the
  published Floret v4.0.19 module. User Stop commits one terminal aborted turn,
  seals late execution and effect-retry work, and immediately reopens the
  thread for input. Flower keeps Stop available from summary, detail, or local
  request evidence, deduplicates active-turn admission notices, and uses one
  capsule component for row and batch approvals.

* **Typed tool activity presentation and Floret v4.0.18 adoption**: Redeven now
  consumes the published Floret v4.0.18 module. OKF tools publish bounded safe
  structured rows, while successful Skill activity stays static unless it has
  a real error detail. Flower no longer invents expand content from raw tool
  payload fields.

* **Flower terminal detail convergence**: Flower now orders every HTTP and live
  detail through Floret `view_version`, uses SSE epochs only to fence old
  callbacks, and revalidates a selected summary with one bounded recovery path.
  Lost terminal frames no longer leave stale thinking visible or require a
  thread switch; failed recovery preserves the transcript and offers retry.

## 2026-08-22
* **Supplemental context, atomic stop, and Floret v4.0.17 adoption**: Redeven now
  consumes the published Floret v4.0.17 module. Flower passes turn-scoped file
  context through Floret, consumes atomic cancel detail, and keeps private
  supplemental metadata out of public queue views.

## 2026-08-22
* **Canonical refresh race and Floret v4.0.16 adoption**: Redeven now
  consumes the published Floret v4.0.16 module. Floret rejects a canonical
  snapshot read before a newer terminal view, while Flower continues to
  deduplicate only identical stable IDs and preserves equal text carried by
  different IDs.

## 2026-08-22
* **Canonical Flower replies and Floret v4.0.14 adoption**: Redeven now
  consumes the published Floret v4.0.14 module. Terminal current views come
  from canonical ordered items instead of appending run-level output; Flower
  continues to deduplicate only identical stable IDs and preserves equal text
  carried by different IDs.

## 2026-08-18
* **Flower runtime integrity and Floret v4.0.13 adoption**: Every existing-thread
  mutation now proves endpoint ownership before canonical state can change.
  Restart recovery uses the submitting turn's minimal host authorization facts,
  live-stream overflow forces baseline resynchronization instead of silently
  dropping authority, reconnect baselines paginate the complete workspace,
  retry and SubAgent turns retain the submitting user's restart authority, and
  the transport outbox persists before send while expiring or settling
  unrecoverable attachment launches. Redeven consumes published Floret v4.0.13 for atomic
  domain migration, canonical-first queue and interaction acceptance, one-shot
  effect retry claims, subtree deletion fencing, and monotonic typed views.

## 2026-08-17
* **Official install review continuity**: Upgraded the coordinated ReDevPlugin
  v3.0.0 release manifest so Host release inspection exposes permission ids,
  required status, verified methods, and stable effects. Plugin Center now
  acknowledges install immediately, shares an exact-release inspection between
  selected-detail prefetch and explicit install, opens only a complete review,
  and keeps failure and cancellation retryable without inventing catalog
  permission metadata.
* **ReDevPlugin v2.0.9 release-manifest readback**: Upgraded the coordinated Go,
  npm, and Rust source release manifest after public registry and provenance
  verification. The Host now preserves the required `bytes_read` field for a
  successful zero-byte EOF result, so the stable WASM filesystem API completes
  full reads without weakening result validation. Redeven continues to use the
  released Host, runtime, sandbox surface, and worker SDK through one published
  release manifest with no sibling-source fallback.

## 2026-08-16
* **ReDevPlugin release-manifest readback**: Upgraded the complete published
  ReDevPlugin v2.0.7 Go, npm, and Rust source release manifest. The Host preserves
  the verified manifest model across durable JSON round trips and strictly
  recovers affected v2.0.3 rows from immutable installed manifest evidence. It
  also validates an environment invocation's session audience separately from
  its environment-only resource scope, retaining the authenticated user hash in
  the signed lease without adding that hash to resource ownership.
  Redeven retains one EnvAppShell-owned Plugin Panel state and no inventory or
  credential fallback state machine. Linux smoke resolves frozen v3.0.0
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
