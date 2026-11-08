---
type: Gateway Contract
title: Independent Gateway service
tags: [gateway, security, access]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Gateway independently owns Runtime attachment/device admission/relay, working without Cloud account, cached authority or public Internet. Cloud alone owns membership/organizations/roles. Gateway has no Cloud machine registration, Namespace assignment, management renewal, delegated Runtime publication or Cloud command receiver.

# Contract

## Authority ownership
Gateway owns its stable identity, paired client keys, Runtime attachments, local network policy and active transports. Runtime explicitly consents to each attachment and owns its application TLS identity, environment password/MFA, sessions and host execution restrictions. Gateway administration grants no Runtime lifecycle or application authority. Desktop and Web Center provide the environment directory and opening experience; Gateway catalogs only describe attached Runtimes. The authorized platform model gateway is a separate Cloud AI endpoint, not this service. Device access, host administration and Runtime application authorization are independently verified. Desktop and Web Center hold their own client identities; saved host coordinates and client observations confer no management authority.

Runtime may independently enroll with Cloud. Gateway failure affects only traffic using that Gateway.

## Public and private endpoints
One advertised HTTPS origin serves client pairing/identity/catalog/application admission, Runtime invitation exchange/enrollment/mTLS attachment, and optional restricted egress. All advertised origins prove one stable Gateway identity. Host restrictions apply before protocol admission. The public handler never mounts management or operation-query routes.

The native Gateway packages support Linux and macOS. Administration uses a temporary private directory (0700), Unix socket (0600), and private host credential. SSH/container bridges reach that same host socket. A loopback TCP address or request header is not host proof. Windows Desktop manages remote/container Gateways; this change does not introduce a native Windows Gateway package or named-pipe implementation.

## State and lifecycle
Gateway state schema 6 owns local attachments and policy; authority epoch 70 owns the independent Gateway wire break. Unsupported attachment state and retired cloud-access.json fail before creating identities or rewriting data. Desktop saved-connection schema 5 migrates its local locator to connection_id while retaining the independently pinned gateway_id and device credentials.

Trust schema 4 removes historical host classification while preserving every device identity and revocation. Attachment schema 6 and saved-connection schema 5 do not change. Runtime epoch 71 owns its new observation response; it does not advance Gateway epoch 70.

Explicit host maintenance is independent of client-device admission and prior service observations. Update and ordinary reinstall replace only the managed package, preserving configuration, identity and client access. Unsupported state still fails unchanged; reinstall is never an implicit schema migration.

Host-only configuration-reset requires an explicit existing state root, --confirm, a stopped service and valid existing private trust file. It archives Gateway-owned attachment, network/policy-hook, retired Cloud and host-operation configuration under a private configuration-history/reset-* directory, retaining device identity and revocations. Unsafe paths fail before moving files. A durable reset marker fences startup and repeat reset during interrupted file moves. Ordinary move failures roll back; uncertain failures retain the marker/archive for host inspection, never automatic replay. Reset requires reconnecting Runtimes and configuring network policy. Desktop exposes it as a separately confirmed reinstall option, prepares and verifies the package before reset, then starts and reconnects through host management. No public endpoint can invoke it.

Saving, refresh, pairing and attachment management never implicitly start a stopped service. Removing a Desktop connection does not remove remote attachments or stop its service. Release/build metadata is diagnostic; unrelated Runtime releases do not change Gateway authority.

# Boundaries
Published Flowersec supplies invitation exchange, connection controllers, ByteStreams, relay and HTTPS proxy mechanisms. Redeven supplies product identity, explicit consent, local policy and host adapters. No sibling dependency links, copied transport implementations or Go replacements are used.

# Evidence

- redeven:internal/gatewayservice/public_endpoint_test.go — One public endpoint admits pairing and rejects host routes.
- redeven:internal/gatewayservice/host_admin_test.go — Private socket context plus credential; loopback/header spoof rejection.

- redeven:cmd/redeven-gateway/configuration_reset_test.go — Explicit recovery, lock/path rejection, retained trust and recovered host catalog.
