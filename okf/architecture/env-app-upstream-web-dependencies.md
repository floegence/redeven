---
type: Frontend Contract
title: Env App upstream web dependencies
tags: [architecture, dependencies, protocol, ui]
quality_exception: Published web dependency and terminal package boundary covering version pins, shell ownership, and renderer-free loading.
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Env App adapts published Floe UI/runtime/protocol, FloeBrowser projection, Floeterm terminal-web and Flowersec helpers. Manifest/lock pins define the consumed release; Floe owns asset monitoring and per-view recovery, while Redeven supplies authenticated product integration.

# Contract

Pins: Floe Boot/Core/Protocol v0.94.1, FloeBrowser v0.1.28, Floeterm terminal-web v0.20.0, Flowersec Core v5.11.1. Floeterm supplies Presentation/session exports. Floe Select sizes option popups to their content, bounded by the trigger width and viewport. Floe SegmentedControl owns the moving selected face, perceptible travel, production-safe CSS time units, interrupted reversal and accessible labels for compact icon-only presentation. [Asset recovery](../ui/page-loading-continuity.md#asset-recovery) uses Floe monitoring and per-view isolation.

## Mechanism

CodeSpace, Web Service and service-template catalog modules own their styles.
Vite loads feature styles with their lazy page chunks. Resource presentation
components import their shared header stylesheet; the root stylesheet does not
duplicate these imports. Every document retains the enforced 122 KiB gzip
initial CSS budget, including Desktop development builds.

Floe owns instance-based context-source capture, retained reading selection and composable PromptCard toolbar actions. Redeven supplies semantic readers and screenshot authorization.

Floe owns loading icons, intrinsic localized label space, persistent feedback and resolved inline-media viewports; see [layout stability](../ui/page-loading-continuity.md#asynchronous-layout).

Floe owns progress-shimmer paint scheduling during drag and resize. Hosts consume
its published CSS and shared interaction marker; they do not copy its animation
implementation or suppress model output to keep input responsive.

Core supplies Host Applications' remote pointer/input controllers with render-independent bounded motion and explicit local text composition.

[Flower citations](../ui/flower-citations.md#inline-code-references) owns citation presentation and browser acceptance.

# Boundaries

Retain Solid >=1.9.17 and matching npm/pnpm locks/overrides for Seroval >=1.6.11, Zod >=4.6.7 within major 4. Solid alone does not prove transitive fixes. Tailwind Node/Vite 4.3.3 uses the current loader hook. ESLint 10 retains explicit ESLint 9 recommended policy with compatible Solid lint; Desktop tests use ESM extensions. Reviewed Electron/esbuild lifecycle allowlists match pnpm; deny other hooks.

FloeBrowser 0.1.28 bundles host/viewer/media collector at projection protocol 26; retain integrity manifest and verified licenses. Pin @rrweb/utils, rrdom, rrweb and rrweb-snapshot 2.1.7 alongside recorder/replay/types. 2.2.0 fails dynamic-frame input/projection and cannot replace that closed helper graph.

Redeven owns shell presets, permissions, credentials, path authority and placement. Upstream owns Floe tokens, browser DOM/media, Flowersec framing/recovery/RPC and Floeterm parsing/input/history/arbitration/geometry/Presentation/cursor/graphics/rendering. These reviewed coordinates do not waive other LGPL guards.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Source.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserSource.node-test.mjs` - Tests.
