---
type: UI Contract
title: Desktop Welcome navigation
tags: [desktop, welcome, flower, navigation]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Welcome page selection is immediate and independent of Launcher IPC or Runtime preparation. Visited pages retain state; readiness gates Flower requests, not navigation. Explicit Environment tab changes may animate cards, while refresh/return preserves headers and skips entrance replay.

# Contract

- Header, logo, sidebar and contextual actions select locally. Health/progress/snapshot updates cannot override navigation. Main captures navigation after asynchronous reads so stale destinations cannot publish newer revisions.
- Selecting Environments, Redeven Cloud or Gateways renders immediately. Hiding/disposing cancels motion; return does not replay it. [Environment library](desktop-environment-library.md#library) retains card/state ownership.
- Environments and Flower mount on first visit and remain mounted until disposal. Filesystem invalidation uses environment ID, Runtime start identity and session key, never health/probe timestamps.

- Gateway management is an in-shell detail page. Returning to All Gateways restores list search, filter, scroll and focus. [Gateway Desktop interactions](../gateway/gateway-desktop-interactions.md) owns its sections, enrollment dialogs and recovery behavior; global navigation preserves the retained management context.

## Popup and dropdown ownership

Welcome consumes published Floe presence and menu/tooltip CSS. Each surface has one presence owner; closing immediately revokes pointer/keyboard input and accessibility exposure, freezes its measured placement, and retains the DOM through the CSS exit. Reopening reverses the same panel and preserves drafts/selection. Only the inner surface transforms; placement reads untransformed layout dimensions. Resolved collision direction and the anchor point determine motion origin. Reduced motion uses Floe's immediate recipe.

| Welcome entry points | Owner |
| --- | --- |
| Environment split actions | `DesktopAnchoredOverlaySurface` |
| Runtime/Gateway progress, recovery, Cloud account/connection details, SSH loading details and directory help | `DesktopActionPopover` through the same surface |
| Hover details and help | `DesktopPopover` / `DesktopTooltip`; tooltip uses the shorter Floe recipe |
| Connection details and retained QR disclosure | `EndpointsPopover` through the same surface; QR expansion stays an internal disclosure |
| Appearance picker | `DesktopThemePicker` through the same surface |
| Language, container, official Cloud provider and SSH destination options | `DesktopAnchoredListbox` |
| Saved Gateway/address pickers and Gateway object/connection actions | Published `Dropdown` |
| Gateway member/leave target, Cloud route and SSH bootstrap strategy | Published `Select`, including native form state and accessible listbox semantics |
| Embedded Flower model, permission, reasoning, thread switcher, subagent, goal, composer overflow/reference/command and context/compaction details | Existing Flower adapters consuming shared Floe presence |
| Embedded Flower settings, extensions and browser connection selectors | Published `Select` / `Dropdown` |
| Embedded Flower tool capability, Kimi endpoint and computer frame rate | Published `Select`; frame-rate input stays isolated from window dragging |
| File preview encoding/worksheet selectors and find/info/cell details | Published `Select` and a retained shared-presence preview panel |
| Compaction detail tooltip | Shared tooltip presence; text remains selectable while open |
| Embedded Flower thread/transcript context menus | `FlowerContextMenu`; callers retain the current presentation through the shared exit |
| Command palette, feedback disclosure, dialogs and drawers, working-directory picker and Ask Flower window | Published Floe components retain their own presence and focus lifecycle; the launcher retains its presentation when the caller clears its intent |

Action popovers opt into published Floe `observeDialogHeight`; their content clip adds no second fill, border or shadow. The outer rounded surface owns material and height, while top placement anchors its bottom edge so expansion preserves the trigger gap without scaling text. Geometry observes the inner clip, below the height owner, to avoid ResizeObserver feedback. Closing during resize freezes the painted height through exit; reduced motion commits the natural size immediately.

An Environment split action retains one primary button and one anchor across admission, progress, recovery and completion. Localized transient labels use `StableText`; Floe's slow color tokens ease the inverse fill and foreground together. Tooltip availability cannot remount the control, and its existing action authority and progress disclosure behavior remain unchanged.

Do not put these components inside open-only `Show` blocks; that would destroy their exit. Product observations may update content but never reopen a dismissed operation surface or release a newly reopened session. Selection and confirmation authority remain with their existing feature owners. No native visible select popup or local popup animation recipe remains in Welcome or its embedded Flower surfaces.

# Boundaries

Navigation grants no Runtime authority. [Ask Flower windows](../ui/flower-activity-companion.md#contextual-window) owns contextual placement.

# Evidence

- `redeven:desktop/src/welcome/App.tsx` - Source.
- `redeven:desktop/src/main/desktopWelcomeState.ts` - Source.
- `redeven:desktop/scripts/check-welcome-popup-motion.mjs` - Browser sampling of entrance/exit, reversal, reduced motion, directions, viewport bounds and stable position layers at desktop/narrow widths in light/dark.
- `redeven:desktop/scripts/check-welcome-workflow-motion.mjs` - Real split-action identity, inverse-color samples, growing/shrinking Runtime plans, rapid updates, anchor continuity, single rounded material and cancel/exit access in light/dark, narrow/desktop and reduced motion.
- `redeven:desktop/src/welcome/DesktopOverlayMotion.client.test.tsx` - Exit input revocation, retained drafts and completion.
- `redeven:desktop/scripts/check-office-preview.mjs` - Electron file-protocol selection, nested popup dismissal, responsive preview controls and retained document identity.
