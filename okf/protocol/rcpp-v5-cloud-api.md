---
type: Protocol Contract
title: RCPP v5 Cloud API
description: Single Cloud input, authoritative Access Point assignment, native OAuth and access authorization.
tags: [protocol, cloud, openapi, desktop, runtime, access]
timestamp: 2026-08-28T00:00:00Z
---
# Summary

RCPP v5 separates Cloud authorization from network route. CloudRuntimeBinding owns environment, Runtime identity, Namespace, user or Namespace principal and generation. One Runtime ConnectionController handles direct and Gateway enrollment, registration, heartbeat, reserve maintenance and recovery. Desktop never creates a second credential recovery owner.

# Contract

Cloud discovery and `/api/rcpp/v5` preserve native OAuth, Desktop authorization, environment access and authoritative ticket resolution. Runtime machine entrypoints are `/api/console/v1/runtime-cloud/v5/{challenges,enroll,recover,closure-ack}`. Proof signs the exact payload with domain `redeven.runtime.cloud.rcpp-v5\0`; challenges are single-use and principal-scoped. Only the assigned Region issues control artifacts.

CloudAssociation records intent, an independent Ed25519 identity and exact Cloud binding. CloudRoute records direct or selected Gateway member and a separate revision. Switch preflight checks TLS and membership before confirmation; atomic persistence precedes old-owner cancellation, old-route session closure and reconnect. Failed preflight preserves the working route. A committed switch retains its new route even if connectivity fails. Original operation IDs survive unknown responses; cancellation never hides a committed result.

Online Runtime uses control RPCs for heartbeat and reserve maintenance. Without a registered channel, identity-valid recovery checks at 30-second intervals; pending and revoked approval never connect using old artifacts. Successful reapproval automatically resumes existing valid intent. Identity expiry, ownership changes and protocol errors require explicit action. Cloud closure uses RPC 41009 and durable machine-signed receipts. A partition is not evidence of completed closure; existing data sessions remain independent of ordinary control outages.

Runtime config version 1 rejects old or unknown contracts read-only and directs the operator to create a fresh state root and enroll. Compatibility epoch 58 fences clients. Enrollment journals preserve independent keys, original operation IDs and separate delivery IDs before network effects; expired tickets can resume submitted enrollment through signed recovery. Desktop/CLI show approval, actual connection, route and next attempt separately, with retry, approval management, disconnect intent and route operation query/confirmation/cancel.

Account sign-out only clears Desktop authorization and cached environment access; it does not change Runtime machine intent or Cloud binding. Browser access still requires current user permission. Runtime password, MFA, custom Tunnel and Namespace machine authorization remain separate boundaries. Runtime and Desktop use published Flowersec 5.11.0 only.

# Boundaries

Gateway owns members, invitations, local access, egress admission and forwarding resources. Its management registration and member versions do not determine an approved Runtime's continuing Cloud authorization. Gateway denial/remove/stop affects only its route and preserves Cloud authorization. Cloud revocation preserves independent local membership. No redirect, cached authority, direct fallback, binding migration or Gateway closure relay remains.

# Evidence

- `internal/runtimecloud/client.go:1` - Independent signed machine enrollment and recovery.
- `internal/config/cloud_association.go:1` - Intent, identity, binding and selected route.
- `internal/agent/runtime_cloud.go:1` - Sole recovery source and owner fences.
- `internal/agent/cloud_route.go:1` - Atomic confirmed route coordinator.
- `internal/agent/cloud_closure.go:1` - Matching generation closure and durable receipt.
- `desktop/src/welcome/RuntimeCloudConnections.tsx:1` - Explicit route and recovery exits.
- `spec/openapi/rcpp-v5.yaml:1` - Current machine-readable RCPP contract.
