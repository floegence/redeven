---
type: Security Contract
title: Permission policy and filesystem scope
tags: [security, permissions, filesystem, runtime]
lifecycle: contract
reviewed_at: "2026-10-28"
---
# Summary

Runtime policy is authoritative even after control-plane session authorization. Repository-rule discovery and delivered-file reads use Registry.OpenRead. It resolves current policy, rechecks the selected root, walks canonical components through pinned os.Root handles, rejects substituted symlinks and compares opened identities before returning a descriptor.

# Contract

## Mechanism
The local permission policy is a three-bit read/write/execute cap.

Explicitly configured read-only roots remain read-only; session caps, canonical path boundaries, and host filesystem permissions still constrain every operation.

Redeven persists only product authorization audit and does not maintain an approval queue, receipt, generation, revision, or recovery lifecycle.

## Descriptor-based reads

Metadata comes from that descriptor. A previously authorized pathname is not a reusable read capability.

# Boundaries

Files path entry follows the shared [absolute filesystem navigation contract](../ui/filesystem-picker-navigation.md#product-presentations).

Browser state, display-only Home hints, provider metadata, and UI affordances cannot widen runtime permissions.

Provider wire configuration may enable multi-call generation, but it cannot grant permission, bypass approval, or alter runtime scheduling.

# Evidence

- `redeven:internal/config/permission_policy.go:11` - Source.
- `redeven:internal/filesystemscope/registry.go` and `redeven:internal/filesystemscope/registry_test.go`
