---
type: Product Design Proposal
title: Plugin build visibility
tags: [ui, plugins, authoring, preview]
lifecycle: active_evidence
reviewed_at: "2026-11-09"
---
# Summary

Proposed upstream build progress, not shipped behavior. Keep one canvas, preview authority and compact status control. Existing successful-artifact auto-preview and early runnable milestones need no new platform API; deliver the requested layout and a useful interaction with labeled examples or explicit missing-data states.

# Contract

## Proposed experience
Use canonical Flower/source activity and actual platform phase/elapsed time. Before an artifact, show one quiet placeholder; Checks exposes bounded logs. No estimated percentage, permanent console, extra header or focus change. Only an admitted sandbox-ready artifact replaces it. Later builds retain the working iframe/input; Apply respects unsaved-data close authority and exact comment artifact/frame binding.

Distinguish failure, interruption, cancellation, approval and stale/disconnected observation. Reconcile the same attempt without replay; elapsed time proves no hang. Existing cancellation retains the good preview. Keep 12–13px theme-aware text, 44px phone actions, stable focus/panes, polite phase announcements and reduced-motion meaning. Hidden views stop rendering and reconcile on return.

# Boundaries

## ReDevPlugin owns progress
Publish upstream before consumption; proposed fields are not final API names. Bind opaque attempt identity to authenticated owner/workspace, monotonic revision, timestamps, actual/completed/skipped phases, outcome and exact artifact. Emit real boundaries with bounded output/queues/flush frequency and explicit truncation; buffering is not failure.

Persist snapshots/outcomes, coalesce logs, isolate slow observers and mark unfinished work interrupted after restart. Start with authenticated snapshots; add cursor observation only for measured latency needs under platform Execution/Event conventions. Gaps reconcile from snapshots; stale/duplicate/reordered events cannot roll back state. Preserve cancel/delete/process authority, exact package admission and complete validated milestones. Render diagnostics as text; protect credentials without promising arbitrary-secret detection.

Release Go APIs, author schemas, generated clients/DTOs, fixtures, compatibility metadata, tests and signed proof together. Review Rust without another IPC/ABI axis. Platform owns migrations/recovery; no copied pipeline/local links.

## Redeven consumes and presents
Pin published artifacts and map verified facts into existing Checks/status/all locales. Flower owns edits/approvals; platform owns builds/artifacts. No derived percentage or new dispatch authority. Successful artifacts auto-apply while following latest; choosing history pins the exact artifact until Follow latest resumes. Request useful milestones, not per-edit builds; finish the original task. Measure cold/warm paths before latency promises or caches.

## Acceptance and delivery order
1. Ship canvas/milestone guidance against existing APIs; prompts alone prove no delivery.
2. Qualify upstream phases, bounded output/backpressure, owner isolation, cancel/restart/concurrent reads, exact binding, failures and cursor recovery; publish.
3. Qualify first preview, slow/failing later builds, retained iframe/input/comments, reconnect, responsive themes.
4. Real model/sandbox: interact with the first milestone while work continues, comment, Apply and review install. Record request, actual work, phase, artifact and interaction separately; compare cold/warm timings. Screenshots alone do not qualify this journey.

# Evidence

## Current implementation
At ReDevPlugin 3.24.1, WorkspaceStore.Build persists running status before Project.Build, then copies completed stages/commands. No progress observer exists; faster polling cannot reveal absent events. Product polls at 2.5 seconds; successful artifacts auto-apply while following latest; historical selection pins an exact build. Checks shows completed stages/bounded logs. Decorative motion proves nothing; generation, build, sandbox readiness and acceptance remain separate.

November 9 qualification against published 3.25.1 verifies real Host/sandbox replacement, lower- and same-version history, reload persistence and Follow latest. An actual Flower generation and canvas comment also produced and automatically displayed a new runnable artifact. This evidence does not establish live build-phase streaming or an interactive milestone before a model turn completes.

## Open-source comparison
The November 6 comparison informed design only: bolt.diy separates actions from server/port readiness; Dyad separates refresh/restart/diagnostics; E2B Fragments executes before results; Sandpack composes preview/tests/console. No runtime/storage/sandbox/bridge/permission copying is authorized. Moving sources remain historical references: [bolt](https://github.com/stackblitz-labs/bolt.diy/blob/main/app/lib/runtime/action-runner.ts), [Dyad](https://www.dyad.sh/docs/guides/previewing), [Fragments](https://github.com/e2b-dev/fragments/blob/main/app/api/sandbox/route.ts), [Sandpack](https://sandpack.codesandbox.io/docs/advanced-usage/components).

## Local sources
internal/redevpluginintegration/author.go, PluginCreationWorkspace.tsx and browser fixtures own polling/preview evidence. Embedded authoring skill/tests own milestone guidance; published v3.24.1 pkg/authoring/workspace.go and pkg/authorproject/pipeline.go own platform evidence.
