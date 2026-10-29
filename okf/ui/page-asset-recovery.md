---
type: Frontend Contract
title: Env App page asset recovery
tags: [ui, recovery, assets, dependencies]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe owns asset comparison/view isolation; Redeven owns authenticated entry, secure trigger, localization and explicit reload. Connected Runtime does not prove old page modules still load. Changed builds/import failures expose recovery instead of endless placeholders. Never reload over drafts; notices stay inside active content below unchanged shell/native controls.

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

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Activity isolation and Workbench content boundary.
