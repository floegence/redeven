---
type: Architecture Contract
title: Independent Web Environment Center
tags: [architecture, desktop, gateway, web]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop combines an environment center with its existing local Runtime lifecycle. Web Center deploys independently; Runtime never requires Center or Desktop to start. Both hosts share Contracts/Core/Controller/UI. Web Center has one administrator, with no registration, users, roles, organizations or user ACL service.

# Contract

## Shared behavior and host ownership
Shared desktop/src/envcenter owns routes/search/filter/recovery/order/cancellation/Gateway lists. Desktop adapter calls existing lifecycle/windows; Web calls Center HTTP/browser tabs. Shared code imports neither Electron/Node filesystem nor Web auth. Desktop never contacts Center or changes Welcome/navigation/preparation/shutdown. Config/secrets do not sync. cmd/center-contracts generates exact DTO/TS/schema bounds.

Labels/hostnames grant no trust. Revisions/sequences fence observations; late completion cannot navigate canceled pending tabs or cancel open route owners. Refresh reads authority, not new intent.

## Server entry
Portal, Env and each child use distinct HTTPS origins under one registrable domain/port with matching TLS. Bookmarks are direct. Clipboard denial/absence retains descriptor/manual localized selection; announce success only after actual write.

Center pairs as access-only Gateway after fingerprint confirmation. Runtime independently persists consent through redeven web-binding apply --stdin --yes, binding RuntimeID/origin/clientSPKI/scope/revision. Published Flowersec mutually authenticated TLS1.3 pins signed Runtime service; no inbound app TCP listener.

Operations bind device/route. Browser nonce/exact origins/bounded redemption/single-use code complete handoff; response-loss same-request retry recovers one outcome. Host-only cookies never replace Runtime password/MFA. Logout/security/source/route revocation cancels derived admissions/streams.

## Runtime and child applications
webbinding owns consent, webconnector pinned TLS, environmentcenter admin/directory/proxy. Deployment requires separate stateless Connector via Unix socket with exact peer UID before credentials. Worker holds admitted route credentials only; Center retains admin/factors/master key. Direct adapter is test-only, never deployment fallback.

Control connection owns worker lease; Center loss/logout/revocation closes all streams. Connector restart loses leases; next request requires fresh valid admission. Never replay business HTTP. Systemd/Compose use distinct unprivileged identities; Connector cannot read Center state/TLS keys. IPC preserves bounded permission/capacity/compatibility/offline codes; Runtime payloads cannot invent worker errors. Published controller retries only explicit transient Gateway admission conflicts; invalid/denied/revoked proofs terminate.

Services/editor/graphical viewers use resource origins; trusted proxy retains parent credentials. Editor pins running instance. Graphical access requires scoped Flowersec. Child framing follows authenticated Runtime policy for editor workers; Portal denies framing.

## Plugin application origins
Authenticated parent operations prepare/revoke origins under shared pending/active capacity. Duplicate pending origin is busy; failed/canceled probes release reservation. DELETE fences pending work so late probes cannot revive/replace generations. Each child binds parent route/Runtime admission and cannot call management APIs. Gateway certificates/CONNECT enforce exact namespace/target. Desktop credentials attach only to trusted parent frame.

# Boundaries

Center is trusted with plaintext application traffic. This is not browser-to-Runtime encryption against Center. Forwarded headers, loopback, SSH tunnels and browser-supplied headers cannot create management authority.

Web v1 does not implement Desktop SSH/WSL/local preparation, Cloud aggregation or local account/model delegation. Existing Desktop capabilities retain their owners. Remote terminal/files/Git/monitoring/container/Flower and graphical capabilities retain ordinary Runtime permissions and platform conditions.

# Evidence

- `desktop/tests/envCenterContract.test.ts`: host contracts, ordering, cancellation and dependency boundaries.
- `internal/localui/web_entry_transport_test.go`: actual Gateway, no target TCP listener and scoped Runtime admission.
- `internal/localui/center_browser_test.go` and `scripts/check_center_browser.mjs`: actual browser and optional physical/capacity qualification.
- [Center security](../security/web-center-access.md) and [deployment](../operations/web-center-deployment.md) own detailed policies.
