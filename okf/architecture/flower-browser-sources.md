---
type: Architecture Contract
title: Flower browser source ownership
description: Admit browser targets for Flower while preserving native identity and private control boundaries.
tags: [architecture, browser, flower, privacy]
timestamp: 2026-09-30T00:00:00Z
---
# Summary

- Authority: ComputerUseRuntime authorizes target selection and control; its browser source Host owns admitted CDP and extension adapters.
- Outcome: Flower can discover, connect to, automate, observe, take over and return control of managed or explicitly selected browser tabs.
- Invariants: discovery never grants input; each admitted page has one debugger and ordered input path; private opener ancestry remains hidden across CDP and extension inventories.
- Failure boundary: source loss retires only affected target bindings. Unknown input outcomes are never replayed, and a failed source Host cannot silently create replacement authority.

# Contract

Runtime discovers supported Chrome and Chromium installations by opaque installation ID. Native Messaging registration and the extension connection hub remain Runtime-owned. Connection setup, status, open and Linux preparation work without an AI provider. A live profile handshake alone does not select a page: Flower target selection validates its current native identity, URL and title before binding one source adapter. Managed Chromium is launched only from a verified optional installation and keeps its website profile in Runtime state. CDP and extension pages retain their original browser cookies and storage; no website request is relayed through a second HTTP client.

The source Host runs over a private Runtime-owned Unix socket. It admits exact pages, executes semantic browser commands, cancels held commands and reports source loss. It does not expose a Remote Browser document, user workspace, tab directory mutation or product projection stream. The published `@floegence/floebrowser` package remains the source adapter dependency, alongside Playwright and the semantic controller. The former product `browser.sqlite` and its bookmarks, history, recovery tabs and preferences are neither initialized nor read by the new Runtime. Existing files remain on disk unchanged.

# Boundaries

Private user input passes through the same target gate as Flower execution. Before the first private input, the source Host reserves a target privacy barrier. Native opener ancestry redacts a private popup from managed, CDP and extension inventories, even after an intermediate opener closes. Flower input cannot inspect that target until explicit handback clears the barrier. A source close revokes its executor, live sampler and input lease without granting another page; the initial managed target keeps a closed identity. Managed popups may be admitted from an already owned managed profile, while external Chrome popups still require explicit user selection.

Runtime service generation fences late source events. Recovery of a failed Host revokes old leases and scripts, stops owned managed processes and starts a fresh Host; it does not terminate personal Chrome or replay unknown effects. Unresolved external private control blocks generation replacement. Flower's user-control handback remains the canonical path for resuming a paused task.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - Target preparation, binding, execution and source lifetime.
- `redeven:internal/ai/computer_browser_host.go` - Private source Host handshake and command boundary.
- `redeven:internal/ai/computer_browser_privacy.go` - Cross-carrier native ancestry filtering.
- `redeven:internal/ai/computer_browser_lifecycle.go` - Source loss and managed popup admission.
- `redeven:internal/ai/computer_browser_installation_test.go` - Retired product database remains untouched.
- `redeven:internal/envapp/ui_src/scripts/computerBrowserHost.mjs` - Shared source adapters and private target barrier.
- `redeven:internal/envapp/ui_src/scripts/redevenBrowserHost.mjs` - Source-only private Host protocol.
- `redeven:internal/ai/computer_browser_recovery_test.go` - Stale generation and unresolved private control rejection.
