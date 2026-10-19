# Redeven OKF Update Log

## 2026-10-18 — Subagent status and result boundaries

- Adopt published Floret v7.64.0, add bounded metadata-only status checks, guide selective event/result reads, and preserve historical capsule outcomes with action-first localized Activity titles. See [runtime](ai/subagent-runtime.md) and [presentation](ui/flower-subagent-detail.md).

## 2026-10-18 — Preserve public Goal review facts

- Retain the published typed [Goal activity](ai/flower-goals.md) through the shared public filter for current detail, history and live blocks. Preserve full objectives and evidence, reject invalid display facts and keep waiting interactions independent from review outcomes.

## 2026-10-18 — Recent-first thread queries

- Default [thread queries](ai/flower-thread-queries.md) to descending chronological order using the existing sort fields. Preserve explicit ascending order, aggregation defaults, canonical validation and cursor continuation without adding sort keys or presets.

## 2026-10-18 — Readable Goal review activity

- Adopt released Floret v7.63.1 typed invocation snapshots and historical review recovery. Show quiet, borderless Goal checks with original text and confirmed evidence, hide generic tool filler and duration, and preserve canonical completion and waiting interactions.

## 2026-10-18 — Explicit thread query sorting

- Enumerate [thread query sort keys](ai/flower-thread-queries.md), distinguish aggregation ordering, and describe defaults and newest-message queries. Map invalid inputs to actionable parameter errors while preserving Floret validation, authorization, cursor and runtime failure boundaries. Verify correction before dispatch and visible Activity filtering.

## 2026-10-18 — Minimal computer preview placeholders

- Center three quiet dots and one short localized status in the [computer viewer](ui/flower-computer-viewer.md). Pulse only during active loading, keep empty and assistance states static, and preserve explicit recovery, reduced motion and high-contrast presentation.

## 2026-10-18 — Scoped child interactions after forks

- Keep [subagent ownership](ai/subagent-runtime.md) with the original parent, return non-mutating stale-target recovery, refresh current-thread facts, and suppress unowned historical navigation. Verify independent roots, forks, restart, provider continuation, and valid child controls.

## 2026-10-18 — Goal history without source labels

- Keep expanded [Goal history](ai/flower-goals.md) focused on the original objective. Remove user and model source labels from the presentation while preserving canonical actor metadata.

## 2026-10-18 — Borderless Goal surfaces

- Use a softly tinted rounded-rectangle [Goal badge](ai/flower-goals.md), a borderless elevated editor and inline history expansion. Preserve individual keyboard focus, full Goal text and existing edit and execution contracts.

## 2026-10-18 — Compact Goal presentation

- Share a target-and-arrow icon across the composer badge, popup and expandable [Goal history](ai/flower-goals.md). Present one concise action and Goal preview, preserve the full original on expansion, and coalesce unambiguous successful tool rows while retaining failures and unresolved outcomes.

## 2026-10-18 — Preserve compact Flower reading

- Restore the original shared 14px message scale and 1.75 line height while retaining [theme-adaptive reading colors](ui/flower-message-appearance.md). Verify authored Markdown and real transcript rendering without interpreting prose as metadata.

## 2026-10-18 — Theme-adaptive Flower reading

- Apply [assistant reading roles](ui/flower-message-appearance.md) with a centered 700px track, calmer semantic links and code, readable completion time, and explicit high-contrast behavior. Preserve authored Markdown, citations, user bubbles, selection and theme-switch geometry across all published presets.

## 2026-10-18 — Goal submission and compact composer controls

- Adopt released Floret v7.62.3 atomic [Goal submission](ai/flower-goals.md): start idle work, preserve active and waiting execution, and retain exact retry decisions. Use an inline command chip and anchored popup, preserving drafts and save-only edits.

## 2026-10-18 — Flower historical defaults and Goal disclosure

- Default only the latest abnormal ordinary turn to expanded; fold historical abnormal work, successful screenshot work and owned Goal dynamics through the existing [process disclosure](ui/flower-turn-process-disclosure.md), preserving explicit choices, inspection and recovery controls.

## 2026-10-18 — Provider stream recovery and diagnosis

- Consume published Floret v7.58.0 shared EOF classification; retain one Engine retry owner and one safe provider envelope. Require [Desktop RPC v3](desktop/desktop-session-model-source.md) under epoch 64, settle malformed/overflow/write failures, and keep [manual recovery](ui/flower-failure-recovery.md) bounded and available. See [provider ownership](ai/model-provider-surface-and-history.md#temporary-provider-failures).

## 2026-10-18 — Unified Flower process disclosure

- Adopt published Floret v7.57.0 parent turn ownership and fold ordinary [child events](ui/flower-parent-events.md) through the single [turn-process projection](ui/flower-turn-process-disclosure.md), retaining unresolved controls, safety blockers, reading protection and manual choices.

## 2026-10-18: Compact parent report tool rows

- Localize list/read report tools, retain only returned source avatars in static aligned rows, and preserve visible errors and canonical report disclosure. Recover historical source facts through the authorized tool-result reader and show confirmed submission receipts in the child view. See [parent event presentation](ui/flower-parent-events.md).

## 2026-10-18: Returned effect uncertainty and inspection recovery

- Consume published Floret v7.55.1: returned uncertainty continues the model through canonical tool results; unsettled execution remains terminal. Preserve schema 20-to-21 and the subsequent published migration lineage.
- Replace duplicate native receipt counters with published per-event delivery; require helper protocol 4, retain safe progress, and separate confirmed input from observation failures.
- Add normal-message Inspect and continue for historical terminal failures, preserving drafts, request identity, child routing and navigation through the existing outbox.

## 2026-10-18: Computer result fidelity and recoverable encoding failure

- Adopt published Floret v7.53.0 [archive and completed-error input contracts](ai/floret-thread-runtime.md), isolate [model encoding from Activity](ai/floret-redeven-adapter-and-projection.md), preserve Computer JSON types through the inclusive 1 MiB envelope limit, and qualify [canonical recovery controls](ai/computer-use-qualification.md#result-encoding-recovery) without replaying effects.

## 2026-10-18: Parent event empty pages and bounded reading recovery

- Consume published Floret v7.52.1 empty-array snapshots. Validate [parent event pages](ui/flower-parent-events.md) before canonical publication and explicit reads, share the detail-read deadline, and retain reports and exact paging cursors through local retries without changing canonical synchronization or Stop authority.

## 2026-10-18: In-place child report disclosure

- Expand the original [parent report content](ui/flower-parent-events.md) without a duplicate preview, keeping compact controls below the text and preserving the reading position through the shared transcript viewport controller.

## 2026-10-17: Parent event timeline

- Present important child reports and automatic events directly in the [parent transcript](ui/flower-parent-events.md), with canonical avatars, real report previews, stable expansion and compact inline navigation. Keep the dropdown focused on task inventory and preserve Floret ownership without receipt or admission notices.

## 2026-10-17: Lightweight presentation preview

- Consume the released Floe static PPTX surface through a lazy [file preview](ui/file-preview-viewport-and-rendering.md), with bounded input, page windowing, native selection, stable local zoom, visible compatibility notices, and verified third-party licenses and corresponding source.

## 2026-10-17: Persistent-index startup and safe preparation

- Adopt published Floret v7.52.0 persistent canonical search indexes; remove build-driven snapshots and duplicate inspection, use canonical summaries and media inventory, and add serialized stoppable preparation with counted progress. See [readiness lifecycle](architecture/ai-readiness-lifecycle.md) and [recovery](ai/flower-backup-and-recovery.md). Record [performance acceptance](operations/flower-startup-performance.md) and the shared [interaction contract](architecture/flower-startup-presentation.md).

## 2026-10-17: Tool-argument stall recovery

- Adopt published Floret v7.51.2 [bounded Provider recovery](ai/model-provider-surface-and-history.md), map its stream-interruption category for live and historical failures, and retain upstream error text and explicit recovery exits without a second retry owner or schema change.

## 2026-10-17: Visual image memory and original snapshot rereads

- Adopt published Floret v7.51.1 [native image compaction](ai/model-context-usage-and-compaction.md) and canonical attachment discovery. Extend [image.read](ai/image-read-and-retention.md) with authorized stable locators; share preview membership, preserve upload and tool resources, and remove Activity-based ownership without a second store or schema change.

## 2026-10-16: Verify generated viewer assets before commit

- Keep remote desktop catalogs synchronized with explicit Env App translations. The [commit gate](release/ci-and-release-gates.md#documentation-and-generated-assets) checks staged viewer assets through the existing generator and reports the regeneration command before a stale catalog reaches Desktop builds.

## 2026-10-16: Bounded child waits and precise failure recovery

- Adopt released Floret v7.50.0 [canonical waiting](ai/subagent-runtime.md), preserve passive parent events and full handoffs, and expose [typed failure causes and target-specific recovery](ui/flower-failure-recovery.md). Child attention retains explicit parent continuation, Stop and navigation.

## 2026-10-16: Passive parent events

- Adopt published Floret v7.49.0 canonical [important child events](ai/subagent-runtime.md), child-only reports, explicit full reads and event-aware wait. Keep idle parents passive, retain complete handoffs, and distinguish receipt from context admission in the shared UI.

## 2026-10-16: Request output budgets

- Adopt published Floret v7.48.1 [request output budgets](ai/model-context-runtime.md), frozen output refitting and domain 18; distinguish input capacity, request controls and composition estimates in Flower.

## 2026-10-16: Subagent header avatar stack

- Replace the [Subagent header](ui/flower-subagent-detail.md) badge with three rotating canonical portraits and exact remaining counts. Preserve static waiting states, gray settled inventory, accessible status summaries, surface-local detail access, and reduced-motion behavior.

## 2026-10-16: On-demand subagent context

- Remove automatic delegation counts and rolling child previews from [managed runtime facts](ai/flower-managed-model-context.md). Preserve environment capability, current tools, canonical interactions and [explicit subagent results](ai/subagent-runtime.md). Existing threads retire the old key once through Floret's normal complete-snapshot semantics; deterministic provider-request tests cover churn, errors, removal and handoffs.

## 2026-10-16: Verified SSH physical-desktop recovery

- Unify [SSH preparation](architecture/remote-desktop-ssh-deployment.md) around the published ensure transaction, separate root/sudo authorization and interruption consent, and actual Runtime admission before commit. Preserve durable rollback, existing installation identities and explicit physical targeting. Record isolated PAM evidence and outstanding physical-host acceptance without promoting source tests into a platform claim.

## 2026-10-16: Fresh explicit skill reads

- Keep [skill catalogs and bodies](ai/flower-managed-model-context.md#skill-catalog-and-explicit-reads) separate: explicit reads revalidate current sources and instructions, activation retains identity only, and repeated reads remain available after compaction. Preserve historical results and prepared requests, measure catalog replacement bytes, and retain the existing snapshot protocol.

## 2026-10-16: Query Flower Git details on demand

- Remove automatic repository state collection and injection from [managed runtime facts](ai/flower-managed-model-context.md). Preserve rule-root discovery, necessary environment and tool refreshes, and explicit Git tool history. Existing threads retire the old category once through published Floret snapshot-removal semantics, including across restart.

## 2026-10-16: Flower provider progress queue continuity

- Keep unsent [workspace live currents](ui/flower-live-timeline.md) coalescible as provider activity timestamps advance. Preserve complete latest timestamps and request, first-output, tool, interaction and terminal ordering boundaries; cover root, child, progress-only and interleaved large-history workloads.

## 2026-10-16: Stable Subagent navigation

- Keep [Subagent switcher](ui/flower-subagent-detail.md) avatars in creation order and reserve independent navigation, metadata, and context geometry across selection, deferred loading, and live status updates. Cover wide, intermediate, and narrow windows with browser coordinate assertions.

## 2026-10-16: Inline reference optical emphasis

- Increase [inline reference](ui/flower-citations.md#inline-code-references) reading size to 96% of surrounding prose, with medium weight 500 across themes. Preserve published theme colors and quiet fills, and cover mixed CJK/Latin prose in browser acceptance.

## 2026-10-16: Stronger inline reference colors

- Adopt Floe v0.86.43 saturated nonpurple colors for [inline code references](ui/flower-citations.md#inline-code-references) across all 26 themes. Keep fills quiet and preserve wrapping, links, native selection and forced colors.

## 2026-10-16: Compact Subagent creation and header

- Move [Subagent work descriptions](ui/flower-subagent-detail.md) into the native floating header, share the overview between avatar switching and metadata, and place single creation capsules directly on compact tool title rows.

## 2026-10-16: Subagent inline capsules

- Present [Subagent management targets](ui/flower-subagent-detail.md) as direct avatar capsules with current status, stable multi-child window switching, and responsive floating detail geometry. Preserve historical operation outcomes and canonical interaction ownership.

## 2026-10-16: Attachment capability loading

- Keep [composer attachments](ui/flower-composer-attachments.md#contract) queued during model capability loading, resume supported uploads automatically and retain retry after capability failures. Upload validation and staging failures no longer claim that the model cannot use attachments.

## 2026-10-16: Final-only answer actions

- Show [answer actions and completion time](ui/flower-citations.md#final-answer-actions) only for canonical final items; keep intermediate narration, active streams and unconfirmed outcomes free of final-answer controls.

## 2026-10-16 — Flower settings dialog

- Open [Flower settings](ui/flower-setup-and-settings.md#retained-panels) over the
  retained conversation with modal focus isolation, viewport scrolling and
  companion-owned interactions; preserve form state and in-flight saves.

## 2026-10-16: Quieter answer actions

- Reduce [answer action](ui/flower-citations.md#final-answer-actions) icon weight, desktop target size and spacing while preserving touch targets, keyboard focus, confirmation feedback and source disclosure.

## 2026-10-16: Theme-aware inline references

- Consume Floe v0.86.39 paired colors for [inline code references](ui/flower-citations.md#inline-code-references) across all 26 themes, preserving wrapping, links, native selection and forced colors.

## 2026-10-15 — Context source breakdown

- Replace mixed role/loading categories with explicit request sources, published Floret v7.45.0 attribution and flat horizontal tool details; preserve native usage and keyboard focus.

## 2026-10-15: Final answer actions

- Document the compact [answer actions](ui/flower-citations.md#final-answer-actions), safe standalone HTML export, canonical historical Fork anchors and separate source disclosure.

## 2026-10-15: Animate Flower during startup readiness

- Use the [existing whole-bloom rotation](architecture/ai-readiness-lifecycle.md#env-app-maintenance-presentation) while Flower is opening, backing up, or restoring; preserve each theme's artwork and stop motion when requested.

## 2026-10-15: Restore Flower motion and dark artwork

- Restore the original [whole-bloom progress rotation](ui/flower-output-progress.md#progress-symbol) and reduced-motion behavior.
- Limit the outlined white artwork to light themes; preserve the original translucent petals and gradient center in dark themes.
- Verify actual rotation in both light and dark modes; the outline visibility change must not alter progress animation.

## 2026-10-15 — Compact web-search details

- Document browser-style query fields and one-line sources in [activity interaction](ui/flower-activity-interaction.md#web-search-details).
- Preserve native search action, multi-query and requested source facts through the [provider adapter](ai/model-provider-surface-and-history.md#native-web-search-observation).

## 2026-10-15: Compact image tool previews

- Use the shared Activity thumbnail for [image reads](ai/image-read-and-retention.md#authorized-previews), matching computer and browser screenshot details.
- Preserve authorized loading, retry, saved-image inspection and collapse behavior; retain ordinary assistant image presentation.

## 2026-10-15: Auto-loaded context category bars

- Keep [auto-loaded context](ai/flower-managed-model-context.md#presentation) collapsed as a section; opening it reveals all category bars without nested expansion or raw prompt text.
- Put that disclosure on its single used-context token row, with one shared localized name and an indented current-contents breakdown instead of a separate peer section.
- Distinguish current-snapshot Unicode character counts and shares from request-scoped input token estimates; retain theme colors, live focus and bounded narrow-window layout.

## 2026-10-15: Inline conversation title editing

- Edit the [header title](ui/flower-thread-sidebar.md#rename-from-the-conversation-header) in place with save/cancel controls, Enter/Escape, blur saving and input-method protection.
- Share the existing sidebar rename owner and canonical save path; retain failed drafts and isolate pending results when conversations change.

## 2026-10-15: Compact screenshot tool previews

- Show computer and browser screenshots as [compact thumbnails](ai/computer-use-media.md) in expanded Activity details, without the decorative media canvas.
- Retain saved-image inspection, bounded loading and retry, manual disclosure and authorized media resolution.

## 2026-10-15: Compact Flower sources and website icons

- Keep [sources](ui/flower-citations.md) compact, with collapsed website summaries and independent copy controls.
- Bundle audited theSVG marks and resolve other favicons asynchronously through a disposable 90-day Runtime cache.
- Preserve interaction during delayed or failed icons, public-network egress boundaries and canonical source ownership.

## 2026-10-15 — Used context composition

- Document request-scoped used-input estimates, retained tool output, native-total authority and compact localized presentation in [managed context](ai/flower-managed-model-context.md).


## 2026-10-15: Distinct subagent identities and compact dropdown

- Replace the animal/accessory generator with 36 original fixed-palette [subagent avatars](ui/flower-subagent-detail.md).
- Simplify the dropdown and default ended agents to a two-avatar summary with a remaining count, preserving live updates, failure visibility, keyboard control, and canonical detail routing.

## 2026-10-15: Clear edit preparation status

- Describe streamed [edit preparation](ui/flower-output-progress.md#edit-arguments) as Preparing changes across Desktop and Env App locales.
- Explain provisional line counts in user terms while preserving approval, execution and confirmed-result boundaries.


## 2026-10-15: Flower outline visibility

- Keep the shared white-petal Flower mark readable on light surfaces with opaque slate outlines and stronger strokes in compact slots.
- Replace whole-bloom progress rotation with [center-only breathing](ui/flower-output-progress.md#progress-symbol), preserving reduced-motion behavior and existing status semantics.

## 2026-10-15: Context distribution card

- Present [context capacity](ai/model-context-usage-and-compaction.md) as measured input, output reserve and free space, with explicit estimates.
- Give [runtime facts](ai/flower-managed-model-context.md) a shared stacked color bar, matching category rows, character counts and on-demand full text.
- Keep cache rates, theme colors, narrow-window geometry, keyboard dismissal and live disclosure state consistent across hosts.

## 2026-10-15: Conversation title shortcut

- Add a pencil beside the [conversation header title](ui/flower-thread-sidebar.md#rename-from-the-conversation-header), using the existing rename dialog, canonical title updates and focus restoration.
- Preserve the action beside truncated titles and during running work; hide it for new conversations and hosts without rename capability.


## 2026-10-15: Bounded FlowNode stream recovery

- Adopt published Floret v7.42.0 for one [physical-request timeout and recovery owner](ai/model-provider-surface-and-history.md), semantic progress, and canonical timeout details.
- Finish Responses on their terminal event and release transport resources; remove unused host run timers and activity accounting.
- Show [output pauses](ui/flower-output-progress.md) after fifteen seconds with honest token estimates, localized recovery, and usable Stop, navigation and safe retry.

## 2026-10-15 — Screenshot results and independent computer questions

- Adopt published Floret v7.43.0 canonical input reason and evidence metadata;
  no schema or historical record changes. README product claims remain valid.
- Separate failed computer/browser operations from Agent-owned `ask_user`, with
  one canonical evidence resolver and fresh-observation continuation.
- Display saved screenshot Activity inline by default through published Floe
  media and keep its completed turn expanded, preserving manual collapse,
  thread isolation and read-only retry.
- Preserve completed effects through technical scan/capture failures and retain
  private input, unknown-effect and Run resource-release boundaries.

## 2026-10-15: Compact context statistics

- Summarize [runtime fact categories](ai/flower-managed-model-context.md) with localized horizontal bars and Unicode text shares; disclose complete text on demand.
- Keep collection and request-use metadata in the status hint and preserve focus and expanded categories during refresh.

## 2026-10-15: Confirmed file targets and recovery

- Restore [file Activity navigation](ui/flower-file-activity.md) with direct per-resource targets and canonical history enrichment.
- Add [preview recovery](ui/file-preview-window-actions.md) for unavailable files, typed failures, stable retry focus, and authorized media diagnosis.
- Adopt published Floret v7.41.0; remove action-ID resolution without rewriting historical data.

## 2026-10-15: Terminal failure and manual recovery

- Adopt published Floret v7.40.3 for typed Provider timeout classification and retained finalization diagnostics.
- Keep admitted messages normal and present one turn-level failure with recovery; preserve separate unadmitted send recovery.
- Bound [Stop confirmation](ai/floret-thread-runtime.md), retain navigation and drafts, and expose canonical [manual recovery](ui/flower-failure-recovery.md) for historical engine failures without replaying unknown effects.

## 2026-10-15: Contextual tool failure details

- Show operation content and available results before one [tool failure detail](ui/flower-terminal-activity.md), without repeating the error in row summaries or empty-output notices.
- Preserve distinct failure reasons and target recovery suggestions; keep [manual disclosure and accessible status](ui/flower-activity-interaction.md) consistent across renderers.

## 2026-10-15: Search intent and provider recovery

- Adopt published and checksummed Floret v7.40.2; hosted events use the frozen request as authority.
- Document one [search resolver](ai/model-web-search.md), provider/model switches, atomic configuration migration and retained Brave keys.
- Add shared [provider recovery](ui/flower-provider-configuration.md) with targeted settings, cancel/save return and deliberate canonical retry.

## 2026-10-15: Canonical runtime context snapshots

- Adopt published Floret v7.40.0 for [managed runtime facts](ai/flower-managed-model-context.md), exact compaction baselines, request-boundary refresh, and shared context details.

## 2026-10-15: Pencil writing feedback

- Give file edit, write, patch and Tessiven edit one [pencil-and-stroke icon](ui/flower-activity-interaction.md) with synchronized writing, lift and return motion in the existing 16px slot.
- Preserve live confirmation, reduced-motion preferences, static settlement and the same shared rendering in Desktop and Env App.

## 2026-10-15: Crisp expanded command surfaces

- Give [terminal commands](ui/flower-terminal-activity.md) a subtle borderless highlight and open output on the transcript canvas, without gradients or blur.
- Keep one selectable command node, visible copy and disclosure controls, localized output labels, truthful exit facts and bounded output scrolling.

## 2026-10-15: Animated edit argument generation

- Animate existing edit icons during confirmed live [argument generation](ui/flower-output-progress.md), respecting reduced motion and keeping approval waits and completed results static.

## 2026-10-15: Quieter Flower reading surfaces

- Use transparent [Markdown tables](ui/flower-message-appearance.md) with horizontal separators and preserved column alignment and local scrolling.
- Blend expanded [terminal details](ui/flower-terminal-activity.md) into the transcript with a subtle gradient while retaining readable commands, copy, keyboard disclosure and bounded output scrolling.

## 2026-10-15: Configurable Responses continuation

- Make OpenAI API key continuation an explicit opt-in while preserving official ChatGPT native replay and complete canonical history.
- Document the shared provider control, authentication transitions, save recovery and one effective runtime policy in [model request reuse](ai/model-request-reuse.md).
- Keep Desktop and Env App catalogs aligned, including the existing received-output and argument-preview messages.

## 2026-10-15: Received output and edit progress

- Consume checksummed Floret v7.39.2 with the v7.39.0 progress contracts and document [request output, waiting seconds and argument previews](ui/flower-output-progress.md).
- Keep previews ephemeral, separate from canonical Activity and effects; replace generated line counts with confirmed results including zero.
- Review the changed source copy and all ten explicit locale catalogs for tooltip meaning, developer terminology, placeholders and neutral token/second units. README product claims remain unchanged.

## 2026-10-15: Faster Flower storage loading

- Adopt published Floret v7.39.2 to omit disposable inspection text postings and reduce formal search-index construction allocations. Preserve complete validation, snapshot policy, and the [readiness lifecycle](architecture/ai-readiness-lifecycle.md).

## 2026-10-15: Unified provider recovery

- Document published Floret provider recovery ownership, frozen adapter replay and shared Flower retry progress.

## 2026-10-15: SubAgent failure reasons reach the parent

- Expose canonical Floret failure codes and messages through [SubAgent list, wait, and inspect](ai/subagent-runtime.md), preserving complete diagnostics in model output and clearing old reasons when the canonical child retries.
- Keep successful handoffs separate and guide parents against inferred causes or automatic retries of unknown effects.

## 2026-10-15 — OpenAI request reuse

- Adopt checksummed Floret v7.37.0 for canonical queue-state continuity and Engine-owned request reuse decisions.
- Document [official Responses connection reuse and cache metrics](ai/model-request-reuse.md). Epoch 61 and model-source RPC v2 preserve supplemental isolation across Desktop.


## 2026-10-15: Clear provider failures and quieter error presentation

- Preserve bounded structured [provider error messages](ai/chatgpt-local-authentication.md)
  through canonical Floret persistence and restart; distinguish server errors
  from failed network connections without fabricating lost historical messages.
- Use one compact [failure explanation](ui/flower-live-timeline.md), deliberate
  recovery actions and collapsed diagnostics; keep older abnormal-turn labels
  while removing the duplicate latest-turn label.

## 2026-10-15: Continuous Flower presentation during live recovery

- Protect selected details in the bounded [thread cache](ui/flower-live-timeline.md), retain valid empty conversations during refresh, and separate baseline bytes from the live queue count.
- Unify root and child unsent text coalescing across independent currents while retaining semantic barriers, started fragments, and bounded overload recovery. Add repeated reconnect checks to the browser and isolated Electron [renderer evidence](ui/flower-streaming-stability.md).
- Align Desktop queued-message take-back catalogs with the shared source and Env App, as required by the cross-renderer localization contract.


## 2026-10-15: Queued messages return to the ordinary composer

- Replace the separate queue editor with [take-back to the input box](ui/flower-turn-launcher.md), overwriting the current draft with complete text, references and staged attachment copies. Adopt published Floret v7.35.0 conditional queue removal; preserve captured snapshots and isolate delayed completion to its original conversation.

## 2026-10-15: Consistent Flower prompt and rule sources

- Unify [task, interaction and recovery guidance](ai/flower-prompt-and-rule-sources.md)
  around the actual request surface, with complete authorized rule-source manifests
  and explicit overflow rejection that leaves input correctable.
- Document [worktree authorization and tool recovery](ai/flower-prompt-and-rule-sources.md),
  remove unreachable file-reader instructions, and preserve Floret lifecycle ownership.

## 2026-10-14: Reactive message copy feedback

- Keep [message copy controls](ui/flower-streaming-stability.md) mounted across
  live text updates, read the latest content on activation, and retain successful
  clipboard feedback through completion and its timed reset.

## 2026-10-14: Consistent command activity icons

- Command execution and output reads share the terminal glyph and restore the
  existing four-square running animation in the shared
  [Activity presentation](ui/flower-activity-interaction.md).

## 2026-10-14: Refined provider connection identity

- Present the [provider connection identity](ui/flower-provider-configuration.md)
  as one aligned row with a framed brand mark and inline name editing.
- Remove the duplicate brand subtitle, keep editing height stable, and align
  credential and endpoint fields across light, dark and narrow layouts.


## 2026-10-15: Native provider state reader recovery

- Adopt published Floret v7.34.0 to reopen schema-15 stores carrying optional
  canonical-history reuse policy. Preserve that policy across epoch-60 Desktop
  model-source RPC and accept the optional recent ChatGPT response identity.
  Keep storage opaque and verify [history reader and replay contracts](ai/model-provider-surface-and-history.md).

## 2026-10-14: Provider aliases and editable endpoints

- Restore Base URL editing for OpenAI, Gemini and Anthropic in the
  [shared provider dialog](ui/flower-provider-configuration.md), independently
  of required-field validation. Preserve custom addresses and authentication drafts.
- Add inline connection aliases for every brand and preserve them in settings
  saves, provider galleries and model selectors without changing connection identity.

## 2026-10-14: Actionable compatible-model configuration

- Document [provider capability completion](ui/flower-provider-configuration.md)
  through labeled actions, save-time missing-field navigation and explicit tool
  support, with browser save/reopen coverage for Desktop and Env layouts.

## 2026-10-14: Inert HTML preview loading

- Adopt published Floret v7.33.0 complete queue edits and canonical edit lookup.
  Document single-line queue media previews, shared composer editing, exact
  retained resource authority, scoped staging retry and edit draft recovery.

- Separate [assistant media capability](ui/flower-inline-media.md) from label
  readiness, preserve bounded loading and in-place retry, and restrict
  [Desktop session-root navigation](desktop/desktop-runtime-bridge.md) so local
  file paths cannot replace the chat document.

## 2026-10-14: Canonical management operation timing

- Adopt published Floret v7.32.1 dispatch/result timing. Define
  [historical Subagent operation rows](ui/flower-subagent-detail.md) as invocation
  snapshots, remove child-clock and whole-turn duration substitutes, and keep
  current child lifecycle in the dropdown and detail overview.

## 2026-10-14: Local conversation reference admission

- Share the canonical local runtime identity across Desktop and Env App adapter,
  router and live-mapper facts. Verify [conversation reference sends](ui/flower-thread-references.md)
  through the real UI/HTTP adapter and backend authorization without weakening
  namespace or runtime permissions or rewriting frozen retries.

## 2026-10-14: Canonical assistant citations

- Adopt published Floret v7.32.0 canonical assistant citations. Document
  [citation presentation](ui/flower-citations.md), exact Unicode ranges, safe
  links, historical unavailable sources, and removal of host source collection.

## 2026-10-13

- Adopt Floret v7.31.1 canonical thread references and schema 15. Add shared
  [conversation reference interaction](ui/flower-thread-references.md)
  and [authorized indexed query tools](ai/flower-thread-queries.md), retaining
  frozen retries, canonical ownership and private tool content boundaries.
  Keep pending decisions disabled during live recovery and restore their drafts
  after confirmed resynchronization.

- Preserve saved Flower accounts and local settings across Gateway and Cloud
  maintenance through [one configuration transaction boundary](ui/runtime-settings.md#configuration-editing);
  cover concurrent saves, account removal, storage failures, and restart.
- Documented [ChatGPT request contracts](ai/chatgpt-local-authentication.md): strict schema compilation, request-owned optional-argument restoration, current native web search, complete streamed native output, canonical sanitized failure diagnostics and deliberate recovery at compatibility epoch 57. Removed the permanent composer allowance notice while retaining settings and explicit quota-error actions.

- Separate [ChatGPT account lifecycle](ai/chatgpt-account-lifecycle.md) from local admission and request contracts: verified sign-ins persist before connection saves, issued-client retries retain registration, canceled grants use logout cleanup, and saved accounts remain selectable at compatibility epoch 56.
- Keep provider model defaults exclusively in the Runtime. Directory responses publish read-only defaults for new connections; frontend source and bundle checks reject embedded catalogs, and settings retain explicit overrides without numeric substitutes.
- Audited all 140 shipped model defaults and documented current-default resolution, account-only ChatGPT snapshot scope, sparse override parity, and metadata retention for unavailable settings rows.
- Documented Runtime-owned [OpenAI account lifecycle](ai/chatgpt-local-authentication.md), protected credentials schema 3, independent local cleanup and remote revocation results, and Desktop account fact observation at compatibility epoch 55.

- Documented immediate model reads, silent Runtime-owned synchronization, atomic provider snapshots, cloud scope isolation, and explicit Provider synchronization feedback.
- Updated Desktop source and configuration boundaries for saved connections without selected models and manual unknown-model capabilities.

## 2026-10-12: Bounded model availability checks

- Give the shared [model directory](ai/model-directory-and-selection.md) one
  ten-second deadline including baseline and Desktop recovery; settle transport
  cancellation and reject late replies after timeout or scope changes.
- Keep the composer model label stable and show localized progress, timeout,
  and retry feedback in the [model popup](ui/flower-model-navigation.md).

## 2026-10-12: Compact Flower model picker

- Refine [model navigation](ui/flower-model-navigation.md) with caption-sized
  search and actions, a solid theme surface, readable disabled choices, and
  status rows that appear only when needed.
- Keep catalog expansion separate from refresh and management; verify keyboard
  focus, four locales, both themes, and narrow layouts with real Floe controls.

## 2026-10-12: Local ChatGPT authentication and catalog refresh

- Add [official ChatGPT authentication](ai/chatgpt-local-authentication.md) to the shared provider dialog with backend-enforced local host admission; remote and unknown settings keep the account option disabled.
- Share protected rotating credentials between Runtime and Desktop model sources and preserve native Responses history through the published Floret engine.
- Adopt Floret v7.29.2 and the same pinned models.dev response: add Haiku 5.5 and correct both Sonnet 4.5 context windows to 200K, preserving existing choices.
- Advance compatibility epoch to 53 and reject old authentication bundle writes.

## 2026-10-11: Ordered send feedback and direct image reads

- Show unconfirmed delivery in the existing queue dock and dispatch one ordered
  request per thread, with explicit failed/unknown recovery and request-level
  IndexedDB persistence.
- Add [direct image reads](ai/image-read-and-retention.md), native provider
  attachments, immutable snapshots and authenticated Activity previews.
- Adopt Floret v7.28.0 affected-record writes and complete media retention;
  preserve domain schema 13, history and old storage restore semantics.
- Review Runtime/Desktop epoch 52 for ordered delivery and tool-image routes.

## 2026-10-11: Runtime-bound Ask Flower references

- Bind [context action admission](ai/flower-context-action-records.md) to the connected resource endpoint; Desktop Cloud binding remains display and navigation identity.
- Use one validation, authorization, and canonicalization entry; remove client-derived resource locators while retaining the frozen historical migration decoder.
- Cover JPG, file, and directory admission across local and remote access, replay, restart, fork, and rejection with preserved drafts.

## 2026-10-10: Authenticated message attachment previews

- Route historical and queued [attachment previews](ui/flower-composer-attachments.md)
  through host access preparation and scoped Desktop Runtime IPC.
- Keep preview failures independent of model capabilities, and preserve lazy
  image loading with cancellation and Blob URL cleanup.

## 2026-10-10: Unified Go toolchain and cleanup

- Use Go 1.27.2 in both upstream and downstream module builds, CI, and maintained instructions.
- Adopt released Floret v7.27.2 and enforce matching module Go patch versions at the published dependency boundary.
- Resolve the staged module's installed toolchain for [offline notice checks](release/ci-and-release-gates.md), preserving partial staging and rejecting missing toolchains without downloads.
- Keep task worktrees on named branches until final removal; resolve cleanup blockers instead of retaining detached checkouts.

## 2026-10-10: Complete compaction input

- Adopt released Floret v7.27.1 for complete canonical compaction input and one ordered, budgeted summary loop; retain the [upstream context owner](ai/model-context-usage-and-compaction.md).
- Strengthen real DeepSeek qualification with unique facts at the end of a long earliest message, beyond the removed preview boundary. Requests must contain those facts before summary preservation and independent recall can pass.

## 2026-10-09: Flower startup efficiency

- Adopt released Floret v7.27.0 for incremental prompt records and atomic SQLite layout upgrades, preserving the [opaque storage boundary](ai/flower-storage-ownership-and-migrations.md).
- Present observed Welcome phases and record controller phase/total durations with actual failure locations in the [readiness lifecycle](architecture/ai-readiness-lifecycle.md).
- Preserve explicit reasoning drafts across remounting until [model capabilities](ai/model-directory-and-selection.md) have loaded.

## 2026-10-08 — Non-blocking Flower model directory

- Keep Runtime baseline model facts, Flower settings, thread history, drafts,
  and canvas-bound conversations available without waiting for provider or
  Desktop catalog discovery.
- Refresh dynamic sources concurrently under one bounded read, publish typed
  per-source status, and fence results by Runtime/session/settings scope.
- Keep model selection and execution admission unchanged; update the model
  directory and Desktop session contracts for the shared in-memory resource.
- Use the published Floe floating layer for the model recovery menu so nested
  Escape preserves the canvas chat window, composer draft, and trigger focus.
- Release Desktop stream requests when their renderer document navigates or
  crashes so repeated reloads cannot exhaust connection slots.

## 2026-10-08 — Flower computer recovery

- Document that Floret admits the user's answer unchanged while Flower judges
  recovery from fresh target observations in a new Run.
- Replace screenshot-before-response and failed-handback guidance with exact
  interaction lease updates, ephemeral resource status and fresh-frame privacy
  requirements in [computer takeover](ai/computer-use-takeover.md) and
  [private browser control](ai/computer-use-private-browser-control.md).

## 2026-10-05 — Stable Flower media loading

- Documented one Desktop Flower adapter per selected environment and filesystem
  scope invalidation by Runtime/connection identity, excluding health polling.
- Documented explicit media resolver context and published Floe cancellation
  ownership in [inline media](ui/flower-inline-media.md).

## 2026-10-03: Pending message controls

- Adopt published Floret v7.20.0 for atomic queued-text editing and explicit stop-and-send. Keep attachment/context authority in Floret, reject stale text, and preserve existing idle-only promotion. Native clients can manage pending messages without disabling the composer.


## 2026-10-03: Adopt published DeepSeek Flash support

- Adopt Floret v7.19.0 after upstream publication and blank-module checksum verification; enable `deepseek-flash`, Pro low effort, and current Flash alias image/output capabilities.
- Preserve model identity and unsupported native search. Keep provider-native replay and image preparation in the released upstream gateway; see [the provider review](ai/provider-api-catalog-review.md).

## 2026-10-03: Refresh official provider models and endpoint compatibility

- Add public GPT-6 Sol/Luna and GPT-6.1 Sol, Claude Opus/Sonnet 5.5, GLM FlashX, Qwen Flash/Omni, and Grok 4.7 entries with reviewed reasoning, limits, and search status.
- Correct the Anthropic SDK base URL while accepting previously saved versioned bases and proxy prefixes; align Z.ai display branding with iOS.
- Record Qwen workspace-domain migration and the published Floret blocker for the new DeepSeek Flash identity; preserve callable legacy aliases within existing engine capabilities.
- Keep native clients on the runtime-owned directory and expose official documentation and preview status without embedding another model inventory.

## 2026-09-29: Improve personal browser responsiveness with FloeBrowser v0.1.27

- Consume the published FloeBrowser v0.1.27 archive and npm package with matching bytes, integrity and provenance. Projection protocol advances to 26; media wire remains at 1.
- Keep selection and independent target actions responsive during source admission, preserve source ownership on cancellation, restore discarded tabs once and report content-free stage timing from source to usable paint.
- Qualify the task-owned Desktop and Chrome together before calling end-to-end latency complete.

## 2026-09-29: Adopt the published FloeBrowser profile workspace release

- Upgrade Redeven to the published FloeBrowser v0.1.26 package, which carries browser protocol 25 while keeping media wire version 1.
- Verify the npm package is byte-identical to the qualified GitHub release archive, refresh both JavaScript lockfiles and third-party license notices, and retain the profile workspace recovery evidence.

## 2026-09-28: Consume audited upstream security releases

- Adopt published Floe Webapp v0.81.3 and the coordinated ReDevPlugin v3.0.33 Go, npm, and Rust source artifacts after public registry and release-manifest verification.
- Keep Floret v7.18.3, Floe Native Apps v0.20.0, and FloeBrowser v0.1.25 as the reviewed published runtime dependencies.
- Synchronize exact dependency contracts, both JavaScript lock formats, the Rust worker fixture, and license notices without changing Runtime Service compatibility epoch or introducing sibling-source wiring.

## 2026-09-28: Integrate private Linux desktop and package sessions

- Consume released Floe Native Apps v0.20.0 for immutable launch planning, private Wayland/Xwayland graphics, sandbox services and native input scheduling.
- Preserve verified historical Xpra instances and atomically upgrade their records; fresh launches use the combined capability without retrying another backend.
- Share canvas/controller ownership across native Linux and macOS, and retain explicit package, service and input failure recovery.
- Record native package input/save receipts, retained-process recovery and focused validation separately from physical-device and system-IME limits.

## 2026-09-20: Refine Flower startup and backup presentation

- Give preparation and backup one branded, theme-aware waiting surface with honest progress, concise localized copy, and startup details available on demand.
- Preserve the mounted surface and keyboard focus across preparation phases; keep the initial delay only at the start of a busy period.
- Verify light and dark companion layouts, 200% text, forced colors, reduced motion, and accessibility alongside readiness admission and recovery tests.

## 2026-09-20: Bound Desktop development bundle storage

- Prune verified old development packages after each complete bundle publication.
- Keep the selected package, the three newest packages, and packages referenced by live process arguments or inherited environments.
- Cover immutable permissions, isolated state roots, symlinks, dry runs, and unavailable process inventory with focused acceptance tests.

## 2026-09-20: Apply permission changes to the next tool invocation

- Adopt published Floret v7.18.0 after its full Go, API compatibility and clean-module adoption checks.
- Resolve current thread permission at provider and tool authorization boundaries; pending approvals and executing invocations retain their own snapshots. Queue, input continuation and restart use current policy without requiring another user message.
- Keep model/reasoning busy locks, canonical history, historical migrations, resource grants and unrelated provider-profile settings boundaries. Computer tools consume the same invocation proof; authenticated user control uses current thread policy.
- Replace admission-freeze behavioral tests with six transition directions, queued mode reversal, continued automatic execution after answering an existing approval, and input, recovery, search and Computer regressions.

## 2026-09-20

* **Interaction**: Route Flower image clicks and preview actions through the existing file preview, add explicit containing-folder navigation, and adopt released Floe v0.58.0 floating previews for non-file images.


## 2026-09-19 — Inline Flower media previews

- Consume released Floe media cards for assistant screenshots, images, video, audio, and self-contained interactive HTML.
- Route local files through bounded authenticated previews and keep HTML inert on the Runtime origin.
- Preserve committed preview instances during streaming and document Desktop transport and resource disposal.

## 2026-09-19 — ReDevPlugin Rust toolchain staging recovery

- Reuse the exact installed Rust 1.88.0 toolchain and target before any
  distribution-server request, preventing warm-cache builds from failing on a
  transient TLS handshake.
- Retry only classified temporary network failures with bounded exponential
  backoff; checksum, manifest, and other deterministic errors fail closed.
- Add explicit cache-only mode and fake-Rustup acceptance coverage. TLS
  verification, published source selection, and release evidence remain
  unchanged.

## 2026-09-19 — Permission changes during Flower work

- Keep the permission selector available during work, with pending protection,
  authoritative response merging, and rollback; model and reasoning stay locked.
- Freeze permission at admission for active and queued input, continuation,
  retry, effects, computer actions, and restart recovery. Later defaults cannot
  settle an existing approval or alter its provider surface.
- Append threadstore v9-to-v10 with atomic authority backfill and verification;
  remove dispatch-time permission reconstruction and the permission busy guard.
- Use published Floret v7.16.2 contracts without an upstream API change. Keep
  full-access fill, text, and keyboard focus while removing its warning border.


## 2026-09-18 — Chrome connection recovery

- Keep native-host error categories through the extension and show specific
  recovery actions instead of a generic retry message.
- Expose one Runtime connection snapshot and route rejected older extensions
  into the shared update guide; registration repair grants no browser authority.
- Repair current package files on every explicit setup and cover restart,
  missing registration, exact native messaging and replacement installation.
- Advance Runtime Service to epoch 27 for the replacement status endpoint.
  Protocol 6 continues to reject incompatible peers; Floret remains unchanged.

## 2026-09-18 — Visible Chrome installation

- Align all shipped Chrome guide locales with actual Chromium toolbar labels,
  including the Simplified Chinese name used by older Chrome versions.
- Install into a visible, stable, per-Runtime directory beneath the user's home;
  show its exact route and host-specific Home shortcut. Keep path copying in
  help and distinguish revealing a folder from selecting it inside Chrome.
- Advance the Runtime Service window to epoch 26 for the setup route/platform
  facts. Browser protocol 6 and the published upstream APIs remain unchanged.

## 2026-09-18 — Desktop model continuation

- Forward opaque provider state across Desktop RPC and interpret it only at the
  actual provider transport. Remove the duplicate response-ID control channel.
- Keep published Floret v7.16.2 as the canonical history and state owner; no
  public API or domain-schema change is needed.
- Cover tool and image continuation, restart, canonical retry, immutable prepared
  state, and rejection before HTTP across DeepSeek, OpenAI, and Gemini.

## 2026-09-18 — Browser observation recovery

- Separate frame invalidation and bounded readonly inspection failure from
  real CAPTCHA, login, permission and user-control requirements. Runtime alone
  owns pause state; Floret still owns formal interactions.
- Preserve confirmed action progress without replay; discard semantic content,
  logs and pixels when inspection cannot establish safety. Native Messaging and
  browser JSONL advance to protocol 6; Runtime Service epoch 25 is unchanged.
- Cover detached frames, real Chromium and extension debugging, adapter
  sanitization, script prefixes and Stage resubscription. Published Floret
  v7.16.2 supplies the existing contracts; no upstream API change is needed.

## 2026-09-18 — Guided Chrome connection

- Replaced manual native-host setup with one Runtime-backed installation and
  confirmation guide shared by Desktop and Env App, automatic handshake
  detection, cancellation-safe continuation and explicit retry.
- Kept Native Messaging protocol 5 and Floret InputRequired/Respond ownership;
  Runtime Service epoch 25 adds fixed native opening actions and a stable
  extension installation directory. No database migration or upstream API change.
- Added clean Chrome installation acceptance through the visible extensions UI
  and native folder picker; browser sandboxing remains enabled.


## 2026-09-18: Flower history and Desktop compatibility

- Adopt published Floret v7.16.2 mixed-call correction and exact waiting-run provider state; keep history and interaction ownership upstream.
- Gate Desktop Flower commands, streams and frames with one protocol/epoch check. Preserve drafts, expose existing updates and keep Runtime-hosted Env App access independent.
- Record bundled and actually connected build identities in development logs; retain epoch 24 and all storage contracts.

## 2026-09-18: Context ring without an inline percentage

* Keep only the ring in the composer; expose the confirmed percentage through the tooltip and accessible description.

## 2026-09-18: Compact context presentation

* Show one confirmed context percentage and a two-row usage/cache tooltip; keep estimates for pressure decisions only.
* Remove source badges and technical budget details across all locales; retain keyboard access, canonical invalidation and reconnect consistency.

## 2026-09-18 — System browser intent and canonical computer assistance

- Require explicit browser sources and connection-only assistance without managed fallback.
- Preserve viewer-detected safety through the Runtime-owned pause and Floret InputRequired/Respond path; remove helper takeover state and per-turn blank navigation.
- Classify stopped frames, bound loading, preserve scoped non-live public previews and reveal the actual connected tab.
- Require Runtime/Desktop epoch 24 and browser/Native Messaging protocol 5. Published Floret v7.16.1, native protocol 3 and product schema 9 remain unchanged.
- See [browser routing](ai/computer-use-target-selection.md), [assistance](ai/computer-use-takeover.md) and [Stage media](ai/computer-use-media.md).

## 2026-09-18: Model-aware input estimation

* Consume published Floret v7.16.1 offline estimation across model transports, freeze the actual wire input before counting, and preserve distinct opaque-source estimates.
* Retain epoch 23 and the confirmed/estimated context UI, canonical calibration and storage contracts; consume the upstream Ask User ordering fix without a host lifecycle workaround.

## 2026-09-17 — Autonomous browser and application selection

- Add thread-scoped Runtime candidates and shared UI/Agent selection, personal
  browser preference and independent task tabs without a new storage lifecycle.
- Preserve native popup behavior and confirmed actions while returning routing
  facts to the Agent; actual authorization and private-input steps remain explicit.
- Replace mandatory target lists with current connection status and optional
  grouped search. Localize discovery and switching in Activity and settings.
- Require Desktop/Runtime epoch 22 and browser/Native Messaging protocol 4;
  macOS protocol 3, product schema 9 and published Floret v7.14.0 remain unchanged.
- See [target selection](ai/computer-use-target-selection.md),
  [browser execution](ai/computer-use-browser.md) and
  [script progress](ai/computer-use-scripts.md).

## 2026-09-17 — Tool intent and inspectable input/results

- Consume published Floret v7.14.0 structured inputs, explicit result availability,
  language and truncation without changing domain schema 12 or rewriting history.
- Require Desktop/Runtime compatibility epoch 21 for strict Activity decoders.
- Reuse Floe Webapp v0.56.7 CodeBlock with compact script disclosure and localized copy feedback. Computer tools
  share the normal activity detail path; see [activity interaction](ui/flower-activity-interaction.md).
- Preserve bounded search, multi-file, skill and script results. Script execution
  failure retains confirmed partial output and never enters argument regeneration;
  see [script execution](ai/computer-use-scripts.md).

## 2026-09-17 — Apply full access to browser and desktop operations

- Full access now covers site, application and foreground permissions on the
  selected target. Runtime derives authority from existing thread settings for
  every operation; scoped grants remain available in other modes.
- Existing permission pauses continue without saving redundant grants. The
  browser/desktop selector explains full access and hides inactive grant controls.
  Actual private-input steps and explicit pauses retain their canonical handling.
- Execution helper and Native Messaging protocol 3 carry host-owned authorization;
  Desktop/Runtime epoch 20 rejects mismatched execution adapters. Inventory and
  isolated script protocols, product schema and published Floret APIs are unchanged.
- Validation covers full-access navigation and redirects, mode changes, target
  control, sensitive fields, native AX/input, UI continuation and all locale catalogs.
  See [Computer runtime](ai/computer-use-runtime.md) and
  [assistance](ai/computer-use-takeover.md).

## 2026-09-17 — Explain browser assistance and grant task access directly

Replace the generic takeover card with reason-specific access, sign-in,
verification, CAPTCHA and page-inspection guidance. Show the requested origin
and allow access plus continuation in one explicit action, without requiring
manual browser control. Preserve canonical InputRequired ownership, private
input isolation and fresh observation before continuation. Display pending
computer actions as waiting, rename connection management to Browser and desktop,
and remove URL/text keyword checks that mislabeled ordinary work as secret input.
Focused browser tests cover duplicate clicks, save failures and conversation
changes; all product locales carry the same interaction. See
[computer assistance](ai/computer-use-takeover.md).

## 2026-09-17 — Serialize overlapping Runtime endpoint shutdown

The exact-main gate reproduced a nil HTTP-server dereference when cancellation
and explicit Local UI shutdown overlapped. A focused race test reproduces the
shared child-pointer mutation. Serialize closure and child lifecycle access,
register the parent cancellation watcher only after initialization, and retain
idempotent shutdown through the existing owner. The regression checks concurrent
close, endpoint retirement and management socket removal under the race detector.

## 2026-09-17 — Align final computer integration with current dependencies

Preserve all unpublished main changes, including native CodeSpace ownership,
service-version interaction, global dialog input isolation and media event-stream
priority. Align dependency checks with published Floe v0.55.2 and the computer
compatibility epoch 19. The initial main publication gate exposed the stale
v0.55.0 assertion; focused dependency and compatibility tests verify its fix.
Separate current qualification evidence from the acceptance contract and remove
accidentally retained browser-test failure images from maintained source.

## 2026-09-17 — Verify ordinary browser work after private recovery

The built Desktop passes private takeover, Runtime restart and safe handback,
then the complete real-model browser flow on that same Runtime. The flow uses 43 model
requests and completes its declared scenarios, including hidden execution, native
IME, explicit Stop and unknown-effect non-replay. This closes the managed
profile ownership regression exposed by the earlier failed follow-up. Exact
process, port and temporary-state cleanup passes; source configuration and
credential files remain byte-identical. Final integration remains the separate
exact-main pre-push gate.

## 2026-09-17 — Keep private browser recovery under the managed profile owner

A real Desktop follow-up after private-control restart exposed a duplicate
profile launch: recovery started an independent input helper before normal
preparation. Share initial managed target preparation across both entry paths;
passive samples do not launch browsers. A real Chromium regression reproduces
the original missing owner and verifies handback plus subsequent observations
reuse one profile process. The private fixture alone did not qualify the later
model task; keep that failed model attempt as separate evidence.

## 2026-09-17 — Qualify native and browser capability, preserve preview recovery

Real model Desktop qualification passes the native scope with 21 requests and
browser scope with 43 requests. The isolated private fixture also passes IME,
all frame rates, handback and cleanup. Incidental input no longer pauses work;
explicit Stop and private control remain authoritative. Earlier failed runs
remain historical evidence, superseded only for their exact tested scopes.

Integrate persistent pin ordering before task access: product schema 8 remains
the released pin-rank edge and schema 9 appends computer grants. Preserve
canonical preview status, terminal collapse, reconnect ordering and private
recovery. Stage opens on demand, semantic target observations support live
viewing, and a clicked historical screenshot stays bound to its exact capture.
The exact-main pre-push gate qualifies the integrated source and packaged assets.

## 2026-09-17 — Prioritize computer task capability

Preserve native popup, form and WindowProxy behavior instead of rewriting pages
to prevent focus changes. Incidental keyboard/mouse input no longer pauses
Agent work. Explicit Stop, private takeover, exact target/site authorization,
wrong-window input checks and terminal unknown-effect handling remain enforced.
Real browser regression tests cover cached openers, forms, popup target isolation,
incidental input, cancellation and lost action acknowledgement. The previous
strict popup focus requirement is superseded by the authorized capability-first
policy; previous failed or partial native runs remain historical evidence only.


## 2026-09-17 — Semantic Computer execution and explicit browser connections

Compare current official Computer Use/browser guidance with installed app
26.908.40834 and Chrome extension 1.26.901.11451. Add local-only AX reads,
bounded observation diffs and explicit full snapshots, top-level virtual browser
focus, and URL/title validation for existing tab selection. Tests use an
independently launched disposable Chrome with no Playwright page defaults.
Record the separate external-extension and internal-browser popup boundaries;
withdraw the proposed forced-reload/CSP direction. See
[design evidence](ai/computer-use-design-evidence.md).
The fifth paired managed-browser run succeeds on all 18 samples and measures
46.2% fewer model requests, 92.7% fewer image bytes and 41.9% lower median time.
This does not close native/Desktop or external popup qualification. Include the
cached-opener counterexample in the final integration gate rather than hiding it
behind the ordinary-popup pass.

The real Desktop model flow exposed an executable native inventory root that
could replace the user's selected window before failing. Remove that root from
the target registry and retain only discovered windows. Focused tests verify
invalid targets cannot mutate the binding. Add a native-only model scenario
so subsequent fixes can be qualified without repeating unrelated browser flows.
The focused run completed its first native turn, then exposed a script process
silently exiting through macOS temporary-directory symlinks. Use Node's native
entrypoint identity and cover actual JSONL startup through a symlink. Add paired
scroll coordinates to the shared primitive so restored physical mouse position
cannot choose an unrelated region. Browser and private Linux checks pass; the
native run paused for user input before completion and requires continuation.

Add bounded QuickJS scripts, compact accessibility observations, explicit managed
profiles and Chrome tab bindings, macOS window AX and private Linux AT-SPI.
Product schema 9 appends task access without changing Floret storage. Protocol 2
and compatibility epoch 19 require matching Desktop/Runtime v0.13.0 resources.
Stage starts closed and may view a current semantic target without adding model
images. Downloads, partial results and cancellation remain within the existing
execution boundary. See [runtime](ai/computer-use-runtime.md),
[scripts](ai/computer-use-scripts.md), [browser](ai/computer-use-browser.md) and
[desktop](ai/computer-use-desktop.md).

Queue popup creation after the originating click acknowledgement and recheck
admission at the creation command. Cancelled/revoked requests do not create tabs;
an unknown click or create result retires the binding without replay. Ordinary
Chrome popup focus preservation and nearby browser tests pass. A new cached-
native-opener test still bypasses page interception, so strict background popup
acceptance remains incomplete. A native-function debugger experiment could not
prevent this effect and was removed. Complete Desktop qualification and exact-
main integration also remain pending. The latest explicitly authorized native
model run completes two AX clicks and a canvas double-click before user-input
priority pauses the batch; no later script operation runs.
The fourth paired managed-browser run meets the 40/70/30 efficiency thresholds
with both variants completing 9/9 tasks, after navigation invalidation and script
guidance fixes. See [paired measurements](ai/computer-use-performance.md), which
also retain the first three unsuccessful runs. These boundaries
remain visible in [qualification](ai/computer-use-qualification.md).

Real Linux UI qualification exposed and fixed stripped semantic target/access
references and delayed wheel events being mistaken for user takeover. Public
viewers retain already decoded pixels at semantic-only completion and clear
private pixels at handback. Native short JSONL requests now use available pipe
bytes instead of waiting for a full Foundation buffer. Stop and same-thread
follow-up qualification passes. macOS qualification initially stopped for a
locked console and user input; no locked-screen result counts as acceptance.
After unlocking and explicit continuation, background occluded-window capture
and native AX/canvas/key/wheel fixtures pass, including original app/window and
pointer restoration after each operation. Accessory windows now use the same
exact AX/WindowServer matching and owner exclusion as regular apps. A real wheel
failure exposed construction-time pointer coordinates; wheel and move events
now bind to the same selected control. Fixture discovery waits only for new
windows to appear in both APIs, and color verification reads raw sRGB PNG samples.
The built Desktop private-flow fixture exposed missing IPC route admissions for
the new target/access UI. The single route allowlist now covers the new product
endpoints, with behavior tests rejecting wrong methods and ambiguous queries.
The built Desktop private-flow scope passes after that fix: continuous preview,
all frame rates, native IME, rejected/successful handback, one navigation, narrow
layout and persistence. The resize assertion waits for actual control bounds.
The full model-driven native Desktop flow remains separate qualification.
Delayed-input coverage also rejects the old one-second provenance expiry: the
bounded timestamp tokens now survive renderer delay while unrelated physical
events still yield control. The Linux UI fixture identifies its private display
through the verified Runtime's children after active sockets moved to a short
ephemeral directory.
Historical screenshot selection now resolves the clicked canonical frame even
after newer image-free observations, without opening a live sampler. The Linux
product fixture exposed this gap after its browser, X11 and floating-viewer
action checks passed; those partial results do not qualify the full scope.
An open completed public viewer also keeps its last decoded live image when an
older saved capture exists, so completion cannot rewind the displayed outcome.
Closing ends this local preservation; reopening resolves the saved capture.
A deterministic viewer regression also prevents a failed preview from blocking
a later run's new sampler. The ninth complete Linux attempt passed task effects,
private handback, cancellation, cross-thread media, fork and Runtime restart but
failed the second X11 turn's continuous-frame requirement; that run remains
failed evidence while bounded viewer diagnostics identify the missing delivery.
The tenth attempt captured a normal target release becoming a viewer error just
before completion. Runtime ownership release now cancels matching samplers, and
public startup rechecks ownership atomically with registration. Focused tests cover
normal completion, release during startup and stale cleanup after a new run.
The twelfth Linux attempt passes the complete browser/X11 UI scope with 82 real
provider requests, continuous decoded frames in every turn, private input and
handback, cancellation, cross-thread media rejection, fork and Runtime restart.
Container, credential-copy and port cleanup passed. The eleventh attempt stopped
at an official Node download timeout; the successful run used a locally cached
official archive verified against the published checksum. Chrome popup and
macOS qualification remain open, so this is not final integration acceptance.

## 2026-09-17 — Computer preview history and explicit reconnection

- Document canonical turn/run result projection, automatic terminal collapse and
  explicit historical screenshot entry without live controls.
- Describe private control disconnection, discarded inputs and late frames, and
  fresh authorization/decoding before explicit recovery.
- Reset process-local view ordering at workspace disconnect and reject old
  connection responses while canonical detail is refreshed.

## 2026-09-16 — Continuous private Computer viewing

Separate private input acknowledgements from observer-bound continuous frames.
Document shared header FPS preferences, bounded sampling and decoding, explicit
paused recovery, and atomic safe handback with localized feedback. See
[Computer takeover](ai/computer-use-takeover.md) and
[Computer media](ai/computer-use-media.md). Separate target-specific acceptance
evidence into [Computer use qualification](ai/computer-use-qualification.md).

## 2026-09-16 — Refined Computer viewer and launcher

Adopt published Floe Webapp 0.52.13 for resilient launcher dragging, shared landing
previews, gentle motion, preferred window geometry and compact content boundaries.
Flower uses a neutral 40px entry, textual run status, source-aware focus return and
fit/actual-size viewing. See [Computer media](ai/computer-use-media.md) and
[published web dependencies](architecture/env-app-upstream-web-dependencies.md).


## 2026-09-10 — Correct DeepSeek web search support

- Correct the earlier native-search assumption: the official Responses compatibility table ignores built-in search tools. Mark all shipped DeepSeek models unsupported, reject hosted declarations before dispatch, and keep Responses transport, local page fetching, images, and historical receipt replay.
- Replace the invalid native-search success fixture with request-boundary regressions and real Flash/Pro/Vision page-fetch and restart qualification. See [DeepSeek Responses](ai/deepseek-responses.md) and [catalog review requirements](ai/model-directory-and-selection.md).

## 2026-09-10 — Unified Flower web search

- Make reviewed catalog declarations and one pure resolver own search availability, with explicit integration and credential reasons.
- Align model APIs, both settings entrances, shared badges, prompts, native/local tool surfaces, and transport routing. Include DeepSeek Vision and strict full-Turn qualification. See [model directory](ai/model-directory-and-selection.md) and [DeepSeek Responses](ai/deepseek-responses.md).

## 2026-09-10: Consistent Flower Stop

- Consume released Floret v7.10.1 graceful Stop and canonical cancellation facts.
  Preserve terminal output, exact process identity, real errors, and unknown-effect
  protection; keep navigation and editing available. See
  [runtime ownership](ai/floret-thread-runtime.md), [terminal completion](ai/terminal-tool-runtime.md),
  and [live presentation](ui/flower-live-timeline.md).


## 2026-09-10 — Manual-only tool disclosure

- Remove status- and attention-driven automatic expansion from the shared Flower activity controller. Pending, waiting, and running tools remain collapsed while running titles retain their sweep.
- Preserve manual disclosure through result updates and navigation; approval controls remain in the composer. See [activity interaction](ui/flower-activity-interaction.md) and [terminal presentation](ui/flower-terminal-activity.md).

## 2026-09-10 — Immediate tool presentation and consistent failure disclosure

- Adopt published Floret v7.9.2 so validated tool descriptions and commands are visible before output and results settle during continued model generation.
- Document actor ownership and unchanged public current-view consumption in [Floret thread runtime](ai/floret-thread-runtime.md).
- Keep failed tools collapsed by default, preserve manual disclosure, and retain visible error summaries in [activity interaction](ui/flower-activity-interaction.md) and [terminal presentation](ui/flower-terminal-activity.md).

## 2026-09-09 — Reasoning default presentation

Clarified that Default is a configuration choice rather than an enabled state.
Shared Flower controls offer Default without requiring a catalog default level,
preserve explicit Off and budgets, and use localized labels. Verified the
DeepSeek reasoning wire contract through the published Floret dependency.
See [reasoning selection ownership](ui/flower-reasoning-selection.md).

## 2026-09-09: Flower streaming stability

- Retain unchanged current-view and timeline branches while keeping canonical validation and real content changes observable.
- Stabilize queue, approval, question, subagent, reference, and structured-detail controls; retain native press, focus, drag, and answer drafts.
- Bound Markdown tail nodes and parsing work, isolate terminal reader lifetimes, and share viewport geometry scheduling with 180/140 ms disclosure motion.
- Add 300-update interaction regressions, a 10,000-append code-tail regression, and reproducible production-renderer performance evidence for Chromium and official Electron.

## 2026-09-09: Model directory and selection

- Generate one offline catalog for Runtime validation, model capabilities, and both Flower settings entrances.
- Default brand catalogs to all Agent models; preserve exclusions, custom entries, overrides, and current model identities through atomic configuration conversion.
- Add Gemini, explicit OpenRouter discovery, installed Ollama discovery, and per-model Vision capabilities including DeepSeek Vision through published Floret v7.9.1, retaining the upstream asynchronous input ownership fix.
- Preserve parameter edits through search, collapse, and reopen; localize new model controls in all ten interface languages.

## 2026-09-09: Flower durable context and question recovery

- Adopt published Floret v7.9.1 for canonical references, durable runtime
  snapshots, strict bounded argument correction, and automatic domain migration.
  The patch also copies submitted input before asynchronous execution.
- Separate the selected device from the actual tool host and include existing
  environment routing instructions at card admission. No local target substitute.
- Preserve technical correction pairs in Floret while keeping the user interaction
  focused on valid questions; exhausted corrections retain output and retry.
- Verify the shared Desktop card fixture through Send and DeepSeek HTTP, plus
  follow-up context, bounded question correction, actual execution facts, and
  localized failure presentation.

## 2026-09-08: Preserve web facts through the public Activity boundary

- Include web operation, target URL, find pattern, and explicit source-list
  availability in the product payload allowlist.
- Reproduce native open-page detail loss and cover live/timeline wire round trips,
  local search sources, explicit empty results, unknown details, and terminal errors.

## 2026-09-08: Flower storage upgrade and controlled recovery

- Consume published Floret v7.6.1 maintenance APIs and require compatibility epoch 12 for restored-data request isolation.
- Put Floret, product storage, read state and cleanup under one deferred generation; preserve core Runtime availability on storage failure.
- Capture complete upgrade snapshots, protect original retry sources, and restore verified collections through an interruptible durable file journal.
- Freeze historical queue decoding and validate locked writer data through real continuation, WAL and recovery scenarios in the final main gate.

## 2026-09-08: Canonical Flower title synchronization

- Adopt published Floret v7.5.0 title generation at compatibility epoch 11.
- Give ThreadCache summaries sole title ownership and compose detail titles on
  read. Runtime body updates cannot overwrite titles; late responses use the
  same generation/status merge. Existing conversation data is unchanged.
- Cover title/body interleaving, equal runtime versions, manual rename, retries,
  cache eviction, two windows, and browser interaction.



## 2026-09-08 — Web search presentation

Adopt published Floret v7.4.0 web operation facts. Share concise search, page,
find, source-link, and missing-details presentation across Flower surfaces.

## 2026-09-08: Fork tool-history continuation

- Consume published Floret v7.3.4 for canonical tool-call reasoning and matching hosted assistant fragment boundaries.
- Verify source, ordinary fork, and nested fork continuation after restart through the product service and DeepSeek HTTP adapter.
- Cover shared UI send, refresh, and reconnect behavior. Existing corrupt histories remain unchanged; no downstream repair or validation bypass is introduced.

## 2026-09-08: Flower reasoning settings authority

- Keep confirmed thread reasoning separate from explicit new-thread draft choices and immutable submission snapshots.
- Prevent cold-load defaults from becoming draft overrides and preserve Off across reopening and waiting continuation.
- Align reasoning controls with idle-only preference changes and show a neutral placeholder before settings are known.

## 2026-09-08: Visible Flower fork results

- Consume published Floret v7.3.3 and assign localized branch titles through the existing public title contract.
- Show, select, and announce the created destination before loading details; reuse exact requests after lost responses and retry failed reads independently.
- Publish destination summaries to connected windows and keep untitled historical forks visible without rewriting stored titles or conversation history.

## 2026-09-08: Flower terminal results

- Put returned output directly below the safe command; remove repeated intent and transport metadata from details.
- Distinguish successful invocation from process exit, and explain empty output, input delivery, timeout, and termination in all shipped languages.
- Preserve disclosure behavior, canonical output ordering, and the boundary that excludes interactive input.

## 2026-09-08: Flower disclosure interaction

- Consolidate transcript following, native gesture protection, and temporary anchoring in one viewport controller.
- Preserve floating return-to-latest placement without consuming reading height; prevent mid-press hit-target changes.
- Give every tool stable safe details and document interaction ownership separately from terminal and file facts.

## 2026-09-08: DeepSeek runtime qualification

- Align all first-party Go modules, CI-selected toolchains, scripts, and README prerequisites to Go 1.27.1.
- Share staged attachment admission between initial and existing thread sends while retaining exact owner, capability, and target checks.
- Consume Floret canonical hosted search activity, failure mapping, and restart continuation through the published module boundary.


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

## 2026-09-18

Document published Floret v7.15.1 canonical calibration, tokenizer estimates, and Flower confirmation/estimate presentation with shared live and reconnect mapping.

## 2026-09-21 — Automatic Desktop browser installation

- Updated [optional browser installation](ai/computer-use-browser-installation.md):
  Desktop obtains and caches the target package automatically after confirmation;
  environment-session transfer survives panel dismissal without retaining chat
  continuation. Shared archive acquisition consumes released Floe Native Apps
  v0.2.0 and exact catalog identities.

- 2026-10-09: Adopted published Floret v7.26.0 independent context compaction, removed ordinary-turn manual sources, and documented canonical anchors, usage invalidation, and real DeepSeek qualification.

- 2026-10-11: Flower workspace envelopes use bounded transport fragments with complete atomic current replacement and compatibility epoch 51. Accepted Tessiven sends consume only their frozen selection and bind their original canvas; unknown delivery and newer selections remain intact.

- 2026-10-11: Flower queue Send now uses the released stop-and-send command during active replies and interaction waits, preserves canonical queue ownership, and sanitizes every queue mutation response.

## 2026-10-12 — Flower live synchronization recovery

Adopt published Floret v7.29.1 for canonical execution identity and the permanent
schema 13-to-14 edge. Consolidate public current encoding and workspace transport
recovery, with bounded reads, persistent synchronization notices and canonical
Stop confirmation.

## 2026-10-12 — Independent thinking segment disclosure

Restore normal thinking-segment completion collapse independently of terminal
turn-process disclosure. Preserve abnormal endings and manual reopening, separate
canonical live state from connection confirmation, and scope completion facts to
the root or SubAgent thread that owns the message.

- 2026-10-13: Document browser-native URL navigation, temporary target/URL approvals, portable locator matching and partial Computer Use execution facts.

## 2026-10-13 — HTML preview file actions

Adopt published Floe Webapp v0.86.28 in Desktop and Env App for distinct inline
HTML expansion controls and host file-preview actions. Local HTML uses the
existing file-preview window and containing-folder navigation; browser acceptance
checks the published components and preserves the original inline iframe.

## 2026-10-14 — Flower CJK Markdown emphasis

Adopt published Floe Webapp v0.86.31 and its shared Markdown parser for CJK
emphasis adjoining punctuation and prose. Preserve canonical message text,
provider cache input, citations, code literals and stable streaming controls.
See [Flower citations and Markdown presentation](ui/flower-citations.md).

## 2026-10-14 — Message submission feedback and immediate queue capture

Keep ordinary delivery loading on the published Floe Send button and retain its
draft until exact admission confirmation. Capture queued input immediately with
static feedback, using the existing ordered TransportOutbox for preparation,
persistence, dispatch and explicit recovery. Preserve newer edits, request
identity and canonical Floret queue ownership across confirmation races and
surface remounts. See [Flower command and composer flow](ui/flower-turn-launcher.md)
and [Flower timeline ordering](ui/flower-timeline-ordering.md).

## 2026-10-14 — HTML preview windows and link navigation

Adopt published Floe Webapp v0.86.32 for independent fenced-HTML preview windows
and one isolated HTML link-intent boundary. Redeven resolves links against each
source directory and uses its existing browser and authorized file-preview
actions. Fragment navigation retains live document state; invalid or failed
opens retain their source and show explicit localized feedback. See
[Flower inline media](ui/flower-inline-media.md) and
[HTML file preview](ui/file-preview-html.md).


## 2026-10-15 — Generated HTML preview canvas

Adopt published Floe Webapp v0.86.33 for bounded dotted HTML canvases, generating
sheen, source inspection, and circular floating controls. Keep the same Flower
segment from an opening preview fence through completion. Interrupted source
remains inspectable without executing partial HTML. Preserve file authorization,
isolated link routing, independent preview windows, and the ready iframe while
later Markdown grows. See [Flower inline media](ui/flower-inline-media.md).


## 2026-10-15 — Minimal HTML generation feedback

Adopt published Floe Webapp v0.86.34 for centered progress text over the dotted
HTML canvas. Remove the decorative skeleton card and placeholder bars while
retaining the restrained dot sweep, borderless product surface, circular
controls, and stable completion. Reduced motion keeps progress readable.
See [Flower inline media](ui/flower-inline-media.md).

## 2026-10-15 — Readable Computer Use activity

Require invocation descriptions for Computer Use and Browser Use tools, identify
actual browser execution in titles, and map candidates and semantic page facts
to the existing bounded Activity rows. Show results before literal scripts,
localize control labels, and omit redundant confirmation details and empty
disclosures. Preserve foreground warnings, partial failures, screenshots,
historical absence and copy/keyboard behavior. See
[Flower activity interaction](ui/flower-activity-interaction.md).

## 2026-10-15 — Concise single-file edit details

Keep the filename, change counts and file actions in the tool title for
single-file edits; expanded details start with the diff. Multi-file edits retain
their individual file toolbars. See
[Flower activity interaction](ui/flower-activity-interaction.md).


## 2026-10-15 — Plain-language context labels

Label automatically loaded project rules, skills and environment information as
auto-loaded context across Flower surfaces. Keep status times and failure
guidance readable without exposing engine terminology. See
[Flower managed model context](ai/flower-managed-model-context.md).

- 2026-10-15: Replace Web Search input repetition and missing-source placeholders with deterministic operation rows and provider-result-only details; consume the upstream URL-only source fix.

## 2026-10-16 — Test-driven Flower prompt reduction

Remove repeated Markdown, patch and Computer Use tutorials from the system
prompt while preserving product output integration and safety boundaries. Add a
deterministic size budget and an opt-in configured DeepSeek flash qualification
lane with frozen original/candidate comparisons and isolated production
execution for both versions. Separate system savings from complete request
input, include tool-definition growth, and retain every failed batch. See
[Flower prompt and rule sources](ai/flower-prompt-and-rule-sources.md).

## 2026-10-16 — Request-scoped context distribution

Adopt published Floret v7.47.1 for unified frozen-request estimates and typed
source attribution. Keep content shares separate from safety reserves and
native totals; show token amounts only with a matching vocabulary and complete
text coverage. Document relative-only, historical and unavailable states in
[context usage](ai/model-context-usage-and-compaction.md). See the
[qualification report](operations/flower-context-distribution-qualification.md) for fixed
samples, real tasks, the corrected compaction oracle and retained failures.

- 2026-10-18: Consume Floret v7.56.0 scoped parent event pages; preserve inherited recipients, local report recovery and fork creation identity. Register contract, recovery and real Service/browser regression in Flower qualification.

## 2026-10-18 — Native tokens and visible input characters

Consume published Floret v7.60.0. Separate native last-request input from
Unicode code-point categories; retain one confirmed request for overview,
characters and recent cache. Remove token residual/scaling and unused telemetry
paths. Qualify actual frozen bodies independently, real official-account calls,
Runtime restart, and compact-panel recovery. See the
[qualification record](operations/flower-context-distribution-qualification.md).

## 2026-10-18 — Canonical Flower process order

- Adopted published Floret v7.61.0 source positions and intermediate response references. Removed timestamp-based event insertion and client final-boundary inference. Added original/nested Fork regression and interaction coverage; preserve final and trailing partial replies, unresolved controls and reading protection.
