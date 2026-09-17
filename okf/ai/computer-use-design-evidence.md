---
type: Design Evidence
title: Codex computer and browser use design evidence
description: Separate official guidance and observed packaged behavior from Flower decisions and unresolved platform limits.
tags: [ai, computer-use, browser-use, accessibility]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

Flower borrows observable design principles, not private implementation code.
Official documentation and read-only inspection of installed app 26.908.40834
and Chrome extension 1.26.901.11451 support command-first routing, persistent
script batches, AX-first interaction, compact observations and independent
visibility/control. They do not establish a universal guarantee that arbitrary
external browser pages can never activate another window. Flower's Runtime
remains the sole execution and authorization owner.

# Evidence

## Official guidance retrieved on 2026-09-17

- [Computer Use](https://learn.chatgpt.com/docs/computer-use) recommends
  connectors, APIs and command-line tools for structured work. macOS supports
  scoped background operations; platform and application limitations remain.
  It advises using a different browser when the user wants to keep browsing
  while a task works. That is not a universal same-browser isolation guarantee.
- [Browser](https://learn.chatgpt.com/docs/browser) describes an independent
  profile and a separately visible built-in browser surface.
- [Chrome extension](https://learn.chatgpt.com/docs/chrome-extension) describes
  existing browser login state, site authorization and native/debugger
  permissions. It says there is no separately stored complete action history.
- [Computer use API](https://developers.openai.com/api/docs/guides/tools-computer-use/)
  recommends code execution and preserving the execution environment to compose
  actions and observations with fewer model round trips.

## Observable installed behavior

The following is version-scoped local evidence, not a promised public API or a
claim to know the complete proprietary implementation. Only packaged code and
documentation were read; no user browsing history, cookies or credentials were
inspected. No bundled implementation was copied into Flower.

The bundled Chrome/browser accessibility documentation makes AX the primary
interaction API. `ax.write()` emits compact state, diffing by default;
`ax.get()` supports local computation without output. A persistent REPL composes
actions and final checks. Title and URL travel with state, screenshots are
optional, repeated unchanged observations and redundant navigations are
discouraged. State capture includes internal waiting.

The browser service combines Chromium DOM snapshots and AX trees, preserving
backend node, frame and document-loader identity. It enables top-level
`Emulation.setFocusEmulationEnabled` when attaching and handles OOP iframes
through their own sessions. A WASM component builds compact state revisions;
the complete internals of that component were not established by this review.

The bundled claiming guide requires resolving an exact extension instance and
passing the selected inventory object. For tab mentions it instructs the agent
to check ID, URL and title to detect reused or changed tabs. New task tabs use
`active:false`; creating a needed
window uses `focused:false`. Logical active-tab state is separate from the
user's physically selected tab. Claiming a user tab does not regroup it.
Visibility/focus is a separate capability, not an implicit consequence of
navigation. Agent-created tabs have turn cleanup and explicit deliverable or
handoff marks; existing user tabs are released and left open.

The installed extension contains an optional page-world `window.open` and link
interceptor. It forwards eligible URLs and creates inactive tabs. It does not
prove that cached native openers, arbitrary forms or all popup flows are
suppressed. The in-app Electron browser has a separate `setWindowOpenHandler`
and child-web-content adoption path because it owns the browser surface.
These are different control boundaries. The inspected DNR rules identify
agent requests; they are not a document sandbox.

Native CUA exposes target-scoped AX/state/screenshot/action methods through a
trusted service called from the persistent REPL. This establishes the scoped
interface, not its complete native event injection internals. The native paste
contract temporarily uses and restores the system pasteboard, so a blanket
claim that Codex never accesses the clipboard would be incorrect.

# Contract

Keep authorized commands/integrations first, then semantic operations batched
inside the existing bounded QuickJS namespace. Use local-only observations and
output diffs; keep explicit full snapshots for context recovery. Activate virtual
page focus independently of tab visibility. Validate existing tab selections,
preserve user form state, and never silently choose a different tab.

Flower intentionally keeps guest scripts more restricted than Codex's Node
REPL: no host filesystem, network or arbitrary CDP. Native actions continue to
use measured AX capabilities, with authorized foreground fallback and explicit Stop/takeover
control. Tab lifecycle and popup target authorization remain under Flower's
existing Runtime contract rather than importing another product's session
leases, tab marks or persistence model.

# Boundaries

Do not reload existing tabs or rewrite page CSP merely to claim stronger popup
isolation. Page-world popup conversion is not an enforceable
boundary against arbitrary page code. Native popup capability and separate
child authorization are documented in [browser control](computer-use-browser.md)
and [acceptance](computer-use-qualification.md). Managed headless Chromium has no
physical window to steal user focus; connected Chrome has a different boundary.

Implementation and focused tests are linked from
[script execution](computer-use-scripts.md) and
[browser control](computer-use-browser.md). Performance improvements require
[paired measurements](computer-use-performance.md), not analogy with Codex.

Flower preserves native popup semantics because task capability takes priority
over occasional focus changes. It does not adopt the optional Codex extension
wrapper: returning null or suppressing targeted forms breaks real web flows.
Ordinary human keyboard/mouse activity does not implicitly revoke Agent control;
explicit Stop, takeover, site grants and unknown-effect boundaries remain.
