---
type: Gateway Contract
title: Independent Gateway service
tags: [gateway, security, access]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Gateway is an independent Runtime attachment, client-device admission and relay service. A fresh Gateway and Runtime work without a Cloud account, cached Cloud authority or public Internet. Cloud membership, organizations and user roles belong only to Cloud. Gateway and Runtime maintain device trust and environment authentication, never a local user directory.

# Contract

## Authority ownership
Gateway owns its stable identity, paired client keys, Runtime attachments, local network policy and active transports. Runtime explicitly consents to each attachment and owns its application TLS identity, environment password/MFA, sessions and host execution restrictions. Gateway administration grants no Runtime lifecycle or application authority. Device access, host administration and Runtime application authorization are independently verified. Desktop and Web Center hold their own client identities; saved host coordinates and client observations confer no management authority.

Gateway has no Cloud machine registration, Namespace assignment, management renewal, delegated Runtime publication or Cloud command receiver. Runtime may independently enroll with Cloud. Gateway failure affects only traffic using that Gateway.

## Public and private endpoints
One advertised HTTPS origin serves client pairing/identity/catalog/application admission, Runtime invitation exchange/enrollment/mTLS attachment, and optional restricted egress. All advertised origins prove one stable Gateway identity. Host restrictions apply before protocol admission. The public handler never mounts management or operation-query routes.

The native Gateway packages support Linux and macOS. Administration uses a temporary private directory (0700), Unix socket (0600), and private host credential. SSH/container bridges reach that same host socket. A loopback TCP address or request header is not host proof. Windows Desktop manages remote/container Gateways; this change does not introduce a native Windows Gateway package or named-pipe implementation.

## State and lifecycle
Gateway state schema 6 owns local attachments and policy; authority epoch 70 owns the independent Gateway wire break. Unsupported attachment state and retired cloud-access.json fail before creating identities or rewriting data. Desktop saved-connection schema 5 migrates its local locator to connection_id while retaining the independently pinned gateway_id and device credentials.

Saving, refresh, pairing and attachment management never implicitly start a stopped service. Removing a Desktop connection does not remove remote attachments or stop its service. Release/build metadata is diagnostic; unrelated Runtime releases do not change Gateway authority.

# Boundaries
Published Flowersec supplies invitation exchange, connection controllers, ByteStreams, relay and HTTPS proxy mechanisms. Redeven supplies product identity, explicit consent, local policy and host adapters. No sibling dependency links, copied transport implementations or Go replacements are used.

# Evidence

- redeven:internal/gatewayservice/public_endpoint_test.go — One public endpoint admits pairing and rejects host routes.
- redeven:internal/gatewayservice/host_admin_test.go — Private socket context plus credential; loopback/header spoof rejection.
- redeven:internal/gatewayservice/server_test.go — Unsupported state remains unchanged.
- redeven:desktop/src/main/gatewayStore.test.ts — Saved registration migration and pinned identity preservation.
