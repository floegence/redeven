---
type: Protocol Contract
title: RCPP v5 Cloud API
tags: [protocol, cloud, openapi, desktop, runtime, access]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

RCPP v5 separates Cloud authorization from network route. CloudRuntimeBinding owns environment, Runtime identity, Namespace, user or Namespace principal and generation. One Runtime ConnectionController handles direct and Gateway enrollment, registration, heartbeat, reserve maintenance and recovery. Desktop never creates a second credential recovery owner.

# Contract

Cloud discovery and `/api/rcpp/v5` preserve native OAuth, Desktop authorization, environment access and authoritative ticket resolution.

Runtime and Desktop use published Flowersec 5.11.0 only.

# Boundaries

Gateway owns members, invitations, local access, egress admission and forwarding resources. No redirect, cached authority, direct fallback, binding migration or Gateway closure relay remains.

# Evidence

- `internal/runtimecloud/client.go:1` - Independent signed machine enrollment and recovery.

- `internal/config/cloud_association.go:1` - Intent, identity, binding and selected route.

- `internal/agent/runtime_cloud.go:1` - Sole recovery source and owner fences.
