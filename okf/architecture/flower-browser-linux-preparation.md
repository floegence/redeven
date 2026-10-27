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

Runtime discovers installations and registers Native Messaging; Host Applications owns graphical lifecycle. The guide prepares a persistent Linux Chrome/Chromium profile without launch or target authority. Clients pass opaque installation IDs, never paths/argv. Preserve personal profiles; unsupported platforms, missing installs and unsafe directories fail before launch.

# Contract

The authenticated `POST /_redeven_proxy/api/browser/extension/remote` action requires read, write and execute authority. Linked or cross-user-readable profile directories are rejected.

# Boundaries

Only Native Messaging registration is linked into the separate profile.

The Flower connection guide offers this action on a remote Linux host when the existing desktop cannot launch the selected browser. Closing the guide aborts a pending reveal, and late responses cannot redirect the user.

# Evidence

- `redeven:internal/codeapp/appserver/browser_connection_api.go` - Authenticated preparation with fixed installation identity.

- `redeven:internal/codeapp/appserver/browser_connection_api_test.go` - Missing authority and caller-selected path rejection.
