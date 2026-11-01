---
type: Design Evidence
title: Codex computer and browser use design evidence
tags: [ai, computer-use, browser-use, accessibility]
lifecycle: retained_history
retention_reason: "Retains official design evidence and unresolved platform limits that constrain current Computer Use contracts."
reviewed_at: "2026-11-01"
---
# Summary

Versioned official documentation and installed app 26.908.40834/extension 1.26.901.11451 inform command-first routing, AX/script batching and compact observations. They expose neither proprietary implementation nor universal external-window isolation. Flower Runtime remains execution and authorization authority.

# Contract

Keep authorized commands/integrations first, then semantic operations batched inside the existing bounded QuickJS namespace.

Tab lifecycle and popup target authorization remain under Flower's existing Runtime contract rather than importing another product's session leases, tab marks or persistence model.

# Boundaries

Do not reload existing tabs or rewrite page CSP merely to claim stronger popup isolation.

Ordinary human keyboard/mouse activity does not implicitly revoke Agent control; explicit Stop, takeover, site grants and unknown-effect boundaries remain.

# Evidence

Version-scoped official sources and installed app/extension observations, not proprietary implementation or a public API promise:

- [Computer Use](https://learn.chatgpt.com/docs/computer-use): prefer connectors/APIs/CLI; macOS background scopes have limits. Advice to use another browser is no universal same-browser isolation guarantee.
- [Browser](https://learn.chatgpt.com/docs/browser): independent profile and visible built-in surface.
- [Chrome extension](https://learn.chatgpt.com/docs/chrome-extension): existing login/site/native-debugger permissions; no separate complete action history.

Native paste temporarily uses/restores the system pasteboard, disproving a blanket no-clipboard claim.
