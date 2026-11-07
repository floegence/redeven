---
type: Product Design Proposal
title: Plugin build visibility
tags: [ui, plugins, authoring, preview]
lifecycle: active_evidence
reviewed_at: "2026-11-06"
---
# Summary

Proposed next platform feature: expose actual author build progress while Flower
delivers an early runnable version of the requested application. Keep one canvas,
one preview authority and one compact status control. Live stage/output updates
described here are not shipped. Early-milestone author guidance and the existing
first-artifact auto-preview need no new platform contract.

# Contract

The following experience is proposed, not released behavior.

## Proposed experience

1. **Create.** Keep the ordinary Flower stream and approvals. Before a runnable
   artifact exists, use the quiet canvas and one status line. Source-edit activity
   comes only from canonical Flower state, never prose or filename heuristics.
2. **Build.** The existing compact status control shows the actual platform phase
   and elapsed time. Its Checks disclosure contains stages and expandable bounded
   logs. The empty canvas may repeat the short state near the placeholder. Avoid
   extra headers, a permanent console, estimated percentages and focus changes.
3. **First preview.** Build the user's main layout and one useful interaction
   early, then continue implementing. After normal admission and sandbox readiness,
   the first valid artifact replaces the placeholder. Use explicit empty states
   for unavailable data; label illustrative data. Do not install an unrelated demo,
   grant permissions or create another workspace just to fill the canvas.
4. **Iterate.** Keep the last good iframe and input usable during later builds and
   failures. Apply uses the existing unsaved-data close contract. Progress updates
   never change the artifact/frame identity attached to right-click comments.
5. **Recover.** Distinguish failed, interrupted, cancelled, awaiting approval and
   disconnected. During disconnect, mark the last phase stale; elapsed time alone
   does not establish a hang. Reconcile the same attempt without replaying work.
   Cancellation uses existing turn/process authority and retains the good preview.

Use 12-13px text, theme tokens and one toolbar. Phone layouts preserve the selected
pane, 44px action targets and focus. Announce phase changes politely, not each log
chunk or elapsed second. Reduced motion preserves state visibility. Hidden views
stop rendering work and reconcile when visible again.

# Boundaries

## ReDevPlugin owns progress

Extend the shared pipeline and workspace service first. These are requirements
for a future released contract, not final API names:

- Bind one opaque build-attempt identity to the authenticated owner/workspace,
  monotonic sequence/revision, timestamps, current phase, completed/skipped phases,
  terminal outcome and exact result artifact.
- Emit actual phase-start/finish and bounded command output. Child-process output
  buffering must not hide stage boundaries or be misclassified as failure. Bound
  events, log bytes, observer queues and flush frequency. Expose truncation.
- Persist the authoritative snapshot and terminal outcome; coalesce log chunks.
  A slow viewer cannot block the build. Restart marks unfinished work interrupted.
- First expose incremental snapshots through the current authenticated status
  route. Add cursor-based observation only if log latency requires it, following
  shared platform observation/Execution/Event conventions. Reconcile gaps through
  snapshots; stale, duplicate or reordered observations cannot roll state back.
- Preserve cancellation, deletion and process cleanup authority. Render diagnostics
  as text. Apply bounded output and credential protection before persistence and
  exposure, without claiming arbitrary secrets can always be detected.
- Keep exact source/package validation and artifact admission. An early preview
  is a complete validated milestone package, not partial-file execution. A backend
  requirement cannot be bypassed to display a Web shell.

Update Go APIs, author schemas, generated TypeScript DTOs/clients, fixtures,
compatibility metadata, tests, release notes and publication evidence together.
Review Rust impact without inventing another IPC/ABI axis. Durable changes need
platform-owned migration/recovery. Release the coherent platform with its signed
release manifest before Redeven consumes it; no copied pipeline or local links.

## Redeven consumes and presents

Upgrade exact published dependencies, project verified progress through the thin
adapter, and update existing status/checks UI and every locale. Flower owns source
activity and approvals; ReDevPlugin owns build facts and artifacts. Do not combine
these into guessed percentages or add a product-specific platform dispatcher.

The first-artifact auto-apply remains the only automatic preview transition.
Guidance requests early builds for meaningful milestones, not each token or every
simple edit, and never stops work at the first preview. Measure cold/warm paths
before promising latency or adding generic preparation/cache machinery upstream.

## Acceptance and delivery order

1. Ship the composer/canvas changes and early-milestone guidance on the existing
   release. Prompt tests establish instruction delivery, not model compliance.
2. Release upstream progress after testing in-flight phases with a controllable
   command, bounded output/backpressure, owner isolation, cancellation, concurrent
   reads, restart, source binding and terminal failures. Test cursor recovery if
   introduced.
3. Integrate the release. Browser acceptance covers first preview, slow builds,
   failed later builds, unchanged iframe/input, comments during builds, reconnect
   and narrow/light/dark layouts.
4. Qualify with a real model and sandbox: inspect a useful first interaction while
   work continues, revise through a comment, apply and explicitly review install.
   Record request acceptance, first observed work, phase update, artifact and
   interactive surface separately. Compare cold/warm timings before setting
   targets. Fixture screenshots cannot prove this flow.

# Evidence

## Current implementation

Redeven consumes published ReDevPlugin 3.24.1. `WorkspaceStore.Build` persists a
running report before invoking `Project.Build`, then copies stages and commands
only after that call returns. The pipeline records each stage after completion
and exposes no progress observer. Polling faster cannot recover missing events.
The product polls status every 2.5 seconds, automatically applies the first
retained artifact, and keeps later artifacts pending for explicit Apply. Checks
already exposes completed stages and bounded command output.

Before the first artifact, the canvas shows a decorative morphing layout. Its
animation indicates waiting, not measured progress. Flower file/tool activity
already belongs to its conversation; package compilation belongs to ReDevPlugin.
Generating source, building a package, opening a sandbox and passing application
acceptance are separate facts. A running build is not a live application.

## Open-source comparison

Primary sources inspected on 2026-11-06; these are design references, not new
dependencies or copied implementations. Moving upstream source may change.

| Project | Observed mechanism | Adopt in Redeven | Boundary |
| --- | --- | --- | --- |
| bolt.diy | ActionRunner records pending/running/complete/aborted/failed actions; preview store observes WebContainer server-ready and port events | Runtime-owned progress and a separate readiness signal | Do not copy its runtime, storage synchronization or arbitrary dev-server preview |
| Dyad | Chat-adjacent preview; refresh and server restart are separate; System Messages explains long dependency setup | Quiet preview with diagnostics on demand | Do not restart or reload a user's current preview on each source edit |
| E2B Fragments | Streams generated content; after generation finishes, executes a sandbox request and switches to its result | Distinguish streaming source from executable output; reuse a prepared template | Its streamed text is not proof of rendering incomplete code; no second remote sandbox |
| Sandpack | Composable preview, code, tests and console with shared provider/client state | One authoritative state, small replaceable presentation components | No additional bundler, iframe bridge or permission path |

Sources:
- https://github.com/stackblitz-labs/bolt.diy/blob/main/app/lib/runtime/action-runner.ts
- https://github.com/stackblitz-labs/bolt.diy/blob/main/app/lib/stores/previews.ts
- https://www.dyad.sh/docs/guides/previewing
- https://github.com/e2b-dev/fragments/blob/main/app/page.tsx
- https://github.com/e2b-dev/fragments/blob/main/app/api/sandbox/route.ts
- https://sandpack.codesandbox.io/docs/advanced-usage/components
- https://sandpack.codesandbox.io/docs/advanced-usage/hooks

## Local sources

- `redeven:internal/ai/system_skills/redeven-plugin-authoring/SKILL.md` - Early-milestone guidance.
- `redeven:internal/ai/system_plugin_authoring_test.go` - Model-visible guidance checks.
- `redeven:internal/redevpluginintegration/author.go` - Released pipeline adapter.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCreationWorkspace.tsx` - Polling, first artifact and retained preview.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPreviewUpdates.browser.test.tsx` - Preview lifetime fixtures.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCreationWorkspace.browser.test.tsx` - Canvas and disclosure fixtures.
- Published Go module `github.com/floegence/redevplugin/v3@v3.24.1`: `pkg/authoring/workspace.go`, `pkg/authorproject/pipeline.go`.
