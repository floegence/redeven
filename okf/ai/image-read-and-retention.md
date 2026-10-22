---
type: AI Media Contract
title: Direct image reading and tool media retention
description: Authorized image reads produce immutable native model attachments with canonical retention and preview membership.
tags: [ai, tools, images, media, security]
timestamp: 2026-10-17T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

`image.read(file_path, target_id)` reads an image directly in every permission
mode. Its exclusive `locator` mode rereads an admitted immutable snapshot in the
current thread without reopening the original file or copying bytes. Redeven
owns authorization and immutable bytes; Floret owns the typed
attachment, model history and canonical membership. File references stay file
references. The tool creates native image content without a browser, temporary
HTTP server, path-to-image inference or Base64 in ordinary result JSON.

# Contract

## Authorized reads
The shared read-only tool checks model image capability, `CanRead`, filesystem scope and `ToolTargetPolicy`. An explicit unavailable target fails rather than using another device.

Native image budgeting inspects these protocol parts and does not count Base64 transport as ordinary text.

## Visual summaries and rereads
Published Floret v7.51.1 projects user and confirmed tool attachments into one ordered visual compaction input. Full rendered request budgets include image cost; an image that cannot fit fails explicitly.

File reads keep their 10 MiB bound; admitted Computer frames retain their existing 16 MiB bound.

## Immutable bytes and retention
One `toolMediaStore` owns image snapshots and existing Computer keyframes under the original `computer/keyframes` root. Changes or deletion of the source file cannot alter subsequent sends, retry, restart, fork or compaction.

No product or Floret storage schema changes.

## Authorized previews
The resolver is the only membership and endpoint authorization entry point. It reads product thread ownership and one public canonical view, without the full product detail mapper.

Assistant Markdown images retain their existing presentation.

# Boundaries

Redeven never queries Floret tables or persists a second media membership ledger. Model attachment history and compaction remain upstream-owned.

# Evidence

- [Shared image tool](../../internal/ai/image_read.go)

- [Typed tool boundary](../../internal/ai/floret_tools.go)

- [Canonical image resolver](../../internal/ai/canonical_image.go)
