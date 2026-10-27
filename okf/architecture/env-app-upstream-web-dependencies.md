---
type: Frontend Contract
title: Env App upstream web dependencies
description: Env App composes published floe-webapp, FloeBrowser, Floeterm, and Flowersec packages.
tags: [architecture, dependencies, protocol, ui]
timestamp: 2026-10-18T00:00:00Z
quality_exception: Published web dependency and terminal package boundary covering version pins, shell ownership, and renderer-free loading.
lifecycle: contract
reviewed_at: "2026-10-27"
---
# Summary

Env App adapts published floe-webapp UI/runtime and protocol, FloeBrowser projection, Floeterm terminal-web, and Flowersec artifact helpers into the Redeven shell.

Pins are Floe Webapp Boot, Core, and Protocol v0.86.63 (Env App Core v0.86.63), FloeBrowser v0.1.28, Floeterm terminal-web v0.19.2, and Flowersec Core v5.11.1. Floeterm supplies semantic Presentation and session exports.

[Page asset recovery](../ui/page-asset-recovery.md) uses Floe's document asset monitor and per-view error boundary for deployment and lazy imports.

# Contract

## Mechanism

CodeSpace, Web Service and service-template catalog modules own their styles.
Vite loads feature styles with their lazy page chunks. Resource presentation
components import their shared header stylesheet; the root stylesheet does not
duplicate these imports. Every document retains the enforced 122 KiB gzip
initial CSS budget, including Desktop development builds.

Floe owns loading icons, intrinsic localized label space, persistent feedback and resolved inline-media viewports; see [layout stability](../ui/asynchronous-layout-stability.md).

Core supplies Host Applications' remote pointer/input controllers with render-independent bounded motion and explicit local text composition.

[Flower citations](../ui/flower-citations.md#inline-code-references) owns citation presentation and browser acceptance.

# Boundaries

Env App and Desktop use Solid 1.9.17 or newer for patched Seroval serialization.

Matching npm/pnpm overrides and locks require Zod 4.6.7 or newer within major 4,
including FloeBrowser's transitive validator.

FloeBrowser's source host, viewer and native media collector come from the same
published package. Version 0.1.28 retains projection protocol 26 while updating
its recorder, media and validation dependencies. Helper staging retains the
package's collector integrity manifest and verified third-party licenses.

Matching npm/pnpm overrides retain `@rrweb/utils`, `rrdom`, `rrweb` and
`rrweb-snapshot` at 2.1.7 alongside FloeBrowser's record, replay and types packages.
This preserves dynamic iframe input/projection behavior and one version per
runtime package in immutable helper staging; rrweb 2.2.0 fails that frame contract.

Redeven owns adapters for shell presets, permissions, credentials, local-path authority and placement. Upstream retains Floe shell tokens, FloeBrowser DOM/media projection, Flowersec reconnect/framing/RPC, and Floeterm parsing, key encoding, history, attachment arbitration, geometry, Presentation encoding, cursor, graphics and canvas rendering.

Reviewed coordinates do not relax guards for other LGPL dependencies.

# Evidence

- `redeven:internal/envapp/ui_src/package.json` - Published pins and matching overrides.

- `redeven:internal/envapp/ui_src/scripts/computerBrowserSource.node-test.mjs` - Published source adapters retain navigation grants, user ownership and shared debugger identity.
