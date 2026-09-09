---
okf_version: "0.2"
---

# Redeven OKF Bundle

This top-level OKF corpus is the maintained repository knowledge surface for the current Redeven implementation. It is authored from current source code, generated contracts, and release automation rather than from removed product documents.

## Architecture

- [Database schema migration ownership](architecture/database-schema-migrations.md) - Automatically migrate Redeven product stores while Floret and ReDevPlugin schemas remain upstream-owned.
- [AI readiness and service generation lifecycle](architecture/ai-readiness-lifecycle.md) - Keep product surfaces available while AI startup, retry, generation draining, and typed unavailability remain process-local.
- [Runtime startup presentation](architecture/runtime-startup-presentation.md) - Structured startup events, renderer modes, and Desktop readiness reports.
- [Local UI surface](architecture/local-ui-surface.md) - Browser entrypoints, access gate, direct sessions, and Env App proxying.
- [Web Services interface](architecture/web-services-interface.md) - Read service status, open archives, and resolve exceptions in compact, accessible Activity and Workbench panels.
- [Web Service browser sessions](architecture/web-service-browser-sessions.md) - Address-first opens, persisted proxy choice, and isolated Desktop loopback compatibility.
- [Desktop loopback Web Service access](architecture/web-service-desktop-loopback.md) - Give one HTTP service a protected numeric-loopback Origin in its isolated Desktop window.
- [Web Service system-browser authorization](architecture/web-service-browser-authorization.md) - Exchange a Desktop-private route for one exact, bounded browser session without a public fallback.
- [Managed Web Service Templates](architecture/managed-web-service-templates.md) - Verify and map one released external catalog without retaining service-specific content in Redeven.
- [Independent Host service lifecycle](architecture/independent-host-services.md) - Preserve application processes across management restarts and safely recover native ownership and private opening sessions.
- [Managed Web Services](architecture/managed-web-services.md) - Resolve current templates with fixed releases, exact bindings, applied Runtime digests, and explicit failure recovery.
- [Web Service management recovery](architecture/service-management-recovery.md) - Review current facts, resume partial uninstall, and detach or restore management without losing resource control.
- [Service resource ownership](architecture/service-resource-ownership.md) - Allocate isolated instance resources and preserve unverified legacy or externally referenced data.
- [Managed Service operation progress](architecture/managed-service-operation-progress.md) - Persist and stream bounded, redacted command output without losing user-controlled disclosure state.
- [Managed Service release discovery and updates](architecture/managed-service-release-discovery.md) - Discover exact npm and OCI releases directly from configured sources, require explicit selection, and update with rollback.
- [Managed Service instance configuration](architecture/managed-service-instance-configuration.md) - Combine current template definitions with typed instance overrides and apply stopped Runtime changes through one risk-checked journal.
- [Runtime Service snapshot](architecture/runtime-service-snapshot.md) - Desktop/runtime compatibility, open readiness, capabilities, and bindings.
- [Runtime session permission gates](architecture/runtime-session-permission-gates.md) - Runtime validation and local permission clamping before sessions open.
- [Runtime transport dependencies](architecture/runtime-transport-dependencies.md) - Flowersec and Floeterm dependency boundaries.
- [Git workspace inventory lifecycle](architecture/git-workspace-inventory-lifecycle.md) - Bound revisioned workspace capture, transport resources, mutation coordination, and linked-worktree removal.
- [Env App upstream web dependencies](architecture/env-app-upstream-web-dependencies.md) - Published web package contracts consumed by Env App.
- [ReDevPlugin host integration boundary](architecture/redevplugin-boundary.md) - Separate released platform ownership from Redeven source policy, placement, runtime build, and business adapters.
- [Plugin platform integration](architecture/plugin-platform-integration.md) - Mount the released Host, admit reviewed external packages, and coordinate exact Activity and Workbench placements.
- [Plugin market consumption](architecture/plugin-market-consumption.md) - Discover one verified latest release per channel while GitHub Releases and ReDevPlugin retain artifact and trust authority.
- [Native container operation observation](architecture/containers-operation-observation.md) - Keep endpoint-bound native mutations locked until authoritative reconciliation proves a terminal outcome.
- [Native container resources](architecture/container-resources-capability.md) - Manage Docker and Podman through one native engine, operation, permission, and product boundary.
- [Volume usage observation](architecture/container-volume-usage.md) - Distinguish referenced, unused, and unknown volumes while loading engine-reported disk usage independently.
- [Container service management](architecture/container-service-management.md) - Detect, control, and configure the active local Docker or Podman implementation without endpoint selection or elevation.
- [Native container console](architecture/container-resources-console.md) - Present stable aggregated inventory, structured Compose input, and exact-target resource navigation.

## Security

- [Local UI network exposure](security/local-ui-network-exposure.md) - Explicit device identity and client trust, HTTPS/WSS transport, exact authority checks, and fail-closed TLS.
- [Permission policy and filesystem scope](security/permission-policy-and-filesystem-scope.md) - Local caps and directory-level file access policy.
- [Plugin platform integration security](security/plugin-platform-integration-security.md) - Keep authenticated ownership, package provenance, signature trust, permissions, and runtime authority independent.

## Desktop

- [Desktop Web Service browser window](desktop/web-service-browser-window.md) - Preserve trusted chrome, isolated application state, exact navigation authority, and recoverable connection failures.
- [Desktop shell theme state](desktop/desktop-shell-theme-state.md) - Global source, per-mode Floe presets, renderer synchronization, and native window colors.
- [Desktop runtime bridge](desktop/desktop-runtime-bridge.md) - Separate Desktop direct lifecycle coordination from Runtime and optional access transports.
- [Desktop runtime readiness](desktop/desktop-runtime-readiness.md) - Separate direct Runtime health and recovery from access-only Gateway, Provider, and URL readiness.
- [Desktop transport recovery](desktop/desktop-transport-recovery.md) - Preserve bridge identity, recovery generations, and terminal session disposal.
- [Desktop SSH runtime operations](desktop/desktop-ssh-runtime-operations.md) - Execute SSH-host and SSH-container lifecycle actions through one direct Desktop owner.
- [Desktop WSL runtime operations](desktop/desktop-wsl-runtime-operations.md) - Register exact WSL 2 distributions and manage Linux Runtime lifecycle through a private Windows Desktop Bridge.
- [Desktop session and model source](desktop/desktop-session-model-source.md) - Project session routes, opaque Desktop models, Flower attach, and lifecycle invalidation.
- [Desktop Environment registration ownership](desktop/desktop-environment-registrations.md) - Keep one storage owner per card, migrate retired SSH records once, and serialize rename, pin, and removal safely.
- [Desktop runtime process lifecycle](desktop/desktop-runtime-process-lifecycle.md) - Own Local, WSL, SSH, and container Runtime lifecycle through one process-local Desktop coordinator.
- [Desktop managed Environment reinstall](desktop/desktop-reinstall-operations.md) - Recover an exact managed Runtime root with a Runtime-only package and minimal Desktop journal.
- [Desktop application updates](desktop/desktop-application-updates.md) - Coordinate signed macOS Sparkle and Linux DEB/RPM updates with one stateful installation boundary.

## Gateway

- [Gateway service](gateway/gateway-service.md) - Run the optional standalone identity, catalog, open-session, and access forwarding service.

## Code

- [CodeSpace system-browser access](desktop/codespace-system-browser.md) - Hand a resource-bound entry to an ordinary browser and preserve editor operations without private bridge credentials.
- [Native Desktop CodeSpace access](desktop/codespace-native-access.md) - Open a bound editor through a persistent protected loopback origin over the selected environment transport.
- [Browser Editor runtime](code/browser-editor-runtime.md) - Code App app server, codespace proxying, and managed Browser Editor setup.

## UI

- [UI presentation transactions](ui/ui-presentation-transactions.md) - Visual intent, after-paint content commits, post-paint effects, keep-alive continuity, and performance budgets.
- [Env App floating layer order](ui/env-app-floating-layer-order.md) - Order movable windows, Flower, plugin surfaces, blocking modals, and command UI through one product contract.
- [Git workspace generation and Files decoration](ui/git-workspace-generation-and-decoration.md) - Keep Git views and background Files status consistent through capability gating and monotonic invalidation.
- [Git browser visual states](ui/git-browser-visual-states.md) - Keep selection, current-branch facts, Git status tones, hover, and focus visually independent across themes.
- [Workbench interaction contracts](ui/workbench-interaction-contracts.md) - Wheel, text selection, and action-surface ownership contracts.
- [Workbench input ownership](ui/workbench-input-ownership.md) - Distinguish canvas, local-scroll, pointer, text, and terminal input ownership.
- [Workbench terminal interaction](ui/workbench-terminal-interaction.md) - Preserve attachment, input-plane, focus, retained-history, and performance ownership.
- [Terminal session groups](ui/terminal-session-groups.md) - Persist one Environment group catalog and project it consistently through Activity and Workbench placement trees.
- [Official installation progress](ui/plugin-installation-progress.md) - Observe durable installation and permission setup across management close and reconnect.
- [Plugin package review](ui/plugin-package-review.md) - Review exact update and external-package evidence before mutation.
- [Plugin layout continuity](ui/plugin-layout-continuity.md) - Preserve plugin placements through updates, recovery, and independent display modes.
- [Workbench surface lifecycle](ui/workbench-surface-lifecycle.md) - Preserve selection, recovery, lazy widgets, and shared floating-surface ownership.
- [Plugin surfaces](ui/plugin-surfaces.md) - Review exact plugin inventory and place SDK surfaces in Activity windows or Workbench widgets.
- [Flower turn launcher](ui/flower-turn-launcher.md) - Use one strict turn endpoint, connection-local composer state, typed admission outcomes, and host handoff responsibilities.
- [Flower composer references](ui/flower-composer-references.md) - Working-directory @ discovery, editable draft chips, strict composer wire data, and ordered admission into Floret.
- [Absolute filesystem directory selection](ui/filesystem-picker-navigation.md) - Select runtime-authorized absolute paths with shared navigation and independent product forms.
- [Flower working directory navigation](ui/flower-working-directory-navigation.md) - Open a conversation directory in Files or a new Terminal through consistent Activity and Workbench menus.
- [Flower Activity companion](ui/flower-activity-companion.md) - Present one stable Activity Flower surface as a dedicated page, fixed work-detail overlay, or centered bottom-bar presence while preserving canonical authority and Workbench isolation.
- [Flower live timeline](ui/flower-live-timeline.md) - Canonical live thread timeline projection, replacement events, and cursor ownership.
- [Flower timeline ordering](ui/flower-timeline-ordering.md) - Consume canonical turn pages, projections, decorations, cursors, and replacement events.
- [Flower reasoning selection ownership](ui/flower-reasoning-selection.md) - Preserve explicit reasoning choices through cold loading, shared drafts, and restart.
- [Flower model and navigation presentation](ui/flower-model-navigation.md) - Keep model-source controls, notifications, and staged thread selection explicit.
- [Flower composer attachments](ui/flower-composer-attachments.md) - Stage files and long text through one shared connection-local composer workflow.
- [Flower file activity presentation](ui/flower-file-activity.md) - Show typed file-change statistics and unified diffs without protocol metadata or reconstructed state.
- [Flower activity disclosure interaction](ui/flower-activity-interaction.md) - Keep tool clicks, reading position, and floating controls stable during streaming.
- [Flower streaming stability](ui/flower-streaming-stability.md) - Preserve complete interaction subtrees, bound rendering work, and reproduce streaming performance acceptance.
- [Flower terminal activity presentation](ui/flower-terminal-activity.md) - Render safe terminal operation facts and bounded output.
- [Flower approval and context state](ui/flower-approval-context.md) - Project approval queues, compaction, context usage, and read acknowledgement.
- [Flower subagent detail presentation](ui/flower-subagent-detail.md) - Render parent-owned membership and read-only child execution detail.

## AI

- [Model directory and selection](ai/model-directory-and-selection.md) - Update the offline catalog, preserve model preferences, and discover installed Agent models.

- [AI tool runtime](ai/ai-tool-runtime.md) - Builtin tool registry, permission checks, and activity projection.
- [Flower storage ownership and migrations](ai/flower-storage-ownership-and-migrations.md) - Preserve owner lineages and deterministic canonical imports without mutable request decoders.
- [Flower backup and recovery](ai/flower-backup-and-recovery.md) - Review protected complete-set snapshots and restore data without replaying old work.
- [Flower historical writer acceptance](ai/flower-upgrade-compatibility.md) - Add immutable writer samples and prove upgrade, continued use and restart at final integration.
- [Flower attachment resources](ai/flower-attachment-resources.md) - Enforce owner-scoped uploads, canonical reads, quotas, and last-reference cleanup.
- [AI tool permissions and dispatch](ai/tool-permission-runtime.md) - Apply tool registration, scheduling, permission, approval, readonly, and target-routing contracts.
- [AI tool approval runtime](ai/tool-approval-runtime.md) - Reconcile pending approval queues, conflicts, decisions, and authoritative live state.
- [AI terminal tool runtime](ai/terminal-tool-runtime.md) - Manage PTY handles, incremental output, termination, and Floret settlement.
- [AI model and context runtime](ai/model-context-runtime.md) - Separate model-source ownership, provider mapping, token limits, context, and compaction.
- [DeepSeek Responses](ai/deepseek-responses.md) - Share Floret stateless transport, reasoning, and native search.
- [Floret thread runtime integration](ai/floret-thread-runtime.md) - Read canonical overviews, titles, structured attachments, and admitted lifecycle through published Floret APIs.
- [Flower subagent runtime](ai/subagent-runtime.md) - Use Floret-owned child threads, bounded status previews, canonical membership, and complete handoffs.
- [Flower thread fork coordination](ai/flower-thread-fork-coordination.md) - Fork canonical Agent state first, then materialize fixed host settings and thread resource ownership.
- [Flower thread deletion coordination](ai/flower-thread-deletion-coordination.md) - Retire product access after durable intent, serialize canonical-first cleanup, and fail closed on integrity loss.
- [Flower plugin generation](ai/flower-plugin-generation.md) - Generated plugin flows through Floret approval and ReDevPlugin lifecycle APIs.
- [Flower context action records](ai/flower-context-action-records.md) - Ask Flower launcher context validation, persistence, and UI badge projection.
- [Redeven environment operations](ai/redeven-env-operations.md) - Product boundary for Flower and automation environment lifecycle requests.
- [OKF bundle lifecycle](ai/okf-bundle-lifecycle.md) - OKF source validation, deterministic artifacts, and runtime embedding.
- [OKF tool suite](ai/okf-search-tool.md) - Read-only repository knowledge access through index browsing, short search, and concept opening.

## Protocol

- [Gateway v2 protocol](protocol/gateway-v1-protocol.md) - Define signed pairing, catalog, profile, open-session, and access-only Gateway routes.
- [RCPP v3 provider API](protocol/rcpp-v3-provider-api.md) - Define Provider discovery, health, open-session, Runtime link, and access authorization only.

## Release

- [CI and release gates](release/ci-and-release-gates.md) - Local/CI checks and release artifact contracts.
- [OKF release assets](release/okf-release-assets.md) - Public release verification files for the embedded OKF bundle.
- [Automated service-template catalog updates](release/service-template-updates.md) - Adopt checksum-verified catalog tags through the final main gate without publishing product packages or upgrading instances.
