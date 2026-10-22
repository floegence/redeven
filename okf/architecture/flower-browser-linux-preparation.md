---
type: Architecture Contract
title: Flower browser Linux preparation
description: Prepare a separate persistent Linux browser application for Flower connection.
tags: [architecture, browser, flower, applications]
timestamp: 2026-09-30T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: Runtime owns installation discovery and Native Messaging registration; Host Applications owns the prepared application and its graphical lifecycle.
- Outcome: Flower's connection guide can prepare a separate persistent Linux Chrome or Chromium profile without launching it or granting a browser target.
- Invariants: clients submit only an installation ID, never paths or launch arguments; personal profiles and existing website data remain untouched.
- Failure boundary: unsupported platforms, absent installations and unsafe profile directories fail before launch. Preparation cannot claim a successful connection.

# Contract

The authenticated `POST /_redeven_proxy/api/browser/extension/remote` action requires read, write and execute authority. Linked or cross-user-readable profile directories are rejected.

# Boundaries

Only Native Messaging registration is linked into the separate profile.

The Flower connection guide offers this action on a remote Linux host when the existing desktop cannot launch the selected browser. Closing the guide aborts a pending reveal, and late responses cannot redirect the user.

# Evidence

- `redeven:internal/codeapp/appserver/browser_connection_api.go` - Authenticated preparation with fixed installation identity.

- `redeven:internal/codeapp/appserver/browser_connection_api_test.go` - Missing authority and caller-selected path rejection.

- `redeven:internal/browserbridge/remote_profile.go` - Stable profile placement and canonical registration reference.
