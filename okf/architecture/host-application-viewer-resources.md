---
type: Architecture Contract
title: Host application viewer resources and layered upgrades
description: Prepare current immutable viewer snapshots while retaining application and backend lifetimes, and authorize their content-addressed resources.
tags: [applications, runtime, security, cache]
timestamp: 2026-09-27T00:00:00Z
---
# Summary

Released `floe-native-apps` owns `PreparedViewer`, matching entry documents/static
assets, content digests and capability results. Redeven pins one immutable snapshot
per authorized Xpra sharing session. Runtime or viewer updates can reconnect to
compatible surviving applications without changing their PID or unsaved content.
Preparation failure is retryable and never selects historical client resources.
Graphical backends and loaded modules keep their process lifetimes; they are not
hot-swapped. The [application contract](host-applications.md) owns authorization and
normal/forced termination, and the [input contract](host-application-input.md) owns
safe input delivery.

# Contract

## Native frames and Xpra snapshots

New combined Linux sessions use the Runtime canvas viewer and the released
native frame/input/cursor protocol. They do not prepare or load an Xpra document.
The macOS and Linux native adapters share frame decoding/generation invalidation
and controller binding; native menus, codecs and permissions remain platform
adapters. No unsupported picture settings are shown for the Linux PNG stream.
A helper/window generation mismatch discards late pixels and inputs.

The remaining snapshot rules in this concept apply to Xpra sessions.

Redeven requests the published required-host-transport document option. Its
pre-client script inherits the owning viewer's Flowersec constructor, and missing
transport fails closed. The [graphical window transport](graphical-window-transport.md)
contract owns this data path and iframe authority; the upstream retains decoder
workers and all prepared resource integrity rules.

A new share prepares current SDK resources from the current installed original
HTML5 v20/v21 distribution. One reviewed upstream preparation pipeline produces the
entry document and resource snapshot. Existing shares retain their exact bytes;
a new share can adopt a new digest. Redeven never combines a new script set with a
retained backend's entry document, falls back after preparation failure, or reads
a recovered instance's historical `www` as client input.

The application record, original component identity, backend, input modules and
instance directory remain owned by the existing application. Record recovery and
required migrations remain enforced. Historical directories are not deleted or
rewritten during recovery. Fresh backends run without serving HTML. Readiness
checks the backend's existing session identity, independently of viewer files;
first decoded pixels remain the viewer's readiness boundary.

When sharing an Xpra application, current viewer preparation must succeed. A
failed preparation for a surviving application returns
`HOST_APP_VIEWER_PREPARATION_FAILED`; opening the viewer can be retried without
terminating the application. Shared routes, credentials and upgraded sockets are
revoked when the share ends. The snapshot becomes ineligible for resource lookup;
other active shares and the application remain independent.

## Capability and recovery boundary

One SDK result determines which operations are available:

| Result | Redeven behavior |
| --- | --- |
| Current viewer, compatible backend/input | Connect to the surviving app and preserve content |
| Missing, corrupt or unsupported current viewer resources | Report preparation failure and offer retry |
| Display protocol older than 2 | Use logical density; explain the high-resolution limitation |
| Unsupported input or ordered pointer protocol | Disable affected input; retain pictures and local controls |
| Authenticated incompatible process-module registration | Explain saving and normal application exit before reopening |
| Missing input context, temporary focus loss or ordinary disconnect | Preserve existing recovery semantics without inferring a version problem |

Text/input protocol remains version 1. Display version 2 identifies the complete
workarea/DPI configuration; old backends do not gain this capability by loading a
new client. Restarting Redeven processes refreshes runtime/viewer code. It cannot
replace a graphical service or a module already loaded inside an application.

# Boundaries

## Resource authorization and caching

The SDK digest covers actual prepared resource names and bytes, including input
adapters and transformed worker URLs. Only
`/_redeven_proxy/host-application-assets/<digest>/...` permits private immutable
caching, compression and conditional responses. A request requires full permission,
the exact digest and an active share owned by the authenticated user. Remote
port-forward origins must also identify an admitted active host-application share;
codespace, unrelated, expired or unknown origins are rejected. Authorization runs
before cache validators, including after permission revocation.

LAN viewers use the authenticated Env-origin namespace, allowing a new share to
reuse equal resource bytes. Cloud origins retain browser cache partitioning.
Documents, settings, credentials, control responses and denied requests remain
`no-store`. Cached bytes never authorize a connection.

The loopback proxy serves its pinned SDK document and current defaults directly.
Only the graphics WebSocket is forwarded to the retained backend, preserving the
sharing Host and Origin and standard forwarding-header sanitation. Historical
HTML and unversioned asset aliases are unavailable. Document and asset content
therefore cannot diverge through the application's old HTTP resource tree.

# Evidence

- `internal/hostapps/linux.go`, `setup.go`, `manager.go`: current share preparation, component-bound recovery and snapshot lifetime.
- `internal/hostapps/application_proxy.go` and `client_assets_test.go`: matching documents, obsolete path rejection, immutable bytes and per-share revocation.
- `internal/codeapp/appserver/host_applications.go` and `host_application_assets_test.go`: permission, origin, owner, digest and cache authorization.
- `internal/codeapp/appserver/host_application_viewer/viewer.js`: unified capability mapping and retained local controls.
- `internal/hostapps/linux_lifecycle_test.go`: detach, save-dialog cancellation and surviving-process recovery.
