---
type: UI Contract
title: Tessiven canvas
tags: [ui, tessiven, graph]
quality_exception: Cross-surface canvas interaction contract for Activity, standalone windows, topology browsing, and exact object actions; document, Runtime, and Flower lifecycle remain separately owned.
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Tessiven maps services to Runtime cards, tinted groups and distinct external dependencies. Root connections give overview; focus reveals local relationships. Canvas owns pan/zoom while details remain selectable. Flower edits documents; the canvas progressively presents them without a parallel manual editor.

# Contract

The Connected environments panel and Runtime node details follow the [scoped Runtime operations contract](../ai/tessiven-runtime-operations.md).

Browsers retain popup-blocking feedback, and native refusal or failure remains visible through localized command feedback without starting another opening path.

Separate responsibilities   include cloud controllers, node agents, container runtimes, network plugins,   service meshes, ingress, operators, registries, observability, identity, secret   and certificate services, streaming, and metadata; repeated instances of the   same responsibility keep the same icon.

# Boundaries

The iOS host bundles the shared TessivenGraph and the published Floe graph engine as fixed application resources.

The data-only bridge reports loading, rendered, failure, or an immutable object selection; iOS validates the canvas, version and referenced objects before opening native details or Flower.

Ask Flower focuses the canvas composer and never sends a message automatically.

## Explicit Group Packing
The shared document-to-graph mapper passes only visible container rules from `presentation.groupLayouts` to the published Floe layout API. No additional menu or local layout engine owns these rules.

# Evidence

- `desktop/src/shared/desktopShellServiceCanvasWindowIPC.ts` - Identity-only native request/ACK.

- `desktop/src/main/main.ts` - Session-authorized Service Canvas window creation and reuse.

- `desktop/scripts/check-service-canvas-window.mjs` - Real Desktop Open/repeat/close/reopen and invalid rejection.
