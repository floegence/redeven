---
type: Runtime Contract
title: Product RPC request encoding
description: Redeven codecs construct JSON requests that preserve optional filesystem operation semantics before Flowersec dispatch.
tags: [architecture, rpc, filesystem]
timestamp: 2026-09-15T00:00:00Z
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

List, read, write, mkdir, delete, and copy codecs omit optional fields whose
values are undefined. They retain supplied encodings and explicit boolean
values, including false. File creation writes empty content through the existing
file-write RPC and may omit encoding to use the Runtime's UTF-8 default.

The request object itself must contain only JSON values before entering the
published session RPC API. Product codecs construct that object directly; a
global serialization cleanup layer must not hide malformed requests. Tests
inspect the pre-serialization object because JSON serialization silently drops
undefined object fields.

# Boundaries

[Runtime transport dependencies](runtime-transport-dependencies.md) owns the
shared session and transport lifecycle. This encoding contract changes no RPC
type IDs, response shapes, authorization checks, filesystem scope, or Runtime
defaults. A rejected request does not constitute a completed filesystem effect.
Transport failures with unknown outcomes do not authorize automatic retries.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/codec/fs.ts` - Constructs filesystem requests and conditionally includes optional fields.
- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/codec/fs.test.ts` - Checks omitted, undefined, false, and encoding options before serialization.
- `redeven:internal/envapp/ui_src/src/ui/protocol/redeven_v1/contract.test.ts` - Checks empty-file request and Runtime success response mapping through the product RPC adapter.
- `redeven:internal/fs/service.go` - Authorizes writes and applies default UTF-8 encoding to omitted encoding.
