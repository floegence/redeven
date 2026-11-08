---
type: UI Contract
title: Tessiven canvas navigation, relationships and Flower reading
tags: [ui, tessiven, graph]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Published Floe owns graph layout, routing and viewport paint; Tessiven supplies canonical topology and selectable details. Browsers retain popup-blocking feedback, and native refusal or failure remains visible through localized command feedback without starting another opening path.

# Contract

## Canvas surfaces
The Connected environments panel and Runtime node details follow the [scoped Runtime operations contract](../ai/tessiven-runtime-operations.md#runtime-operations).

Separate responsibilities include cloud controllers, node agents, container runtimes, network plugins, service meshes, ingress, operators, registries, observability, identity, secret and certificate services, streaming, and metadata; repeated instances of the same responsibility keep the same icon.

## Navigation and rendering
### Layout and routing
Automatic layout and library thumbnails use the same published Floe layout engine, direction, layers, and visibility projection. Saved positions guide ordering within a layer and never override its rank. Positioned objects without relationships still contribute their actual world bounds, so fitting a newly mapped or isolated node keeps it inside the viewport.

### Connection scopes
Default browsing shows one directed overview connector per root endpoint pair. Group-internal relationships remain in the canonical pool overview and never create a group self-loop.

The interactive overview and library thumbnails always paint the root overview, even while the main canvas shows a focused host's detailed paths.

### Controls and rendering
- Canvas controls expand or collapse all logical groups in one compact reflow. They preserve the selected visible object, or its enclosing group when hidden, and never create a document version. Large-graph qualification measures actual host counts, including groups of ten so a thousand-host fixture never silently measures only aggregate cards.

## Relationship summaries
### Group summaries
Patterns use ordered canonical endpoint identities, endpoint granularity, relationship kind, exact protocol and locality.

Main graph and thumbnail share this projection; raw relationship volume never expands every group's top padding.

### Interaction and details
Hover and keyboard focus never open a popup.

No list is silently truncated to 100 references.

## Flower replies
### Reading surface
The window uses the theme's main reading surface continuously across its titlebar, transcript and composer surroundings. A subtle border and shadow frame compact readable message spacing; canvas nodes must not bleed through reply text.

End padding keeps the final choice fully readable when scrolled to the bottom; the action controls remain outside the fade.

### Actions and continuity
Each canvas keeps multiple Flower conversations and marks exactly one active.
The More menu offers a new conversation and history with an explicit active
indicator alongside settings, subagents, available Computer actions and files.
Selecting a history item activates it before opening its composer. Creating a
draft does not replace the active conversation until canonical admission; users
can return to the current conversation without losing its draft. Answers retain
copy, export and explicit fork actions. Desktop and Env App share the contract.
Known ongoing execution disables switching/new-conversation controls; the server
also rejects stale requests while active root or child work remains. Busy failures
stay visible without changing the selection. Stop/settle the current work before
activating another conversation; selection never implicitly cancels work.

Canvas live metadata owns the active identity across windows. Late acceptance
receipts refresh that metadata instead of posting another selection, so an older
receipt cannot steal activation. Canvas changes, reply visibility and late
receipts preserve pending drafts.
Ordinary navigation cannot render a canvas transcript,
including a stale direct ThreadID navigation request or live receipt.
Existing-thread runtime content waits for product metadata; a new conversation's
provisional receipt retains its submitted canvas ownership.

Messages, tool disclosures, questions, approvals and errors remain canonical.

Existing canvases open the combined window directly.

# Boundaries

The iOS host bundles the shared TessivenGraph and the published Floe graph engine as fixed application resources.

The data-only bridge reports loading, rendered, failure, or an immutable object selection; iOS validates the canvas, version and referenced objects before opening native details or Flower.

Ask Flower focuses the canvas composer and never sends a message automatically.

### Explicit Group Packing
The shared document-to-graph mapper passes only visible container rules from `presentation.groupLayouts` to the published Floe layout API. No additional menu or local layout engine owns these rules.

The saved canvas contract owns topology and versions; these browsing controls change only the visible scene. Tessiven does not replace worker failures with guessed routes or use viewport culling to alter the complete inspectable model.

Native hosts use the same summary browser and retain the existing single-object selection callback when an exact relationship is selected. The native renderer loads the published Floe foundation stylesheet as well as graph styles; shared floating layers must retain their positioning utilities.

Canonical endpoint indexes and Set-based deduplication bound repeated-call aggregation without a second persisted graph or local router.

### Product verification
Component rendering and an HTTP 200 from a frontend development server do not qualify a connected Env App.

Both surfaces send a Flower turn, display the canonical streamed reply and exercise the reply menu in the compact window.

It never attaches to an existing user browser or Runtime.

# Evidence

- `desktop/src/shared/desktopShellServiceCanvasWindowIPC.ts`
- Identity-only native request/ACK.
- `desktop/src/main/main.ts`
- Source.
- Real Desktop Open/repeat/close/reopen and invalid rejection.
- Tests.

- Source.
- Source.
- Source.

- Source.
- Source.
