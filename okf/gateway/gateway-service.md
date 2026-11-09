---
type: Gateway Contract
title: Independent Gateway service
tags: [gateway, security, access]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Gateway independently owns attachment/device admission/relay without Cloud account, cached authority or public Internet. Cloud alone owns membership/organizations/roles. Gateway has no Cloud machine/Namespace/renewal/delegated-publication/command ownership.

# Contract

## Authority ownership
Gateway owns stable identity/client keys/attachments/local policy/transports. Runtime explicitly consents and owns application TLS/password/MFA/sessions/host restrictions. Gateway admin grants no Runtime lifecycle/app authority. Desktop/Web Center own directory/opening and separate client identities; catalogs describe attachments only. Cloud AI gateway is a different endpoint. Verify device/host/application authority independently; coordinates/observations grant none. Runtime may independently enroll Cloud; Gateway outage affects only its traffic.

## Public and private endpoints
One advertised HTTPS origin serves pairing/identity/catalog/app admission, invitation/enrollment/mTLS attachment and optional restricted egress. All origins prove same identity; host restrictions precede protocol. No public management/operation-query routes.

Linux/macOS native packages administer through temporary0700directory/0600Unix socket/private credential, also reached by SSH/container bridge. Loopback/header is not host proof. Windows manages remote/container only; no native Windows/named-pipe addition.

## State and lifecycle
Schema6 owns attachments/policy, epoch70 Gateway wire. Unsupported state/retired cloud-access.json fails before identity creation or rewrite. Desktop connection schema5 migrates locator to connection_id while preserving pinned gateway_id/credentials. Trust schema4 removes host classification but preserves all identities/revocations; it changes neither attachment6 nor connection5. Runtime observation epoch71 does not advance Gateway70.

Explicit host maintenance is independent of client admission/stale service observations. Update/ordinary reinstall replaces package only, preserving config/identity/access; unsupported state fails unchanged, no implicit migration.

Host-only configuration-reset requires explicit existing root,--confirm,stopped service and valid private trust. Archive owned attachment/network/hooks/retired-Cloud/operation config under private configuration-history/reset-*, preserving identity/revocations. Reject unsafe paths before moves. Durable marker fences startup/repeat reset; ordinary failures roll back, uncertainty keeps marker/archive for inspection without replay. Requires reconnect/reconfigure. Desktop separately confirms reset, verifies package before it, then starts/reconnects via host management. No public reset endpoint.

Save/refresh/pairing/attachment never start stopped service implicitly. Removing Desktop registration neither removes attachments nor stops service. Release metadata is diagnostic; Runtime releases cannot change Gateway authority.

# Boundaries

Published Flowersec owns invitation/controller/ByteStream/relay/HTTPS mechanisms; Redeven owns product identity/consent/policy/adapters. No sibling links/copied transport/Go replacements.

# Evidence

internal/gatewayservice/public_endpoint_test.go verifies pairing/public-route exclusion; host_admin_test.go checks socket+credential/spoof denial. cmd/redeven-gateway/configuration_reset_test.go verifies explicit reset/locks/paths/trust/catalog recovery.
