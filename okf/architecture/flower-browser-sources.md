---
type: Architecture Contract
title: Flower browser source ownership
description: Admit browser targets for Flower while preserving native identity and private control boundaries.
tags: [architecture, browser, flower, privacy]
timestamp: 2026-09-30T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

- Authority: ComputerUseRuntime authorizes target selection and control; its browser source Host owns admitted CDP and extension adapters.
- Outcome: Flower can discover, connect to, automate, observe, take over and return control of managed or explicitly selected browser tabs.
- Invariants: discovery never grants input; each admitted page has one debugger and ordered input path; private opener ancestry remains hidden across CDP and extension inventories.
- Failure boundary: source loss retires only affected target bindings. Unknown input outcomes are never replayed, and a failed source Host cannot silently create replacement authority.

# Contract

Runtime discovers supported Chrome and Chromium installations by opaque installation ID.

Existing files remain on disk unchanged.

# Boundaries

Private user input passes through the same target gate as Flower execution. Flower input cannot inspect that target until explicit handback clears the barrier.

Flower's user-control handback remains the canonical path for resuming a paused task.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - Target preparation, binding, execution and source lifetime.

- `redeven:internal/ai/computer_browser_host.go` - Private source Host handshake and command boundary.

- `redeven:internal/ai/computer_browser_privacy.go` - Cross-carrier native ancestry filtering.
