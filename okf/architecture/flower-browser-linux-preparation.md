---
type: Architecture Contract
title: Flower browser Linux preparation
description: Prepare a separate persistent Linux browser application for Flower connection.
tags: [architecture, browser, flower, applications]
timestamp: 2026-09-30T00:00:00Z
---
# Summary

- Authority: Runtime owns installation discovery and Native Messaging registration; Host Applications owns the prepared application and its graphical lifecycle.
- Outcome: Flower's connection guide can prepare a separate persistent Linux Chrome or Chromium profile without launching it or granting a browser target.
- Invariants: clients submit only an installation ID, never paths or launch arguments; personal profiles and existing website data remain untouched.
- Failure boundary: unsupported platforms, absent installations and unsafe profile directories fail before launch. Preparation cannot claim a successful connection.

# Contract

The authenticated `POST /_redeven_proxy/api/browser/extension/remote` action requires read, write and execute authority. Runtime prepares the current extension registration, then Host Applications creates an owner-scoped application entry and private persistent profile. Repeated preparation retains its cookies, site storage and extension consent. Native Chrome and Chromium profiles live in private Runtime state; Snap Chromium uses its permitted user-data location. Linked or cross-user-readable profile directories are rejected.

# Boundaries

Only Native Messaging registration is linked into the separate profile. Runtime shutdown removes that registration, without deleting browser data. The prepared application uses the ordinary Host Applications launch, viewer and recovery path; preparation adds no second graphical backend or input path. It does not open Chrome, attach a debugger, acquire an AI provider, or resume a Flower turn.

The Flower connection guide offers this action on a remote Linux host when the existing desktop cannot launch the selected browser. It reveals the prepared entry in Host Applications after a catalog refresh. The next explicit user action launches that application, followed by the extension handshake and exact target selection described in [Flower browser source ownership](flower-browser-sources.md). Closing the guide aborts a pending reveal, and late responses cannot redirect the user.

# Evidence

- `redeven:internal/codeapp/appserver/browser_connection_api.go` - Authenticated preparation with fixed installation identity.
- `redeven:internal/codeapp/appserver/browser_connection_api_test.go` - Missing authority and caller-selected path rejection.
- `redeven:internal/browserbridge/remote_profile.go` - Stable profile placement and canonical registration reference.
- `redeven:internal/browserbridge/remote_profile_test.go` - Data preservation and unsafe directory rejection.
- `redeven:internal/hostapps/browser.go` - Fixed application preparation and owner-specific catalog admission.
- `redeven:internal/flower_ui/host/remoteBrowserPreparation.ts` - Cancellation-aware Flower handoff.
- `redeven:internal/envapp/ui_src/src/ui/FlowerComputerConnections.browser.test.tsx` - Setup and closed-guide cancellation.
