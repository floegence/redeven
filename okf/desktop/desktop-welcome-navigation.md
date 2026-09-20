---
type: UI Contract
title: Desktop Welcome navigation
description: Switch between Environments and Flower immediately while retaining their page state.
tags: [desktop, welcome, flower, navigation]
timestamp: 2026-09-21T00:00:00Z
---
# Summary

The Desktop Welcome renderer owns navigation inside its existing window. Opening
Flower or returning to Environments changes the visible page on the click without
waiting for Launcher IPC, an environment snapshot, or runtime preparation. Visited
pages retain their state. Runtime readiness and compatibility still determine
whether Flower can use its runtime; a blocked or loading runtime never prevents
returning to Environments.

# Navigation ownership

Local header, logo, sidebar, and contextual Flower handoff actions select the
renderer page directly. They do not reopen the utility window, start environment
discovery, or acquire the general Launcher busy state.

Main-process window opening and settings requests increment `navigation_revision`
in the Welcome snapshot, including repeated requests for the same destination.
The renderer consumes each newer request once. Environment health, operation
progress, issue clearing, and ordinary snapshot refreshes retain that revision and
cannot override local navigation. Snapshot ordering remains authoritative for
accepting data; navigation revision identifies an explicit destination request,
not another snapshot sequence. Main captures the navigation state after its
asynchronous snapshot reads so an older captured destination cannot be published
as a later request.

# Retained pages

Environments and Flower mount on their first visit and remain mounted until
Welcome is disposed. Hiding a page removes it from layout, accessibility, and
keyboard interaction through `display: none`, `aria-hidden`, and `inert`.
If navigation hides or removes the focused control, focus moves to the visible
header navigation button without scrolling the page.
Environment card selection and scroll state, the current Flower conversation,
and unsent composer content survive navigation.

Hidden Flower receives `engaged=false` and `transcriptVisible=false` through its
existing visibility contract. It retains one Desktop workspace stream while
foreground reads, focus, and transcript presentation follow engagement. Returning
does not reload settings, recreate the thread list, or reconnect the workspace
stream; the selected current view may refresh through normal engagement behavior.
Before AI is operational, the retained page shows preparation without mounting
Flower. The [Desktop readiness boundary](desktop-runtime-readiness.md) admits the
surface automatically when AI becomes ready and preserves drafts during recovery.
Disposing Welcome releases Flower and its stream. Changing the selected runtime
identity remounts the Flower boundary so the previous runtime's cached conversation
does not become the new runtime's view.

# Boundaries

Navigation grants no runtime authority. The existing compatibility boundary,
runtime bridge, and Flower loading/error presentation still own preparation and
recovery. The [runtime readiness contract](desktop-runtime-readiness.md) remains
the authority for runnable operations. This contract concerns the main Flower
page; contextual window placement remains in
[Ask Flower window boundaries](../ui/ask-flower-window.md).

# Evidence

- `redeven:desktop/src/welcome/App.tsx` - Renderer navigation and retained page visibility.
- `redeven:desktop/src/main/main.ts` - Explicit host request revision and snapshot capture.
- `redeven:desktop/src/main/desktopWelcomeState.ts` - Welcome snapshot projection.
- `redeven:desktop/src/welcome/FlowerNavigation.client.test.tsx` - Pending IPC, immediate return, retained instances, and explicit host requests.
- `redeven:desktop/scripts/check-flower-navigation.mjs` - Browser paint timing, delayed AI admission, draft and selection retention, inert pages, and workspace stream lifetime using a fixture that rejects premature AI requests.
