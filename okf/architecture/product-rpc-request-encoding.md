---
type: Runtime Contract
title: Product RPC request encoding
tags: [architecture, rpc, filesystem]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven codecs construct JSON; Flowersec validates/dispatches. File creation preserves empty content and omitted encoding; absent options stay omitted, explicit false/empty retain meaning. Invalid input fails before dispatch and needs codec repair, not retries or weaker validation.

# Contract

## Optional filesystem fields
List, read, write, mkdir, delete, and copy codecs omit optional fields whose values are undefined.

The request object itself must contain only JSON values before entering the published session RPC API. Tests inspect the pre-serialization object because JSON serialization silently drops undefined object fields.

# Boundaries

[Runtime transport dependencies](runtime-transport-dependencies.md) owns the shared session and transport lifecycle. Transport failures with unknown outcomes do not authorize automatic retries.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/codec/fs.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/codec/fs.test.ts` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/contract.test.ts` - Tests.
