---
type: Runtime Contract
title: Product RPC request encoding
tags: [architecture, rpc, filesystem]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Redeven request codecs own product JSON construction; published Flowersec owns
transport validation and dispatch. File creation accepts empty content and
omitted encoding. Absent optional fields must be omitted, while explicit false
and empty content retain their meanings. Invalid request objects fail before
dispatch and require a codec correction, not transport retries or relaxed
validation.

# Contract

## Optional filesystem fields
List, read, write, mkdir, delete, and copy codecs omit optional fields whose values are undefined.

The request object itself must contain only JSON values before entering the published session RPC API. Tests inspect the pre-serialization object because JSON serialization silently drops undefined object fields.

# Boundaries

[Runtime transport dependencies](runtime-transport-dependencies.md) owns the shared session and transport lifecycle. Transport failures with unknown outcomes do not authorize automatic retries.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/codec/fs.ts` - Filesystem RPC includes only provided optional fields.

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/codec/fs.test.ts` - Optional/false/undefined fields checked before encoding.

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/contract.test.ts` - Empty-file request and success response through production RPC.
