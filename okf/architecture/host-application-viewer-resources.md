---
type: Architecture Contract
title: Host application viewer resources and layered upgrades
tags: [applications, runtime, security, cache]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Floe Native Apps owns immutable viewer documents/assets/digests/capabilities; Redeven pins one per authorized Xpra share. Compatible apps reconnect after updates without PID/content changes. Preparation failure exposes Retry; backends/modules retain lifetimes without hot swaps.

# Contract

- New combined Linux sessions use native canvas/frame/input/cursor protocols. Xpra pre-client scripts inherit their viewer's Flowersec constructor and fail closed without it. Retiring a share removes snapshot lookup authority without affecting other shares/apps.
- Current compatible viewers reconnect. Missing/corrupt/unsupported assets fail preparation. Display protocol below 2 stays at logical density with an explanation. Unsupported input/pointer disables those controls while preserving pictures/local UI. Authenticated incompatible loaded modules require save/quit/reopen; transient focus/context loss follows normal recovery.

# Boundaries

Digests cover actual resource names/bytes, adapters and transformed worker URLs. Remote origins must identify an active authorized share; reject CodeSpace, unrelated, expired or unknown origins. Documents/assets never fall back to old application HTTP trees. [Applications](host-applications.md) owns authorization/termination and [input](host-application-input.md) owns delivery.

# Evidence

- `internal/hostapps/linux.go`, `setup.go`, `manager.go`: current share preparation, component-bound recovery and snapshot lifetime.

- `internal/hostapps/application_proxy.go` and `client_assets_test.go`: matching documents, obsolete path rejection, immutable bytes and per-share revocation.

- `internal/codeapp/appserver/host_applications.go` and `host_application_assets_test.go`: permission, origin, owner, digest and cache authorization.
