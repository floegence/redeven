---
type: UI Contract
title: Flower Activity companion and contextual Ask Flower placement
tags: [ui, flower, activity, companion, read-state, floret]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

One retained Flower surface moves between authorized Activity/Workbench hosts. Each independent file preview owns one local companion after first use. Selection/paste/drop immediately edits the same intent; model discovery starts after paint without delaying caret focus. Only actual intent notes guide; no generated question/reply hint/placeholder.

# Contract

## Companion
### Companion ownership
Published BottomBarCompanion owns geometry, viewport/safe-area clamps, presence and Escape/outside dismissal in the explicit Activity overlay host, never body. Centered collapsed input grows bounded detail upward without moving body geometry. Running work cannot prevent collapse or destination input.

### Activity Terminal footer
Desktop Activity Terminal provides a 24px anchor in its 28px footer, centered with shrinkable 360px maximum width; Workbench/mobile provide none. Only collapsed input uses terminal colors, restrained tint/border and monochrome Flower icon; expansion keeps shell theme. Palette changes retain editor/transport/input ownership and one Flower instance.

### Stable Flower placement
Retain one EnvAIPage/FlowerSurface after first access readiness. hidden/aria-hidden/inert change together. Available unfiltered Workbench placement survives deselection; selection owns focus/input only. [Settings](flower-setup-and-settings.md#retained-panels) owns retained forms.

### Contextual Ask Flower
Explicit new companions may capture Activity through a read-only reader; [launcher](flower-turn-launcher.md#submission) owns sending. Ask Flower suppresses only floating Activity companion. Full-page/mobile/Workbench preserve conversation/editor/transcript while the card owns focus. Dismissal/failed admission retains the source; success hands off once to the new task in captured host. File previews keep their own prompt/conversation even when narrow, without activating parent shells.

### Presence and summary
[Presence](flower-companion-presence.md#presence) owns collapsed priority, tails, completion, composer precedence and observation.

### Dismissal, focus, and reads
Shell, anchor and classified Flower portals count inside. Trusted cross-origin bridge input participates without consuming destination actions. SSE summaries carry activity only; baseline/read envelopes retain UserPublicID. Direct preview resize retains companion; unrelated windows dismiss it.

## Contextual window
### Shared input card
Both hosts use published PromptCard/shared launcher, not another conversation manager. Width<=384px fits viewport; actual notes, bounded references/editor and errors determine height. One opaque frameless plane contains references, editor and attachment/model/Send toolbar; no divider/wash/ordinary border, while contrast modes retain a boundary. Reference chips use opaque inset wells via data-floe-prompt-reference.

File/model selection restores insertion. Searchable grouped Select shows provider brand/full model/availability with stable request-local IDs, not reasoning shorthand. Stage attachments once; uncertain admission retains exact model, attachment IDs and request for explicit retry.

### Host boundary and motion
Measure visible Shell header/Desktop safe area in client coordinates. PromptCard anchors at the supplied point, flips/clamps through Floe observeViewport including keyboard/zoom. File/Git preserve menu points across preparation; previews use their control; other entries capture origin before focus moves. Only source-less openings use upper center. Measure layout, not animated bounds.

Published createFloatingPresence owns 280ms entrance/140ms exit, 12/6px lift and restrained scale. Clamp preserves direction; reduced motion settles immediately. Commit initial styles once, even in rAF; input works in opening task. Exit immediately revokes input while retaining intent/anchor/draft until unmount; reversal retains editor/request identity. No product motion recipe.

### Interaction continuity
Autofocus unless disabled. Escape/Close restores origin; outside dismissal preserves destination input. IME/nested previews retain Escape ownership; related previews/direct geometry controls count inside. Before admission, paint busy state, prevent duplicate sends/dismissal and make references inert. Shared launcher owns exact retry/uncertainty, removal, localization and footer rules.

# Boundaries

Workbench supplies placement only. Companion never expands automatically for completion/failure/approval/input. Moving retained trees adds no list load/stream; deselection does not move back. Redeven owns content/actions/request identity; Floe owns input/focus/geometry/presence. Viewport portal scope includes related previews; host body controls constrained scrolling. Cards add no durable/window manager; main Flower/other windows remain independent.

# Evidence

EnvAppShell.flowerCompanion.browser.test.tsx covers real opening/dismissal/failure/handoff at desktop/mobile. Built check-ask-flower-previews.mjs qualifies source visibility, canonical/provider references, execution, answers and drafts. FlowerTurnLauncherWindow.bounds.browser.test.tsx covers bounds/continuity; check-flower-ask-card.mjs covers real Desktop entries/locales/themes/widths.
