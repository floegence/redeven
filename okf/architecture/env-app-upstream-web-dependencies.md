---
type: Frontend Contract
title: Env App upstream web dependencies
description: Env App composes published floe-webapp, Floeterm, and Flowersec web packages.
tags: [architecture, dependencies, protocol, ui]
timestamp: 2026-10-18T00:00:00Z
quality_exception: Published web dependency and terminal package boundary covering version pins, shell ownership, and renderer-free loading.
lifecycle: contract
reviewed_at: "2026-10-23"
---
# Summary

Env App adapts published floe-webapp UI/runtime and protocol, Floeterm terminal-web, and Flowersec artifact helpers into the Redeven shell.

Pins are Floe Webapp Boot, Core, and Protocol v0.86.60 (Env App Core v0.86.60), Floeterm terminal-web v0.19.2, and Flowersec Core v5.11.1. Floeterm supplies semantic Presentation and session exports.

[Page asset recovery](../ui/page-asset-recovery.md) uses Floe's document asset monitor and per-view error boundary for deployment and lazy imports.

# Contract

## Mechanism

CodeSpace and Web Service modules own their styles. Vite loads these with lazy
page chunks; the root stylesheet avoids duplicate imports to retain the initial CSS budget.

Floe owns loading icons, intrinsic localized label space, persistent feedback and resolved inline-media viewports; see [layout stability](../ui/asynchronous-layout-stability.md).

Core supplies Host Applications' remote pointer/input controllers with render-independent bounded motion and explicit local text composition.

[Flower citations](../ui/flower-citations.md#inline-code-references) owns citation presentation and browser acceptance.

# Boundaries

Env App and Desktop use Solid 1.9.17 or newer for patched Seroval serialization.

Matching npm/pnpm overrides and locks require Zod 4.6.7 or newer within major 4,
including Floebrowser's transitive validator.

Redeven owns adapters for shell presets, permissions, credentials, local-path authority and placement. Upstream retains Floe shell tokens, Flowersec reconnect/framing/RPC, and Floeterm parsing, key encoding, history, attachment arbitration, geometry, Presentation encoding, cursor, graphics and canvas rendering.

Reviewed coordinates do not relax guards for other LGPL dependencies.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Published pins and matching overrides.

- `redeven:internal/envapp/ui_src/src/ui/App.tsx:62` - Shell preset catalog and per-mode defaults.

- `redeven:internal/envapp/ui_src/src/ui/file-markdown/FileMarkdown.browser.test.tsx` - CSS Color 4 Mermaid themes and accessible KaTeX across theme changes.
