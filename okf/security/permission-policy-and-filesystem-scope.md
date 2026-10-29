---
type: Security Contract
title: Permission policy and filesystem scope
tags: [security, permissions, filesystem, runtime]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven treats endpoint runtime policy as authoritative. Control-plane grants can authorize a session, but the runtime clamps those grants with a local permission policy and file-facing features use explicit filesystem root policy.

Runtime permissions are clamped by local policy and file features are scoped by directory root policy.

# Contract

## Mechanism
The local permission policy is a three-bit read/write/execute cap.

Explicitly configured read-only roots remain read-only; session caps, canonical path boundaries, and host filesystem permissions still constrain every operation.

Redeven persists only product authorization audit and does not maintain an approval queue, receipt, generation, revision, or recovery lifecycle.

# Boundaries

Files path entry follows the shared [absolute filesystem navigation contract](../ui/filesystem-picker-navigation.md#product-presentations).

Browser state, display-only Home hints, provider metadata, and UI affordances cannot widen runtime permissions.

Provider wire configuration may enable multi-call generation, but it cannot grant permission, bypass approval, or alter runtime scheduling.

# Evidence

- `redeven:internal/config/permission_policy.go:11` - PermissionPolicy is the local endpoint cap for session metadata.

- `redeven:internal/filesystemscope/registry.go` and `redeven:internal/filesystemscope/registry_test.go` - Default read/write roots and preservation of explicit read-only policy.
