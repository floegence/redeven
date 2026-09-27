---
okf_version: "0.2"
---

# Redeven OKF Bundle

This top-level OKF corpus is the maintained repository knowledge surface for the current Redeven implementation. It is authored from current source code, generated contracts, and release automation rather than from removed product documents.

## Architecture

- [Remote browser surface](architecture/remote-browser-surface.md) - Mount shared browser windows with source selection, theme and authenticated window lifetimes.
- [Remote browser presentation](architecture/remote-browser-presentation.md) - Present stable tab geometry and admit input only through current source authority.
- [Remote browser source ownership](architecture/remote-browser-sources.md) - Admit native pages once and preserve directory, control and popup privacy boundaries.
- [Remote browser persistence](architecture/remote-browser-persistence.md) - Restore managed pages and save browser library state without persisting authority.
- [Remote browser service recovery](architecture/remote-browser-recovery.md) - Rebuild a failed browser service without reviving old grants or losing saved managed tabs.
- [Remote browser transport and media](architecture/remote-browser-media.md) - Carry source DOM and element media through bounded authenticated lanes.
- [Remote browser files](architecture/remote-browser-files.md) - Transfer authorized source uploads and original downloads without refetching requests or scanning personal files.
- [Database schema migration ownership](architecture/database-schema-migrations.md) - Automatically migrate Redeven product stores while Floret and ReDevPlugin schemas remain upstream-owned.
- [AI readiness and service generation lifecycle](architecture/ai-readiness-lifecycle.md) - Keep product surfaces available while AI startup, retry, generation draining, and typed unavailability remain process-local.
- [Runtime startup presentation](architecture/runtime-startup-presentation.md) - Structured startup events, renderer modes, and Desktop readiness reports.
- [Observation and target action events](architecture/observation-events.md) - Publish target action progress on the canonical Flower stream with target-scoped media.
- [Local UI surface](architecture/local-ui-surface.md) - Browser entrypoints, access gate, direct sessions, and Env App proxying.
- [Env App session event transport](architecture/env-event-transport.md) - Shared session HTTP authority, bounded event observation, refresh availability, and cancellation.
- [Activity navigation restoration](ui/activity-navigation-restoration.md) - Restore the last Activity page before startup and recover unavailable plugin targets through recent built-in pages.
- [Env App resource snapshots](ui/env-resource-cache.md) - Restore authorized local inventories and refresh them without disrupting navigation or focus.
- [Env App page loading continuity](ui/page-loading-continuity.md) - Use one loading and refresh policy across all Activity pages and Workbench widgets.
- [Env App document reload presentation](ui/document-reload-presentation.md) - Preserve the prior inventory layout before application modules load and reveal authorized content once.
- [Web Services interface](architecture/web-services-interface.md) - Read service status, open archives, and resolve exceptions in compact, accessible Activity and Workbench panels.
- [Web Service browser sessions](architecture/web-service-browser-sessions.md) - Address-first opens, persisted proxy choice, and isolated Desktop loopback compatibility.
- [Managed host application preparation](architecture/host-application-preparation.md) - Prepare native graphical support and recover interrupted setup without host configuration.
- [Host Applications](architecture/host-applications.md) - Browse host applications and apply shared authorization and session lifecycle rules.
- [Cross-platform application behavior](architecture/host-application-behavior.md) - Compare common operations and the OS limits that prevent identical behavior.
- [Linux application lifecycle](architecture/linux-application-lifecycle.md) - Recover surviving application instances and separate sharing, normal window closure and explicit force quit.
- [Host application input](architecture/host-application-input.md) - Use client input methods across streamed applications, bind confirmed text to painted targets, and recover without replay.
- [Host application pointer gestures](architecture/host-application-pointer.md) — Trace touch scrolling, clicks, drag and cancellation through the shared client owner.
- [Host application display](architecture/host-application-display.md) - Stabilize SDK window layout, display density and cursor coordinates while preserving native window state.
- [Host application viewer resources](architecture/host-application-viewer-resources.md) - Upgrade viewer snapshots independently of applications and enforce digest, owner and active-share cache boundaries.
- [Host application viewer](architecture/host-application-viewer.md) - Interpret connection, waiting and terminal states without inferring application exit from transport loss.
- [Host Application Platforms](architecture/host-application-platforms.md) - Prepare a headless host, diagnose missing capabilities, and distinguish Linux capability requirements from native macOS initialization.
- [macOS Application Picture](architecture/macos-application-picture.md) - Adjust Retina resolution and streaming quality, and understand actual frame rate and bandwidth.
- [Native macOS Applications](architecture/macos-host-applications.md) - Open local Mac apps directly or operate owned remote windows with capture, input and reconnection.
- [macOS application window lifecycle](architecture/macos-application-window-lifecycle.md) - Distinguish living windows, unavailable capture and confirmed closure before ending a viewer.
- [macOS application menus](architecture/macos-application-menus.md) — Determine which native menu operations a single-application viewer exposes and how live handles are validated.
- [macOS application capture ownership](architecture/macos-application-capture-owner.md) - Keep suspended and active application channels independent under one native capture process.
- [macOS application management and graceful quit](architecture/macos-application-management.md): Manage live host applications, distinguish quit from sharing, and reject stale process targets.
- [Host Application Setup](operations/host-application-setup.md) - Install compatible Arch, Enterprise Linux and Alpine packages and verify native application startup.
- [Host Application Validation](operations/host-application-validation.md) - Qualify managed components, native client input and mobile pointer behavior.
- [Host application input validation](operations/host-application-input-validation.md) - Verify actual toolkit text, click focus and old-session recovery while separating real IME acceptance.
- [Host application platform validation](operations/host-application-platform-validation.md) - Verify Linux userspace and native macOS evidence while retaining hardware, translation and policy limits.
- [Host application cursor acceptance](operations/host-application-cursor-validation.md) - Verify transported cursor geometry and application clicks while tracking physical pointer and device limitations.
- [Host Application Lifecycle](operations/host-application-lifecycle.md) - Diagnose startup, window, access and transport transitions using the focused acceptance matrix.
- [Runtime Binary Portability](architecture/runtime-binary-portability.md) - Build native Linux/macOS runtimes and preserve static library source and relink access.
- [Desktop loopback Web Service access](architecture/web-service-desktop-loopback.md) - Give one HTTP service a protected numeric-loopback Origin in its isolated Desktop window.
- [Web Service system-browser authorization](architecture/web-service-browser-authorization.md) - Exchange a Desktop-private route for one exact, bounded browser session without a public fallback.
- [Managed Web Service Templates](architecture/managed-web-service-templates.md) - Verify and map one released external catalog without retaining service-specific content in Redeven.
- [Redeven Service Template format compatibility](architecture/service-template-format-compatibility.md) - Read branded and historical source formats without rewriting original files.
- [GitHub service template sources](architecture/managed-service-git-sources.md) - Import original directories through either download location and review source changes before committing them.
- [Independent Host service lifecycle](architecture/independent-host-services.md) - Preserve application processes across management restarts and safely recover native ownership and private opening sessions.
- [Managed Web Services](architecture/managed-web-services.md) - Resolve current templates with fixed releases, exact bindings, applied Runtime digests, and explicit failure recovery.
- [Web Service management recovery](architecture/service-management-recovery.md) - Review current facts, resume partial uninstall, and detach or restore management without losing resource control.
- [Service resource ownership](architecture/service-resource-ownership.md) - Allocate isolated instance resources and preserve unverified legacy or externally referenced data.
- [Managed Service operation progress](architecture/managed-service-operation-progress.md) - Persist and stream bounded, redacted command output without losing user-controlled disclosure state.
- [Managed Service release discovery and updates](architecture/managed-service-release-discovery.md) - Discover exact npm and OCI releases directly from configured sources, require explicit selection, and update with rollback.
- [Managed Service version interaction](architecture/managed-service-version-interaction.md) - Select and verify a version in one drawer, confirm only changed notices, and stop or submit without losing context.
- [Managed Service instance configuration](architecture/managed-service-instance-configuration.md) - Combine current template definitions with typed instance overrides and apply stopped Runtime changes through one risk-checked journal.
- [Runtime Service snapshot](architecture/runtime-service-snapshot.md) - Desktop/runtime compatibility, open readiness, capabilities, and bindings.
- [Runtime session permission gates](architecture/runtime-session-permission-gates.md) - Runtime validation and local permission clamping before sessions open.
- [Runtime transport dependencies](architecture/runtime-transport-dependencies.md) - Flowersec and Floeterm dependency boundaries.
- [Product RPC request encoding](architecture/product-rpc-request-encoding.md) - Construct JSON requests that preserve optional filesystem operation semantics before transport dispatch.
- [Git workspace inventory lifecycle](architecture/git-workspace-inventory-lifecycle.md) - Bound revisioned workspace capture, transport resources, mutation coordination, and linked-worktree removal.
- [Env App upstream web dependencies](architecture/env-app-upstream-web-dependencies.md) - Published web package contracts consumed by Env App.
- [Whole-window status surfaces](ui/window-status-surfaces.md) - Present connection, access and standalone Desktop status while keeping glass out of movable content.
- [Env App page asset recovery](ui/page-asset-recovery.md) - Detect frontend updates after reconnect and recover failed page modules without automatically discarding unsaved work.
- [ReDevPlugin host integration boundary](architecture/redevplugin-boundary.md) - Separate released platform ownership from Redeven source policy, placement, runtime build, and business adapters.
- [Plugin platform integration](architecture/plugin-platform-integration.md) - Mount the released Host, admit reviewed external packages, and coordinate exact Activity and Workbench placements.
- [Plugin market consumption](architecture/plugin-market-consumption.md) - Discover one verified latest release per channel while GitHub Releases and ReDevPlugin retain artifact and trust authority.
- [Native container operation observation](architecture/containers-operation-observation.md) - Keep endpoint-bound native mutations locked until authoritative reconciliation proves a terminal outcome.
- [Native container resources](architecture/container-resources-capability.md) - Manage Docker and Podman through one native engine, operation, permission, and product boundary.
- [Container runtime execution](architecture/container-runtime-execution.md) - Discover active engine endpoints and bind typed Docker or Podman observations without changing host selection.
- [Volume usage observation](architecture/container-volume-usage.md) - Distinguish referenced, unused, and unknown volumes while loading engine-reported disk usage independently.
- [Container service management](architecture/container-service-management.md) - Detect, control, and configure the active local Docker or Podman implementation without endpoint selection or elevation.
- [Native container console](architecture/container-resources-console.md) - Present stable aggregated inventory, structured Compose input, and exact-target resource navigation.

## Security

- [Runtime access sessions](security/runtime-access-sessions.md) - Preserve browser refresh continuity, scope Runtime cookies, and enforce session expiry and revocation.
- [Runtime two-factor authentication](security/runtime-two-factor-authentication.md) - Set up environment MFA, sign in, recover lost factors, and enforce session revocation.
- [Local UI network exposure](security/local-ui-network-exposure.md) - Configure network scope, authenticated HTTP/HTTPS endpoints, exact authorities, and independent client sessions.
- [Local UI certificates](security/local-ui-certificates.md) - Import, regenerate, or remove HTTPS identities safely and configure client trust explicitly.
- [Permission policy and filesystem scope](security/permission-policy-and-filesystem-scope.md) - Local caps and directory-level file access policy.
- [Plugin platform integration security](security/plugin-platform-integration-security.md) - Keep authenticated ownership, package provenance, signature trust, permissions, and runtime authority independent.

## Desktop

- [Host application component cache](desktop/host-application-component-cache.md) - Reuse graphical component downloads across devices and distinguish cached bytes from network and upload progress.
- [Desktop development bundle retention](desktop/desktop-development-bundles.md) - Remove obsolete development packages while retaining current, recent, and running-process bundles.
- [Desktop Web Service browser window](desktop/web-service-browser-window.md) - Preserve trusted chrome, isolated application state, exact navigation authority, and recoverable connection failures.
- [Desktop host application titlebar](desktop/host-application-titlebar.md) - Operate application windows and picture settings beside native window buttons while preserving fast connection and normal close semantics.
- [Desktop shell theme state](desktop/desktop-shell-theme-state.md) - Global source, per-mode Floe presets, renderer synchronization, and native window colors.
- [Desktop runtime bridge](desktop/desktop-runtime-bridge.md) - Separate Desktop direct lifecycle coordination from Runtime and optional access transports.
- [Desktop Environment library](desktop/desktop-environment-library.md) - Browse shared Runtime/Cloud cards, source grids, scoped actions and consistent group counts.
- [Desktop Welcome navigation](desktop/desktop-welcome-navigation.md) - Switch Environments and Flower immediately while retaining page state and honoring explicit host requests.
- [Desktop Environment connections](desktop/desktop-environment-connections.md) - Identify each connection's host and apply one address scope and sharing policy across cards and settings.
- [Desktop runtime readiness](desktop/desktop-runtime-readiness.md) - Separate direct Runtime health and recovery from access-only Gateway, Provider, and URL readiness.
- [Desktop transport recovery](desktop/desktop-transport-recovery.md) - Preserve bridge identity, recovery generations, and terminal session disposal.
- [Desktop SSH runtime operations](desktop/desktop-ssh-runtime-operations.md) - Execute SSH-host and SSH-container lifecycle actions through one direct Desktop owner.
- [Desktop WSL runtime operations](desktop/desktop-wsl-runtime-operations.md) - Register exact WSL 2 distributions and manage Linux Runtime lifecycle through a private Windows Desktop Bridge.
- [Desktop session and model source](desktop/desktop-session-model-source.md) - Project session routes, opaque Desktop models, Flower attach, and lifecycle invalidation.
- [Desktop Environment registration ownership](desktop/desktop-environment-registrations.md) - Keep independent registration owners per action surface, migrate retired SSH records once, and serialize rename, pin, and removal safely.
- [Desktop environment settings](desktop/desktop-environment-settings.md) - Open one settings window, retain independent drafts, and save through the selected registration’s authority.
- [Desktop SSH environment settings](desktop/desktop-ssh-environment-settings.md) - Edit SSH connection details, reveal custom configuration, and dismiss the editor directly.
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

- [Runtime settings](ui/runtime-settings.md) - Navigate all runtime settings with retained drafts, responsive controls, confirmed maintenance, and real Skills operations.

- [UI presentation transactions](ui/ui-presentation-transactions.md) - Visual intent, after-paint content commits, post-paint effects, keep-alive continuity, and performance budgets.
- [Env App floating layer order](ui/env-app-floating-layer-order.md) - Order movable windows, Flower, plugin surfaces, blocking modals, and command UI through one product contract.
- [Dialog content placement](ui/dialog-content.md) - Place instructions and consequences in the body while preserving title identity, accessible guidance, and scrollable content.
- [Adaptive desktop layout](ui/adaptive-desktop-layout.md) - Preserve desktop workflows in narrow windows and allocate transient navigation from local space.
- [Mobile shell navigation](ui/mobile-shell-navigation.md) - Reach global tools and plugins above an interactive bottom bar while reclaiming the mobile toolbar row.
- [File preview window actions](ui/file-preview-window-actions.md) - Read files with compact title-bar actions while preserving selection, editing, and dismissal behavior.
- [File preview viewport and rendering](ui/file-preview-viewport-and-rendering.md) - Fit pages and images to the full reading area, float zoom controls, and prevent stale or overlapping renders.
- [Git workspace generation and Files decoration](ui/git-workspace-generation-and-decoration.md) - Keep Git views and background Files status consistent through capability gating and monotonic invalidation.
- [Shared surface material](ui/surface-material.md) - Apply lightweight shared depth, quiet seams, and immediate control feedback across Env App, Desktop, and Flower.
- [Input focus boundaries](ui/input-focus-boundaries.md) - Keep one stable focus border across standard and compound inputs while preserving non-input keyboard cues.
- [Git browser visual states](ui/git-browser-visual-states.md) - Keep selection, current-branch facts, Git status tones, hover, and focus visually independent across themes.
- [Git diff request lifecycle](ui/git-diff-request-lifecycle.md) - Preserve request ownership and reading state across layout changes while refreshing on new Git targets, explicit actions, and transport replacement.
- [Workbench interaction contracts](ui/workbench-interaction-contracts.md) - Wheel, text selection, and action-surface ownership contracts.
- [Workbench composition surfaces and editing](ui/workbench-composition.md) - Edit optional region names and note materials with native input and durable layout storage.
- [Workbench input ownership](ui/workbench-input-ownership.md) - Distinguish canvas, local-scroll, pointer, text, and terminal input ownership.
- [Workbench terminal interaction](ui/workbench-terminal-interaction.md) - Preserve attachment, input-plane, focus, retained-history, and performance ownership.
- [Terminal fonts across client devices](ui/terminal-fonts.md) - Resolve bundled and available local fonts without rewriting shared preferences or observer-controlled geometry.
- [Terminal session groups](ui/terminal-session-groups.md) - Persist one Environment group catalog and project it consistently through Activity and Workbench placement trees.
- [Official installation progress](ui/plugin-installation-progress.md) - Observe durable installation and permission setup across management close and reconnect.
- [Plugin package review](ui/plugin-package-review.md) - Review exact update and external-package evidence before mutation.
- [Plugin layout continuity](ui/plugin-layout-continuity.md) - Preserve plugin placements through updates, recovery, and independent display modes.
- [Workbench surface lifecycle](ui/workbench-surface-lifecycle.md) - Preserve selection, recovery, lazy widgets, and shared floating-surface ownership.
- [File icon presentation](ui/file-icon-presentation.md) - Identify file formats with released upstream artwork, product palettes, and size-appropriate detail across Files and Git.
- [Files context menus](ui/files-context-menu.md) - Keep file actions inside the whole Files workspace and above mobile Flower chrome with shared touch, keyboard, and scroll handling.
- [Plugin Center interaction](ui/plugin-center-interaction.md) - Browse, filter, and manage plugins with retained drawer state and correct modal input.
- [Plugin surfaces](ui/plugin-surfaces.md) - Review exact plugin inventory and place SDK surfaces in Activity windows or Workbench widgets.
- [Flower turn launcher](ui/flower-turn-launcher.md) - Use one strict turn endpoint, connection-local composer state, typed admission outcomes, and host handoff responsibilities.
- [Flower composer references](ui/flower-composer-references.md) - Working-directory @ discovery, editable draft chips, strict composer wire data, and ordered admission into Floret.
- [Flower input history](ui/flower-input-history.md) - Recall previous user text with arrow keys while preserving drafts, input methods and completion ownership.
- [Absolute filesystem directory selection](ui/filesystem-picker-navigation.md) - Select runtime-authorized absolute paths with shared navigation and independent product forms.
- [Flower working directory navigation](ui/flower-working-directory-navigation.md) - Open a conversation directory in Files or a new Terminal through consistent Activity and Workbench menus.
- [Flower mobile navigation](ui/flower-mobile-navigation.md) - Switch between full-height conversations and chat while retaining drafts, readable content, and circular send actions.
- [Flower Activity companion](ui/flower-activity-companion.md) - Expand a compact bottom-bar field into the same retained Flower surface and preserve placement, composer identity, focus, and read ownership.
- [Ask Flower window boundaries](ui/ask-flower-window.md) - Keep contextual launchers below headers and preserve manual resizing without maximization.
- [Flower companion presence](ui/flower-companion-presence.md) - Present live work, pending actions, and new completion feedback without displacing drafts or creating a second observation stream.
- [Flower live timeline](ui/flower-live-timeline.md) - Canonical live thread timeline projection, replacement events, and cursor ownership.
- [Flower timeline ordering](ui/flower-timeline-ordering.md) - Consume canonical turn pages, projections, decorations, cursors, and replacement events.
- [Flower reasoning selection ownership](ui/flower-reasoning-selection.md) - Preserve explicit reasoning choices through cold loading, shared drafts, and restart.
- [Flower model and navigation presentation](ui/flower-model-navigation.md) - Keep model-source controls, notifications, and staged thread selection explicit.
- [Flower setup and settings](ui/flower-setup-and-settings.md) - Configure Flower through clear setup destinations and flat settings sections while preserving drafts and permission ownership.
- [Flower composer attachments](ui/flower-composer-attachments.md) - Stage files and long text through one shared connection-local composer workflow.
- [Flower file activity presentation](ui/flower-file-activity.md) - Show typed file-change statistics and unified diffs without protocol metadata or reconstructed state.
- [Flower activity disclosure interaction](ui/flower-activity-interaction.md) - Keep tool clicks, reading position, and floating controls stable during streaming.
- [Flower conversation sidebar](ui/flower-thread-sidebar.md) - Distinguish selection and persist pin order while preserving menus, focus and running animations.
- [Flower inline media](ui/flower-inline-media.md) - Display screenshots, video, audio, and isolated HTML previews inside assistant messages.
- [Flower streaming stability](ui/flower-streaming-stability.md) - Preserve complete interaction subtrees, bound rendering work, and reproduce streaming performance acceptance.
- [Flower terminal activity presentation](ui/flower-terminal-activity.md) - Render safe terminal operation facts and bounded output.
- [Flower interactions and context state](ui/flower-approval-context.md) - Reconcile questions, shared decision guards, and context recovery.
- [Asynchronous layout stability](ui/asynchronous-layout-stability.md) - Keep controls, retained lists, feedback, and media stationary through asynchronous state changes.
- [Shared interface scale](ui/interface-scale.md) - Align desktop text, controls, and spacing while preserving touch targets and content-viewer scale.
- [Flower approval surface](ui/flower-approval-surface.md) - Review bounded approval queues, inspect commands, and decide exact one-time batches.
- [Flower subagent detail presentation](ui/flower-subagent-detail.md) - Render parent-owned membership and read-only child execution detail.

## AI

- [Model directory and selection](ai/model-directory-and-selection.md) - Update the offline catalog, preserve model preferences, and discover installed Agent models.

- [AI tool runtime](ai/ai-tool-runtime.md) - Builtin tool registry, permission checks, and activity projection.
- [Flower storage ownership and migrations](ai/flower-storage-ownership-and-migrations.md) - Preserve owner lineages and deterministic canonical imports without mutable request decoders.
- [Flower backup and recovery](ai/flower-backup-and-recovery.md) - Review protected complete-set snapshots and restore data without replaying old work.
- [Flower historical writer acceptance](ai/flower-upgrade-compatibility.md) - Add immutable writer samples and prove upgrade, continued use and restart at final integration.
- [Flower attachment resources](ai/flower-attachment-resources.md) - Enforce owner-scoped uploads, canonical reads, quotas, and last-reference cleanup.
- [AI tool permissions and dispatch](ai/tool-permission-runtime.md) - Apply tool registration, scheduling, permission, approval, readonly, and target-routing contracts.
- [Computer and browser use runtime](ai/computer-use-runtime.md) - Keep authorization, execution, observation and packaged helper compatibility under one Runtime owner.
- [Computer script execution](ai/computer-use-scripts.md) - Compose bounded semantic operations and preserve partial results without replaying effects.
- [Optional built-in browser installation](ai/computer-use-browser-installation.md) - Confirm browser download or Desktop upload, persist the capability switch, and validate task continuation.
- [Browser and desktop settings](ai/computer-use-environment-settings.md) - Inspect environment capabilities and manage pairing without changing conversation targets or permissions.
- [Guided Chrome connection](ai/computer-use-browser-connection.md) - Install and confirm a browser connection, then resume the original task automatically.
- [Chrome connection diagnostics and recovery](ai/computer-use-chrome-diagnostics.md) - Diagnose missing components and graphical sessions, then recover on the correct environment host.
- [Managed browsers and authorized Chrome tabs](ai/computer-use-browser.md) - Select profiles and exact tabs, preserve user settings, and qualify background control.
- [Semantic desktop operations](ai/computer-use-desktop.md) - Use window AX and isolated AT-SPI with explicit foreground authority and user input priority.
- [Computer target selection across threads](ai/computer-use-target-selection.md) - Preserve authorized target choices across turns and restart without inheriting control on fork.
- [Computer use safety pauses and user control](ai/computer-use-takeover.md) - Pause canonical tool execution, keep private browser input out of history, and require fresh observation on handback.
- [Private browser observation and input](ai/computer-use-private-browser-control.md) - Fence secret-surface observation, user-only frames, ordered input and explicit handback recovery.
- [Computer use media and visual requests](ai/computer-use-media.md) - Separate durable keyframes from live samples and verify decoded Stage pixels and visual request budgets.
- [Flower computer viewer presentation](ui/flower-computer-viewer.md) - Present decoded Stage pixels, restore viewer geometry and apply canonical status without changing media authority.
- [Computer use qualification](ai/computer-use-qualification.md) - Verify real pixels, input, handback, target scope and isolated cleanup.
- [Computer use qualification evidence](ai/computer-use-qualification-evidence.md) - Assess measured native, browser and private-recovery outcomes within their tested scope.
- [Computer use paired model measurements](ai/computer-use-performance.md) - Compare semantic scripts with visual primitives and reject incomplete performance evidence.
- [Codex design evidence](ai/computer-use-design-evidence.md) - Trace command-first, AX, batching and background-control decisions to official guidance and version-scoped packaged behavior.
- [AI tool approval runtime](ai/tool-approval-runtime.md) - Reconcile pending approval queues, conflicts, decisions, and authoritative live state.
- [AI terminal tool runtime](ai/terminal-tool-runtime.md) - Manage PTY handles, incremental output, termination, and Floret settlement.
- [AI model and context runtime](ai/model-context-runtime.md) - Separate model-source ownership, provider mapping, token limits, context, and compaction.
- [DeepSeek Responses](ai/deepseek-responses.md) - Share Floret stateless transport and enforce documented web tool limits.
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
