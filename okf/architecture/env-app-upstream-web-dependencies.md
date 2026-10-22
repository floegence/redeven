---
type: Frontend Contract
title: Env App upstream web dependencies
description: Env App composes published floe-webapp, Floeterm, and Flowersec web packages.
tags: [architecture, dependencies, protocol, ui]
timestamp: 2026-10-18T00:00:00Z
quality_exception: Published web dependency and terminal package boundary covering version pins, shell ownership, and renderer-free loading.
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Env App is built as a Redeven-specific shell on top of published floe-webapp UI/runtime primitives, floe-webapp protocol connectivity, Floeterm terminal-web components, and Flowersec controlplane artifact helpers.


Frontend deployment and lazy-import recovery follow [Env App page asset recovery](../ui/page-asset-recovery.md), using Floe's published document asset monitor and per-view error boundary.

# Contract

## Mechanism
Floe owns the loading icon slot, localized intrinsic label reservation, persistent feedback region, and resolved inline-media viewport contracts used by [asynchronous layout stability](../ui/asynchronous-layout-stability.md).

Env App Core v0.86.55 supplies the shared remote-pointer and remote-input controllers used by Host Applications, including bounded motion independent of rendering and explicit local text composition.

[Flower citations](../ui/flower-citations.md#inline-code-references) defines that presentation boundary and its browser acceptance.

# Boundaries

Env App and Desktop use Solid 1.9.17 or newer for patched Seroval serialization.

Redeven may select shell presets and map product permissions, credentials, local-path authority, and placement into upstream contracts, but it must not recreate Floe shell tokens, Flowersec reconnect/framing/RPC behavior, or Floeterm parsing, key encoding, history, attachment arbitration, geometry, Presentation encoding, cursor, graphics, or canvas rendering.

This exact coordinate is reviewed without relaxing the guard for other LGPL dependencies.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Env App pins Floe Webapp Boot, Core, and Protocol v0.86.55; Desktop pins Boot and Core.

- `redeven:internal/envapp/ui_src/src/ui/App.tsx:62` - Env App configures the published shell preset catalog and per-mode defaults.

- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.browser.test.tsx` - Chromium coverage renders CSS Color 4 Mermaid themes and one accessible KaTeX presentation across theme changes.
