---
type: Gateway Contract
title: Gateway client access
description: Derive management from verified host access and enroll URL clients without administrator grants.
tags: [gateway, desktop, access, identity]
timestamp: 2026-10-08T00:00:00Z
---
# Summary

Gateway exposes two fixed paths: verified host administration and environment-only URL access. Clients cannot choose roles or persist management authority. Runtime lifecycle and application authentication remain independent; Cloud operations still require Cloud authorization.

# Contract

## Host administration

Local, SSH, local-container and SSH-container connections acquire management only after actually reaching the target Gateway and verifying its private host credential. The target-host bridge reads that existing credential and injects it into Gateway protocol requests delivered over loopback. It never exposes the credential to Renderer, URL connections, Runtime channels or logs. Connection-kind strings, bridge markers and saved permissions are not authorization sources.

The service computes management from the current request's host proof. A signed host request must also pass normal client signature validation and retains its real client identity. Invalid signatures cannot fall back to unsigned CLI authority. The private host CLI may make unsigned requests when no client-signing headers are present.

Desktop connection changes must verify the pinned Gateway identity through the new connection before saving. Host-connected clients are managed through their host permissions, not through the URL client list. Removing a Desktop connection does not stop or delete the Gateway service.

## URL enrollment and reconnection

Administrators create client access codes through POST `/gateway/v5/clients/access-codes` or `redeven-gateway clients access-code`. Each code expires after ten minutes and is single-use. The store persists only its digest, expiry and consuming client identity. Enrollment atomically binds a valid code to one client public key. An identical completion retry returns the original result after response loss; other clients cannot consume that code. Existing valid client keys reconnect without another code.

URL clients can list and open the environments provided by Gateway, subject to existing access policy and independent Runtime authentication. Electron main and Gateway both reject URL management requests, including forged legacy permissions. Static `--pairing-code`, caller-selected registration permissions and the Desktop role editor are removed.

Runtime invitations are separate: they authorize Runtime membership and still require local Runtime administrator consent. A client access code neither enrolls a Runtime nor grants Gateway administration.

## Client visibility and revocation

Host administrators list clients through POST `/gateway/v5/clients/list` or `redeven-gateway clients list`. The display name is a recognition label, never identity evidence. Records expose enrollment and recent verified access times without credentials.

POST `/gateway/v5/clients/revoke` and `redeven-gateway clients revoke --client ID` persist revocation before acknowledgment. Revoked clients cannot make new signed requests, redeem pending connection tickets, or finish establishing an access session. Existing access sessions for that client are canceled immediately. Other clients, Runtime member connections and Cloud bindings remain unchanged. Revocation survives restart.

## State and compatibility

Trust schema 3 retains Gateway and client keys, preserves previously allowed environment access and removes legacy management grants. Previously denied clients remain denied. Existing host registrations regain management only through fresh host verification, while authorized URL clients keep their existing keys. Gateway/Desktop compatibility epoch 43 rejects the old authority handshake; Runtime membership remains v5 with its signed multi-endpoint model unchanged.

# Evidence

- `redeven:internal/runtimegateway/trust/access_code_lifecycle_test.go` — Expiry, atomic consumption, response-loss retry, persistence and migration.
- `redeven:internal/gatewayservice/client_authority_test.go` — Service-side management rejection and signed host identity preservation.
- `redeven:internal/gatewaymembership/reverse_access_test.go` — Live session cancellation, pending-ticket denial and unaffected other clients and Runtime connections.
- `redeven:desktop/scripts/check-gateway-host-authority.mjs` — Real local, SSH, container and SSH-container management plus denied host and URL revocation.
- `redeven:spec/openapi/gateway-v5.yaml` — Shared request/response and host-only management contract.
