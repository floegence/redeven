---
type: Protocol Contract
title: RCPP v5 Cloud API
tags: [protocol, cloud, openapi, desktop, runtime, access]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

RCPP v5 separates Cloud authority from route. CloudRuntimeBinding binds Environment/Runtime/Namespace/principal/generation. One Runtime controller owns direct/Gateway enrollment, registration, heartbeat, reserve and recovery; Desktop never duplicates credential ownership.

# Contract

Cloud discovery and `/api/rcpp/v5` preserve native OAuth, Desktop authorization, environment access and authoritative ticket resolution.

Runtime and Desktop use published Flowersec 5.11.1 only.

# Boundaries

Gateway owns Runtime attachments, invitations, local access, egress admission and forwarding resources. No redirect, cached authority, direct fallback, binding migration or Gateway closure relay remains.

# Evidence

- `internal/runtimecloud/client.go:1` - Source.

- `internal/config/cloud_association.go:1` - Source.

- `internal/agent/runtime_cloud.go:1` - Source.
