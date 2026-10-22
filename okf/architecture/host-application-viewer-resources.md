---
type: Architecture Contract
title: Host application viewer resources and layered upgrades
description: Prepare current immutable viewer snapshots while retaining application and backend lifetimes, and authorize their content-addressed resources.
tags: [applications, runtime, security, cache]
timestamp: 2026-09-27T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
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
New combined Linux sessions use the Runtime canvas viewer and the released native frame/input/cursor protocol.

Its pre-client script inherits the owning viewer's Flowersec constructor, and missing transport fails closed.

The snapshot becomes ineligible for resource lookup; other active shares and the application remain independent.

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

# Boundaries

## Resource authorization and caching
The SDK digest covers actual prepared resource names and bytes, including input adapters and transformed worker URLs. Remote port-forward origins must also identify an admitted active host-application share; codespace, unrelated, expired or unknown origins are rejected.

Document and asset content therefore cannot diverge through the application's old HTTP resource tree.

# Evidence

- `internal/hostapps/linux.go`, `setup.go`, `manager.go`: current share preparation, component-bound recovery and snapshot lifetime.

- `internal/hostapps/application_proxy.go` and `client_assets_test.go`: matching documents, obsolete path rejection, immutable bytes and per-share revocation.

- `internal/codeapp/appserver/host_applications.go` and `host_application_assets_test.go`: permission, origin, owner, digest and cache authorization.
