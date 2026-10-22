---
type: Frontend Contract
title: Env App page asset recovery
description: Recover stale or interrupted page modules after Runtime connectivity returns.
tags: [ui, recovery, assets, dependencies]
timestamp: 2026-09-22T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe owns document asset comparison and per-view error isolation. Redeven owns
the authenticated Env App entry route, secure-connection trigger, localized
presentation, and explicit reload action. A connected Runtime does not prove
that an already loaded browser document can still fetch its page modules.
Changed builds and failed module loads must expose recovery rather than an
endless loading placeholder. Detection never reloads over unsaved work.
Recovery notices stay inside the active mode's content area, below the unchanged
shell header and native window controls.

# Contract

## Detect the deployed frontend
Env App captures the loaded document's ESM entry URLs through Floe's published `createDocumentAssetRecovery`.

Recovery does not retain older bundles, rewrite module names, or return HTML as JavaScript.

## Preserve work and provide a recovery action
An unobtrusive shell notice reports updated or unavailable app content.

This changes no authentication or Desktop process-identity contract.

# Boundaries

Transport readiness does not prove document assets are current or loadable. Build changes and import failures must expose recovery, but detection cannot reload over unsaved work. Redeven retains the authenticated route and explicit user reload action.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/reconnect/createEnvAppAssetRecovery.ts` - Secure-readiness trigger and authenticated document route.

- `redeven:internal/envapp/ui_src/src/ui/reconnect/PageAssetRecovery.tsx` - Localized, non-destructive notice and explicit recovery action.

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Activity isolation and Workbench content boundary.
