---
type: Design Evidence
title: Codex computer and browser use design evidence
tags: [ai, computer-use, browser-use, accessibility]
lifecycle: retained_history
retention_reason: "Retains official design evidence and unresolved platform limits that constrain current Computer Use contracts."
reviewed_at: "2026-10-22"
---
# Summary

Flower borrows observable design principles, not private implementation code.
Official documentation and read-only inspection of installed app 26.908.40834
and Chrome extension 1.26.901.11451 support command-first routing, persistent
script batches, AX-first interaction, compact observations and independent
visibility/control. They do not establish a universal guarantee that arbitrary
external browser pages can never activate another window. Flower's Runtime
remains the sole execution and authorization owner.

# Contract

Keep authorized commands/integrations first, then semantic operations batched inside the existing bounded QuickJS namespace.

Tab lifecycle and popup target authorization remain under Flower's existing Runtime contract rather than importing another product's session leases, tab marks or persistence model.

# Boundaries

Do not reload existing tabs or rewrite page CSP merely to claim stronger popup isolation.

Ordinary human keyboard/mouse activity does not implicitly revoke Agent control; explicit Stop, takeover, site grants and unknown-effect boundaries remain.

# Evidence

- [Computer Use](https://learn.chatgpt.com/docs/computer-use) recommends   connectors, APIs and command-line tools for structured work. macOS supports   scoped background operations; platform and application limitations remain.   It advises using a different browser when the user wants to keep browsing   while a task works. That is not a universal same-browser isolation guarantee.

- [Browser](https://learn.chatgpt.com/docs/browser) describes an independent   profile and a separately visible built-in browser surface.

- [Chrome extension](https://learn.chatgpt.com/docs/chrome-extension) describes   existing browser login state, site authorization and native/debugger   permissions. It says there is no separately stored complete action history.

## Observable installed behavior
The following is version-scoped local evidence, not a promised public API or a claim to know the complete proprietary implementation. The native paste contract temporarily uses and restores the system pasteboard, so a blanket claim that Codex never accesses the clipboard would be incorrect.
