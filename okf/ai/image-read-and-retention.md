---
type: AI Media Contract
title: Direct image reading and tool media retention
description: Authorized image reads produce immutable native model attachments with canonical retention and preview membership.
tags: [ai, tools, images, media, security]
timestamp: 2026-10-17T00:00:00Z
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

The shared read-only tool checks model image capability, `CanRead`, filesystem
scope and `ToolTargetPolicy`. An explicit unavailable target fails rather than
using another device. Local and routed results follow the same snapshot path.
PNG, JPEG, WebP and GIF are detected from actual bytes; file extensions are not
authority. Files are at most 10 MiB, each side at most 16,384 pixels and the
image at most 32 megapixels. Resolution is preserved. GIF explicitly returns
its first frame as PNG. Damage, limits, cancellation and permission failures
return actionable tool errors without admitting an image descriptor.

Only typed executor attachments supply native image parts. Floret retains the
descriptor and resolves it through the same provider preparation boundary as
uploaded images and screenshots. Ordinary JSON, path text and opaque strings
cannot create model or preview authority. Text file tools retain their existing
contract. A model that cannot read images gets an explicit error; switching a
thread with retained image context to such a model returns
`thread_image_model_unsupported`. Flower preserves the current model and keeps
the model picker available for a compatible selection.

Provider wire adapters preserve image parts rather than reducing tool results
to text. OpenAI Responses uses the officially supported typed
`function_call_output.output` content array from the released Go SDK. Its
[function calling contract](https://developers.openai.com/api/docs/guides/function-calling)
allows images and files in tool output. Native image budgeting inspects these
protocol parts and does not count Base64 transport as ordinary text.

## Visual summaries and rereads

Published Floret v7.51.1 projects user and confirmed tool attachments into one
ordered visual compaction input. Each image reaches the selected model as native
image content next to its safe descriptor locator. Full rendered request budgets
include image cost; an image that cannot fit fails explicitly. Frozen transport
retries do not reread bytes. Only complete successful coverage installs a
checkpoint; the domain schema stays 19.

A summary retains task-relevant visual facts, locators and uncertainty, but is
lossy. Exact text, numbers and positions require `image.read(locator)`. Older
images remain discoverable through canonical `threads.query` and paged
`threads.read`, without an unbounded checkpoint catalog. Existing checkpoints
are not rewritten or credited with visual facts that were never generated.

The locator hashes the complete versioned attachment descriptor and remains
stable across restart and fork. It conveys no access rights or storage path.
Preview and reread share product authorization, current canonical membership,
resource resolution, descriptor/size/digest validation and bounded image decoding.
Uploaded images reuse the authorized upload resource; tool and Computer images
reuse the existing media store. No caption store, locator map or second media
lifecycle is introduced. File reads keep their 10 MiB bound; admitted Computer
frames retain their existing 16 MiB bound.

## Immutable bytes and retention

One `toolMediaStore` owns image snapshots and existing Computer keyframes under
the original `computer/keyframes` root. Image identity is
`image://<sha256>/<png|jpeg|webp>`; Computer identity remains unchanged. Digest,
format and byte count are checked on resolution. Changes or deletion of the
source file cannot alter subsequent sends, retry, restart, fork or compaction.
Missing or corrupt bytes fail explicitly without rereading the source.

Floret v7.28.0 `Host.MediaInventory` is the complete retention authority across
archived threads, inactive branches, queue facts and shared fork history.
Descriptors are retention facts, never access credentials. Startup before
activation, periodic maintenance and thread deletion share one collection
entry point. Its media write gate spans inventory acquisition and removal;
ordinary collection requires canonical `Idle`. Active execution defers
collection, and inventory failure retains all bytes. The last canonical owner
releases a snapshot; another retained branch or thread preserves it.

New storage snapshots include tool media. Restoring an old supported snapshot
preserves stopped live media in staged storage; historical restore journals
retain their exact original root list. Staged verification skips collection.
No product or Floret storage schema changes.

## Authorized previews

The resolver is the only membership and endpoint authorization entry point.
It reads product thread ownership and one public canonical view, without the
full product detail mapper. GET
`/threads/<thread>/tool-media/<digest>/<format>` requires an exact canonical
attachment descriptor from either a user message or a confirmed tool result.
The same route accepts `/tool-media/locator/<locator-digest>` for a
`media:v1:<sha256>` descriptor locator. Activity target references are display
requests only. Cross-thread, cross-endpoint and upload-owner access fails.
The response is bounded, uses a closed image MIME set and `no-store`.

Env App and Desktop use authenticated binary transport. Activity and assistant
Markdown use the published Floe media component, localized loading/retry and
shared preview. The browser receives a temporary Blob URL and opaque resource
identity, never a storage path or provider credential.

Expanded image-tool Activity details use the same compact thumbnail as
[Computer screenshots](computer-use-media.md), without a decorative canvas or
separate preview toolbar. Clicking the thumbnail opens the retained image;
loading and retry stay bounded, and collapsing details unmounts the thumbnail.
Assistant Markdown images retain their existing presentation.

# Boundaries

Redeven never queries Floret tables or persists a second media membership
ledger. Uploaded-resource quotas and staging remain governed by
[Flower attachment resources](flower-attachment-resources.md). Computer live
sampling and control remain governed by [Computer media](computer-use-media.md).
Model attachment history and compaction remain upstream-owned.

# Evidence

- [Shared image tool](../../internal/ai/image_read.go)
- [Typed tool boundary](../../internal/ai/floret_tools.go)
- [Canonical image resolver](../../internal/ai/canonical_image.go)
- [Upload reread and authorization tests](../../internal/ai/image_locator_test.go)
- [Canonical preview authority](../../internal/ai/tool_media_authority.go)
- [Shared retention](../../internal/ai/tool_media_cleanup.go)
- [Native provider, restart and fork tests](../../internal/ai/image_read_integration_test.go)
- [Snapshot and old restore coverage](../../internal/ai/tool_media_restore_test.go)
- [Compacted canonical image coverage](../../internal/ai/tool_image_compaction_test.go)
- [Activity preview and model recovery](../../internal/envapp/ui_src/src/ui/FlowerSurface.toolImage.browser.test.tsx)
- [Isolated real Runtime qualification](../../internal/envapp/ui_src/scripts/checkFlowerSendImageRuntime.mjs)
