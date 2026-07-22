---
okf_version: "0.2"
---

# Redeven OKF Bundle

This top-level OKF corpus is the maintained repository knowledge surface for the current Redeven implementation. It is authored from current source code, generated contracts, and release automation rather than from removed product documents.

## Architecture

- [Runtime startup presentation](architecture/runtime-startup-presentation.md) - Structured startup events, renderer modes, and Desktop readiness reports.
- [Local UI surface](architecture/local-ui-surface.md) - Browser entrypoints, access gate, direct sessions, and Env App proxying.
- [Runtime Service snapshot](architecture/runtime-service-snapshot.md) - Desktop/runtime compatibility, open readiness, capabilities, and bindings.
- [Runtime session permission gates](architecture/runtime-session-permission-gates.md) - Runtime validation and local permission clamping before sessions open.
- [Runtime transport dependencies](architecture/runtime-transport-dependencies.md) - Flowersec and Floeterm dependency boundaries.
- [Env App upstream web dependencies](architecture/env-app-upstream-web-dependencies.md) - Published web package contracts consumed by Env App.
- [ReDevPlugin host integration boundary](architecture/redevplugin-boundary.md) - Published plugin-platform dependency and Redeven adapter ownership.
- [Plugin platform integration](architecture/plugin-platform-integration.md) - Local UI, AppServer, released ReDevPlugin Host mounting, product adapters, and Flower orchestration boundaries.
- [Container resources capability](architecture/container-resources-capability.md) - Redeven-owned Docker and Podman business capability contract for plugin adapter registration.

## Security

- [Local UI network exposure](security/local-ui-network-exposure.md) - Fixed-port plaintext exposure admission, exact authority checks, acknowledgement, and warning preferences.
- [Permission policy and filesystem scope](security/permission-policy-and-filesystem-scope.md) - Local caps and directory-level file access policy.
- [Plugin platform integration security](security/plugin-platform-integration-security.md) - Session, route, permission, and capability boundaries for ReDevPlugin adapters.

## Desktop

- [Desktop shell theme state](desktop/desktop-shell-theme-state.md) - Global source, per-mode Floe presets, renderer synchronization, and native window colors.
- [Desktop runtime bridge](desktop/desktop-runtime-bridge.md) - Desktop-managed Local UI launches, runtime-control, and startup probing.
- [Desktop runtime readiness](desktop/desktop-runtime-readiness.md) - Validate startup handoff, access admission, lifecycle readiness, and window-open gates.
- [Desktop transport recovery](desktop/desktop-transport-recovery.md) - Preserve bridge identity, recovery generations, and terminal session disposal.
- [Desktop SSH runtime operations](desktop/desktop-ssh-runtime-operations.md) - Coordinate shared SSH transports, operation generations, host discovery, and process inventory.
- [Desktop session and model source](desktop/desktop-session-model-source.md) - Project session routes, opaque Desktop models, Flower attach, and lifecycle invalidation.
- [Desktop runtime process lifecycle](desktop/desktop-runtime-process-lifecycle.md) - Scoped inventory, historical process reconciliation, package activation ordering, and lifecycle success conditions.

## Gateway

- [Gateway service](gateway/gateway-service.md) - Standalone Gateway binary, managed service lifecycle, and Desktop bridge.

## Code

- [Browser Editor runtime](code/browser-editor-runtime.md) - Code App app server, codespace proxying, and managed Browser Editor setup.

## UI

- [UI presentation transactions](ui/ui-presentation-transactions.md) - Visual intent, after-paint content commits, post-paint effects, keep-alive continuity, and performance budgets.
- [Workbench interaction contracts](ui/workbench-interaction-contracts.md) - Wheel, text selection, and action-surface ownership contracts.
- [Workbench input ownership](ui/workbench-input-ownership.md) - Distinguish canvas, local-scroll, pointer, text, and terminal input ownership.
- [Workbench terminal interaction](ui/workbench-terminal-interaction.md) - Preserve attachment, input-plane, focus, retained-history, and performance ownership.
- [Workbench surface lifecycle](ui/workbench-surface-lifecycle.md) - Preserve selection, recovery, lazy widgets, and shared floating-surface ownership.
- [Plugin surfaces](ui/plugin-surfaces.md) - Redeven placement rules for sandboxed ReDevPlugin surfaces in product chrome.
- [Flower turn launcher](ui/flower-turn-launcher.md) - Contextual first-turn Ask Flower launchers and host handoff responsibilities.
- [Flower Activity companion](ui/flower-activity-companion.md) - Place one low-profile Flower companion in Activity while preserving canonical thread/read authority and Workbench isolation.
- [Flower live timeline](ui/flower-live-timeline.md) - Canonical live thread timeline projection, replacement events, and cursor ownership.
- [Flower timeline ordering](ui/flower-timeline-ordering.md) - Consume canonical turn pages, projections, decorations, cursors, and replacement events.
- [Flower model and navigation presentation](ui/flower-model-navigation.md) - Keep model-source controls, notifications, and staged thread selection explicit.
- [Flower terminal activity presentation](ui/flower-terminal-activity.md) - Preserve canonical terminal activity, disclosure, animation, and scrolling state.
- [Flower approval and context state](ui/flower-approval-context.md) - Project approval queues, compaction, context usage, and read acknowledgement.
- [Flower subagent detail presentation](ui/flower-subagent-detail.md) - Render parent-owned membership and read-only child execution detail.

## AI

- [AI tool runtime](ai/ai-tool-runtime.md) - Builtin tool registry, permission checks, and activity projection.
- [Flower storage ownership and migrations](ai/flower-storage-ownership-and-migrations.md) - Apply host-only schema v3 and strict product v2-to-v3 migration boundaries.
- [AI tool permissions and dispatch](ai/tool-permission-runtime.md) - Apply tool registration, scheduling, permission, approval, readonly, and target-routing contracts.
- [AI tool approval runtime](ai/tool-approval-runtime.md) - Reconcile pending approval queues, conflicts, decisions, and authoritative live state.
- [AI terminal tool runtime](ai/terminal-tool-runtime.md) - Manage PTY handles, incremental output, termination, and Floret settlement.
- [AI model and context runtime](ai/model-context-runtime.md) - Separate model-source ownership, provider mapping, token limits, context, and compaction.
- [Floret thread runtime integration](ai/floret-thread-runtime.md) - Read canonical overviews, titles, structured attachments, and admitted lifecycle through published Floret APIs.
- [Flower subagent runtime](ai/subagent-runtime.md) - Use Floret-owned child threads, strict spawn input, delegated permission audit, membership, and detail.
- [Flower thread fork coordination](ai/flower-thread-fork-coordination.md) - Fork canonical Agent state first, then materialize fixed host settings and thread resource ownership.
- [Flower thread deletion coordination](ai/flower-thread-deletion-coordination.md) - Persist delete intent, remove canonical Floret state first, then host data and physical resources.
- [Flower plugin generation](ai/flower-plugin-generation.md) - Generated plugin flows through Floret approval and ReDevPlugin lifecycle APIs.
- [Flower context action records](ai/flower-context-action-records.md) - Ask Flower launcher context validation, persistence, and UI badge projection.
- [Redeven environment operations](ai/redeven-env-operations.md) - Product boundary for Flower and automation environment lifecycle requests.
- [OKF bundle lifecycle](ai/okf-bundle-lifecycle.md) - OKF source validation, deterministic artifacts, and runtime embedding.
- [OKF tool suite](ai/okf-search-tool.md) - Read-only repository knowledge access through index browsing, short search, and concept opening.

## Protocol

- [Gateway v1 protocol](protocol/gateway-v1-protocol.md) - OpenAPI source contract for Gateway HTTP JSON endpoints, auth, envelopes, and Desktop behavior boundaries.
- [RCPP v2 provider API](protocol/rcpp-v2-provider-api.md) - Provider discovery, Desktop auth, environment catalog, health, open-session, and bootstrap.

## Release

- [CI and release gates](release/ci-and-release-gates.md) - Local/CI checks and release artifact contracts.
- [OKF release assets](release/okf-release-assets.md) - Public release verification files for the embedded OKF bundle.
