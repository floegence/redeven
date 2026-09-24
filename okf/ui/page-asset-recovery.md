---
type: Frontend Contract
title: Env App page asset recovery
description: Recover stale or interrupted page modules after Runtime connectivity returns.
tags: [ui, recovery, assets, dependencies]
timestamp: 2026-09-22T00:00:00Z
---
# Summary

Floe owns document asset comparison and per-view error isolation. Redeven owns
the authenticated Env App entry route, secure-connection trigger, localized
presentation, and explicit reload action. A connected Runtime does not prove
that an already loaded browser document can still fetch its page modules.
Changed builds and failed module loads must expose recovery rather than an
endless loading placeholder. Detection never reloads over unsaved work.

# Contract

## Detect the deployed frontend

Env App captures the loaded document's ESM entry URLs through Floe's published
`createDocumentAssetRecovery`. Each transition to a connected protocol and ready
secure session checks fresh HTML at `/_redeven_proxy/env/` through the existing
authorized local API fetch adapter. A changed module entry marks the document
as outdated. Runtime version strings are not frontend build identities.

Floe coalesces concurrent checks, bounds reads, aborts on disposal, and observes
Vite import errors. Network failures, redirects, non-HTML responses, and missing
module entries do not prove a new build. There is no extra polling or transport
retry loop. A failed import remains actionable even if a later check finds the
same build, because the existing module loader may retain its rejection.

The runtime continues to embed one build, serve HTML with `no-store`, and serve
content-hashed assets immutably. Missing assets remain 404 responses. Recovery
does not retain older bundles, rewrite module names, or return HTML as JavaScript.

## Preserve work and provide a recovery action

An unobtrusive shell notice reports updated or unavailable app content. It does
not block navigation, remount views, clear drafts, or navigate automatically.
It asks the user to save unsaved work before choosing Reload app. Reload remains
disabled until protocol and secure-session readiness return. This preserves
current work until that explicit action; it does not promise that arbitrary
unsaved editor or plugin state survives a document reload.

Activity pages use Floe's `renderError` boundary outside their loading boundary.
A rejected module replaces its page placeholder with a localized reload action;
other visited pages retain their DOM and input. Workbench content has a matching
error and loading boundary inside its mode shell so header navigation remains
available. The product does not retry a cached lazy import by merely resetting
an error boundary.

Reload uses the existing environment navigation owner: a same-origin Cloud
bootstrap reloads its owning parent; standalone and Desktop documents reload
themselves. This changes no authentication or Desktop process-identity contract.

# Boundaries

Transport readiness does not prove document assets are current or loadable. Build changes and import failures must expose recovery, but detection cannot reload over unsaved work. Redeven retains the authenticated route and explicit user reload action.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/reconnect/createEnvAppAssetRecovery.ts` - Secure-readiness trigger and authenticated document route.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/PageAssetRecovery.tsx` - Localized, non-destructive notice and explicit recovery action.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.tsx` - Activity isolation and Workbench content boundary.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/PageAssetRecovery.browser.test.tsx` - Failed module, retained input, connection readiness, localization, and narrow viewport acceptance.
- `redeven:internal/envapp/ui_src/src/ui/reconnect/createEnvAppAssetRecovery.test.ts` - Reconnection checks and authorization adapter forwarding.
- `redeven:internal/envapp/ui_src/src/ui/utils/windowNavigation.test.ts` - Embedding-aware reload ownership.
