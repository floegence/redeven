---
type: Architecture Contract
title: Independent Web Environment Center
description: Share entry behavior between independent Desktop and server hosts.
tags: [architecture, desktop, gateway, web]
timestamp: 2026-10-28T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Desktop combines an environment center with its existing local Runtime lifecycle. Web Center deploys independently; Runtime never requires Center or Desktop to start. Both hosts share Contracts/Core/Controller/UI. Web Center has one administrator, with no registration, users, roles, organizations or user ACL service.

# Contract

## Shared behavior and host ownership

`desktop/src/envcenter` owns exact route identity, search/filter, failure/recovery classification, operation ordering, cancellation and Gateway list presentation. Desktop's adapter invokes its existing main-process lifecycle/window owner; Web invokes Center HTTP and browser tabs. Shared modules cannot import Electron, Node filesystem APIs or Web authentication.

Desktop does not contact Center, acquire Center credentials, or change Welcome layout, default navigation, local preparation preferences or shutdown ownership. Host configuration/secrets do not synchronize automatically. Go DTOs generate TypeScript and JSON schema through `cmd/center-contracts`, including enum/integer bounds.

Labels/hostnames grant no trust. Directory revisions and operation sequences reject stale observations. A canceled pending tab cannot navigate after delayed completion; cancellation preserves an already-open route owner. Refresh reads authority instead of creating another intent.

## Server entry

Portal, each Env and each child application use distinct HTTPS origins on the same registrable domain and port. TLS covers all origins. Browser bookmarks remain explicitly direct links.

Binding descriptor copy is a browser capability, not a network operation. Clipboard denial or absence produces local, localized manual-copy guidance without discarding the descriptor or changing authorization. Keyboard-accessible text selection remains available, and success is announced only after the browser confirms the write.

Center pairs as an access-only Gateway client after fingerprint confirmation. Runtime consent is independently persisted by `redeven web-binding apply --stdin --yes`. Binding pins Runtime ID, exact origin, client SPKI, application scope and revision. Published Flowersec carries mutually authenticated TLS 1.3 to the signed, pinned Runtime service. The target needs no inbound application TCP listener.

Each operation belongs to one administrator device and route. Browser nonce, exact origins, bounded redemption and a single-use code complete handoff. Same-request response-loss retry recovers one outcome. Host-only cookies do not replace Runtime password/MFA. Logout, security changes and source/route revocation cancel derived admissions/streams.

## Runtime and child applications

`internal/webbinding` owns durable consent; `internal/webconnector` composes pinned TLS; `internal/environmentcenter` owns administrator authority, directory and proxy admission. Deployed Center requires a separate state-free Connector process through a local Unix socket. Both peers verify the configured OS UID before exchanging credentials. Only admitted route credentials enter worker memory; administrator state, factors and master key remain with Center. Embedded protocol tests may use the direct adapter; deployed services never silently fall back.

A live control connection owns each worker lease. Center loss, logout or security revocation closes it and every derived stream. Connector restart loses leases; only a still-valid Center admission may establish a fresh lease on the next request. Business HTTP requests are never replayed by this owner. Systemd and Compose use distinct unprivileged identities and deny Connector access to Center state/TLS-key mounts.

IPC preserves bounded machine error codes so permission, capacity, compatibility and offline failures retain shared recovery semantics. Runtime responses cannot inject worker error authority. The published connection controller owns retry timing; only explicit transient Gateway admission conflicts are retryable, while denied/revoked identity and invalid proofs remain terminal.

Services, editor and graphical viewers receive resource-specific origins. Parent Runtime credentials stay in the trusted proxy and never reach child browsers. Editor admission pins the running instance. Raw graphical routes cannot bypass resource-scoped Flowersec. Child responses retain authenticated Runtime framing policy so editor worker iframes work; portal framing remains denied.

# Boundaries

Center is trusted with plaintext application traffic. This is not browser-to-Runtime encryption against Center. Forwarded headers, loopback, SSH tunnels and browser-supplied headers cannot create management authority.

Web v1 does not implement Desktop SSH/WSL/local preparation, Cloud aggregation or local account/model delegation. Existing Desktop capabilities retain their owners. Remote terminal/files/Git/monitoring/container/Flower and graphical capabilities retain ordinary Runtime permissions and platform conditions.

# Evidence

- `desktop/tests/envCenterContract.test.ts`: host contracts, ordering, cancellation and dependency boundaries.
- `internal/localui/web_entry_transport_test.go`: actual Gateway, no target TCP listener and scoped Runtime admission.
- `internal/localui/center_browser_test.go` and `scripts/check_center_browser.mjs`: actual browser and optional physical/capacity qualification.
- [Center security](../security/web-center-access.md) and [deployment](../operations/web-center-deployment.md) own detailed policies.
