---
type: Architecture Boundary
title: ReDevPlugin host integration boundary
tags: [architecture, dependencies, plugins, release]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Redeven consumes one coordinated published ReDevPlugin Go/npm/Rust/machine release. Product adapters never recreate upstream runtime, permission or storage mechanics. Failed channel binding grants nothing and cannot close the host channel; request panic releases admission and HTTP contains failure.

# Contract

## Ownership
Published schedule/agent.work own cadence, claims and capability contracts; Redeven owns workflow admission, business context, review and canonical Flower adapters ([workflows](automation-workflows.md)). StateDir/apps/plugins/platform follows [storage](storage-ownership.md) offline relocation/admission rules.

Upstream owns validation, hashing/identity, registry/inspection, permission/confirmation, tokens/assets, sandbox/bridge, settings/intents, executions/events, storage/network/secrets, IPC/WASM/supervision, quotas/revocation, control state and releases. Manifests/tests pin the coordinated release; frontend cannot independently downgrade. Bootstrap credentials stay bounded before readiness. [Packages](redevplugin-package-lifecycle.md) owns admission/cache; [adapters](redevplugin-redeven-adapters.md) owns product placement/display.

## Availability and network
Plugin failures stay local and preserve ordinary sessions, files, terminal, Notes and Workbench. PLUGIN_RUNTIME_UNAVAILABLE executes nothing; rejected writes report not_committed. Unreadable inventory is not empty. Initialization has a 10-second budget, cancellation fences late results/closes integration, and errors/panics unwind without hiding host cancellation. Incompatible opaque state remains unchanged.

Released single-hop transports honor explicit proxy, macOS proxy/PAC, OS DNS/VPN for market/package/release. Private/synthetic addresses alone are not denial. Upstream validates URL/redirect/origin/size/cancellation/hash; downloads grant no execution. Platform checks target/method/grant/revision, quotas and revocation; private prefixes, literals and other protocols retain address-bound rules. Resolve configuration at request time. Granted HTTPS hostname connectors without private-prefix binding use the released factory.

Current admission requires Web v9. Retained data stays upstream-owned; unknown/corrupt roots fail unchanged. Product mounts origins/handlers, never interprets declarations, translates DOM/VNodes, rewrites packages or supplies ambient parent credentials.

## Runtime build and Web communication
Prepare complete Rust/C/archiver/link tools before exact published-source builds. [Build tooling](../operations/redevplugin-cross-build.md) owns pinned Zig, real probes, cache identity, cancellation and Desktop acceptance. Upstream owns containment and semantics: one actor/job path, fresh invocation state, bounded compiled-module reuse, finite fuel and signed deadlines. Immutable manifest caches never replace permission/revocation checks. Cold preparation and warm latency remain distinct.

Pure Web uses the released browser sandbox without Worker forwarding. Defaults declare no unused methods/intents; resource templates retain required declarations. No Surface methods means no receiver polling; removing the last drains claimed calls/cancellation before stopping. Opening/authority/resource/business traffic remain separate. Each simultaneous container has a distinct slot/frame/origin. Zero receiver requests proves neither zero network nor latency; qualify private resources, sibling closure and fresh authority through real SDK/product routes.

## Authoring and execution
Platform owns config/manifest validation, bindings, build/test/package, diagnostics/watch, persistent previews, update candidates, connection review and dev runtime. Product owns intent, placement, review/install approval and release proof; version-derived skills invoke published CLI. Authoring grants no execution permission.

Use authoring.WorkspaceStore and isolated authoring.Environment. Retain only opaque workspace/artifact/inspection/install-request/instance references. Upstream owns initialization, immutable artifacts, build reports, preview Host state, exact inspection and durable committed/unknown/not-committed outcomes. Status-read failure never means absence or permits a new install identity. Preview and installed stores/grants are separate; deleting drafts preserves installed plugins.

Admission/execution resolve cwd from current owner-bound SourceScope, never retained paths. Idempotent recovery preserves request evidence and uses that same source. Missing source fails before admission as PLUGIN_WORKSPACE_UNAVAILABLE, without fallback or widening. Authenticated draft source access still uses Flower approval. Admitted reads/builds use released user/environment ownership, live tool policy and user/application caps rather than browser-channel lifetime; no Host session is minted. Preview/install require a fresh channel; disconnected builds retain artifacts for later review. Preview success alone does not qualify continued authoring.

Platform author locks are atomically close-on-exec: child terminals/services must not retain them after Runtime shutdown. Never delete state or bypass locks to recover. desktop/scripts/check-plugin-author-restart.mjs verifies a real restart with a surviving terminal child and the same draft. Preview refresh preserves selected actions/JSON drafts and single-flight work; unknown effects require review. Project-relative tools resolve from project cwd through published CLI.

Released direct Surface KV/SQLite/files/settings need no Worker forwarding. Dedicated-origin binary/WebSocket handlers require exact handshakes; Host checks session ceilings/scope/grants/quotas/revocation. Product only mounts/presents. Conflict/unknown cannot replay; coalesced watches are not logs. Private-file migration remains upstream and separate from author/control schemas; snapshots/recovery stay opaque. Trusted parent query/event/cancel binds exact current gateway/plugin scope through authenticated handlers; malformed/stale/plugin-origin calls cannot widen to management. Read-only ceilings precede process effects; compiled SQL excludes host paths and bounds values/complexity/concurrency.

Author preview history uses released immutable artifacts and exact package hashes. ReDevPlugin 3.25.1 qualifies lower- and same-version local builds; retained package selection restores its platform-owned data generation. Redeven owns follow-latest/pinned-history presentation and close/review deferral. External installation keeps independent release-version rules and exact-byte inspection.

## Visual review and distribution
Opt-in context menus are upstream capability: bounded hints/normalized geometry, validated source/port/frame/handle/sequence. Product owns annotations, artifact binding, comments and Flower submission. Metadata is untrusted context, never permission, parent DOM access or another dispatcher.

Ordinary plugins need no publisher trust, signature, registration or manual admission. Official/community is display-only. Upstream derives GitHub identity; product validates market evidence then delegates independent inspection. Authors provide only plugin.slug/index slug; local work needs no GitHub. Published build --release compiles repository identity before bindings/build/hash without rewriting inputs. Local/upload identities cannot claim GitHub provenance. Every source needs exact inspection/consent/receipts and independent permissions. Product updates use current authenticated sessions/upstream eligibility, not a second install state machine. Signed platform releases, product identity and runtime leases remain separate protections.

# Boundaries

Never mutate opaque stores or mint platform tokens/grants. Legacy, wrong, drifted, tampered and future roots fail unchanged. Conversion/history binding and durable schedule/claim/restart/uncertainty belong upstream. Product displays review and supplies caps/summaries, never copies generations, edits upstream SQL, retains user sessions for scheduling or replays unknown writes.

# Evidence

Pins: go.mod and frontend/runtime manifests. internal/session/dependency_contract_test.go checks published dependency contracts; workflow, authoring and package acceptance remain in their owning concepts.
