---
type: Product Design Proposal
title: Plugin build visibility
tags: [ui, plugins, authoring, preview]
lifecycle: active_evidence
reviewed_at: "2026-11-06"
---
# Summary

Proposed upstream build progress, not shipped behavior. Keep one canvas, preview authority and compact status control. Early runnable milestones and existing first-artifact auto-preview require no new platform contract. Deliver the requested layout and one useful interaction early, using labeled examples or explicit missing-data states.

# Contract

## Proposed experience
Use ordinary Flower streaming/approvals and canonical source activity, never inferred progress. Before an artifact, show a quiet placeholder and one actual state. During builds, the toolbar shows platform phase/elapsed time; Checks exposes bounded stage logs. No estimated percentages, permanent console, added headers or focus changes.

Only an admitted sandbox-ready artifact replaces the placeholder; no unrelated demo, extra workspace or implicit grant. Later builds retain the working iframe/input; Apply follows existing unsaved-data close authority. Progress never changes comment artifact/frame binding.

Distinguish failure, interruption, cancellation, approval and disconnection. Mark disconnected observations stale; elapsed time proves no hang. Reconcile the same attempt without replay. Existing turn/process cancellation retains the good preview.

Use 12–13px theme-aware text, one toolbar, 44px phone actions, stable pane/focus and polite phase announcements. Do not announce every log/time tick. Reduced motion retains meaning; hidden views stop rendering and reconcile on return.

# Boundaries

## ReDevPlugin owns progress
Release platform changes before consumption; proposed fields are not final API names. Bind opaque attempt identity to authenticated owner/workspace, monotonic revision, timestamps, actual/completed/skipped phases, terminal outcome and exact artifact. Emit actual phase boundaries and bounded output with explicit truncation, bounded queues and flush frequency; process buffering must not hide boundaries or imply failure.

Persist authoritative snapshots/outcomes, coalesce logs, isolate slow observers and mark unfinished work interrupted after restart. Start with authenticated status snapshots; add cursor observation only for measured latency needs, following platform Execution/Event conventions. Gaps reconcile from snapshots; stale/duplicate/reordered events cannot roll state back.

Preserve cancel/delete/process authority and exact source/package admission. Render diagnostics as text and protect credentials before persistence/exposure without promising detection of arbitrary secrets. Early milestones remain complete validated packages; backend requirements cannot be bypassed for a Web shell.

Ship Go APIs, author schemas, generated clients/DTOs, fixtures, compatibility metadata, tests, notes and signed release proof together. Review Rust impact without another IPC/ABI axis. Platform owns durable migrations/recovery; no copied pipeline or local links.

## Redeven consumes and presents
Pin published dependencies and project verified platform facts through thin adapters into existing Checks/status and all locales. Flower owns edits/approvals; platform owns builds/artifacts. Do not derive percentages or add dispatch authority. First-artifact apply is the sole automatic preview transition. Request useful early milestones, not per-token/per-edit builds; complete the original request. Measure cold/warm paths before latency promises or generic caches.

## Acceptance and delivery order
1. Ship composer/canvas and milestone guidance against the existing release; prompt tests prove delivery, not compliance.
2. Qualify upstream live phases with controllable commands, output bounds/backpressure, owner isolation, cancellation, concurrent reads, restart, binding, terminal failures and any cursor recovery; publish.
3. Qualify product first preview, slow/failing later builds, retained iframe/input/comments, reconnect and responsive themes.
4. Use a real model/sandbox: interact with the first milestone while work continues, comment, apply and explicitly review install. Record request, observed work, phase, artifact and interactive surface separately; compare cold/warm timings. Fixture screenshots do not establish this journey.

# Evidence

## Current implementation
At published ReDevPlugin 3.24.1, `WorkspaceStore.Build` persists running status before `Project.Build`, then copies stages/commands after return. The pipeline records completed stages without a progress observer; faster polling cannot reveal absent events. Product polling is 2.5 seconds; first artifact auto-applies, later ones require Apply. Checks exposes completed stages/bounded output. Decorative placeholder motion measures nothing. Source generation, package build, sandbox readiness and acceptance remain separate facts.

## Open-source comparison
The 2026-11-06 comparison informed design only; moving sources may change. bolt.diy separates action state from WebContainer server/port readiness; Dyad separates preview refresh/restart and exposes setup diagnostics; E2B Fragments executes after generation before switching to results; Sandpack composes preview/tests/console under shared state. None authorizes copying runtimes, storage synchronization, dev-server previews, sandbox, bundler, bridge or permission paths.

References: [bolt actions](https://github.com/stackblitz-labs/bolt.diy/blob/main/app/lib/runtime/action-runner.ts), [preview store](https://github.com/stackblitz-labs/bolt.diy/blob/main/app/lib/stores/previews.ts), [Dyad](https://www.dyad.sh/docs/guides/previewing), [Fragments page](https://github.com/e2b-dev/fragments/blob/main/app/page.tsx)/[sandbox](https://github.com/e2b-dev/fragments/blob/main/app/api/sandbox/route.ts), [Sandpack components](https://sandpack.codesandbox.io/docs/advanced-usage/components)/[hooks](https://sandpack.codesandbox.io/docs/advanced-usage/hooks).

## Local sources
`internal/redevpluginintegration/author.go`, `PluginCreationWorkspace.tsx` and adjacent browser fixtures show the adapter, polling and preview lifetime. The embedded authoring skill/tests own milestone guidance. Released module `github.com/floegence/redevplugin/v3@v3.24.1` owns `pkg/authoring/workspace.go` and `pkg/authorproject/pipeline.go`.
