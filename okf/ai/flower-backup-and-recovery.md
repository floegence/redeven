---
type: Recovery Contract
title: Flower storage recovery and retired backups
tags: [ai, storage, recovery]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Ordinary startup and migrations do not create full Flower backups. Settings exposes runtime status and diagnostics, not obsolete snapshot browsing or restore controls.

# Contract

## Retired automatic snapshots
The public snapshot-list and restore APIs are removed. Successful activation and startup preparation admit one background cleanup of checksum-verified, unprotected automatic snapshots only. Cleanup checks cancellation, refuses a pending replacement journal, pins the snapshot directory, and never traverses links. Unknown, damaged, protected and before-restore records remain unchanged. Cleanup failure cannot block healthy conversations.

No cleanup targets live conversations, uploads, read state, extension configuration, or opaque upstream stores. Filesystem statistics do not certify backups.

## Durable recovery and diagnostics
Previously admitted durable replacements must finish and verify before opening another generation. A failed generation close fences recovery. Abandoned staging retires only after replacement completes.

The diagnostic settings category retains actual runtime status, safe retry/stop, sanitized diagnostics and explicit orphan ownership review. Diagnostics omit conversations, credentials, database contents and uploads. There is no generic deletion API or backup-success claim.

# Evidence

- `redeven:internal/ai/storage_retirement.go` and `storage_retirement_test.go` - Restricted cleanup and preservation checks.
- `redeven:internal/codeapp/appserver/ai_storage_maintenance_test.go` - Retired endpoints reject access.
- `redeven:internal/envapp/ui_src/src/ui/pages/settings/AIReadinessSettingsSection.tsx` - Runtime diagnostic surface.
