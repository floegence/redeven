---
type: Architecture Contract
title: Flower browser source ownership
tags: [architecture, browser, flower, privacy]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

ComputerUseRuntime authorizes targets; its source Host owns CDP/extension adapters. Discovery grants no input. Each admitted page has one debugger/input order; private opener ancestry stays hidden across inventories. Source loss retires only affected bindings. Unknown effects never replay and Host failure never creates replacement authority.

# Contract

Runtime discovers supported Chrome and Chromium installations by opaque installation ID. Source trace identifiers are bounded and consistently quoted so control characters cannot create records or terminal escapes with any log handler. Page contents and CDP payloads remain excluded.

The Go Runtime is the managed Chromium process owner. Helpers attach to a profile endpoint and cannot launch a second production browser. [Managed lifecycle](../ai/computer-use-browser.md) defines passive discovery, target-gated Stop, idle release and identity-checked crash cleanup. Existing saved sign-ins and downloads remain on disk.

# Boundaries

Private user input passes through the same target gate as Flower execution. Flower input cannot inspect that target until explicit handback clears the barrier.

Flower's user-control handback remains the canonical path for resuming a paused task.

# Evidence

- `redeven:internal/ai/computer_runtime.go` - Target preparation, binding, execution and source lifetime.

- `redeven:internal/ai/computer_browser_privacy.go` - Cross-carrier native ancestry filtering.
