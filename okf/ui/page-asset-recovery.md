---
type: Frontend Contract
title: Env App page asset recovery
tags: [ui, recovery, assets, dependencies]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floe compares assets/isolates views; Redeven supplies secure authenticated trigger, copy and explicit reload. Connected Runtime does not prove old modules usable. Import/build changes expose recovery within content; never reload over drafts or move native/shell controls.

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

- `redeven:internal/envapp/ui_src/src/ui/reconnect/createEnvAppAssetRecovery.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Source.
