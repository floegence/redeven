---
type: Browser Integration Contract
title: Managed browsers and authorized Chrome tabs
description: Bind an explicit profile and tab to the Runtime while preserving login state and unrelated user browsing.
tags: [ai, browser-use, chrome, profiles]
timestamp: 2026-09-26T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

`ComputerUseRuntime` owns browser connections, authorization and target control.
Managed Chromium, explicit CDP and Chrome extension bindings share the same
restricted page executor. A selected tab never implies authority over sibling
tabs or a different device. Disconnect, revocation, closed tabs and uncertain
effects stop subsequent work without automatically selecting a replacement.

# Contract

Connecting an explicitly chosen tab or creating a new tab in Browser and desktop also selects that target for the current conversation. Approval Required uses the current target and URL through tool approval; temporary URL authorization never becomes a saved origin grant.

It is not a model tool or a second browser-opening path.

## Managed profiles
Both Flower carriers use the shared browser installation controller at `/_redeven_proxy/api/browser/installation`.

The default profile creates its first page lazily; later loss of a selected page fails explicitly.

The guest cannot choose filesystem destinations or read file bytes; a later authorized file/command tool handles data processing.

## Chrome extension and explicit CDP
The MV3 extension uses Native Messaging and `chrome.debugger` bound to an exact tab.

Its webNavigation creation events retain bounded, in-memory popup source facts; Chrome tab-group opener metadata is not treated as the source of an action.

A remote Linux task uses its remote managed browser or private desktop; it cannot silently drive local user Chrome.

# Boundaries

Private control recovery after Runtime restart uses the same initial managed profile preparation as ordinary tools. The private input helper cannot create a second owner of the default profile; passive sampling never launches resources.

See the [Codex design evidence](computer-use-design-evidence.md) for the public and installed-code comparison; no forced reload or CSP rewriting is used.

# Evidence

- `redeven:internal/ai/computer_managed_browser.go` - managed profile and process ownership.

- `redeven:internal/ai/computer_managed_browser_test.go` - login isolation, saved downloads and profile validation.

- `redeven:internal/ai/computer_extension.go` - connection authorization, framing and scoped cancellation.
