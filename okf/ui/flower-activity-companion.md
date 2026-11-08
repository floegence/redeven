---
type: UI Contract
title: Flower Activity companion and contextual Ask Flower placement
tags: [ui, flower, activity, companion, read-state, floret]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

One retained Flower surface moves between authorized Activity/Workbench hosts. Selection/paste/drop update the same editable intent immediately. Model discovery starts after paint without delaying caret focus. No generated opening question/reply hint/placeholder; only actual intent notes guide.

# Contract

## Companion
### Companion ownership
Published BottomBarCompanion owns geometry, viewport/safe-area clamps, presence, Escape/outside dismissal and mounts in the explicit Activity overlay host, never body. The centered collapsed field grows bounded detail upward without changing body geometry; running work cannot block collapse or destination input.

### Activity Terminal footer
Desktop Activity Terminal supplies a 24px anchor in its 28px footer, centered in the terminal column with shrinkable 360px maximum width. Workbench/mobile supply none. Only the collapsed entry uses terminal background/foreground, restrained tint, border and monochrome Flower icon; expansion keeps shell theme. Palette changes retain the editor and never reroute input/transport or create Flower instances.

### Stable Flower placement
After first access readiness, retain one EnvAIPage/FlowerSurface across explicit hosts. hidden/aria-hidden/inert change together. Available unfiltered Workbench placement survives deselection; canvas selection owns input/focus only. [Settings](flower-setup-and-settings.md#retained-panels) owns retained forms.

### Contextual Ask Flower
Explicit new companion conversations may capture Activity origin through its read-only reader. [Turn launcher](flower-turn-launcher.md#submission) owns sending/actions.
Opening Ask Flower suppresses only the floating Activity companion. Full-page
Flower (including mobile) and Workbench remain visible and retain the same
conversation, editor and transcript while the card owns focus. Dismissal or
failed admission leaves the source conversation intact; successful admission
hands off once to the new task in the captured host.

### Presence and summary
[Presence](flower-companion-presence.md#presence) owns collapsed priority, live tails, completion, composer precedence and workspace observation.

### Dismissal, focus, and reads
Inside ownership includes shell, anchor and classified Flower Portals. Trusted cross-origin bridge input participates in dismissal without consuming destination input. SSE summaries are activity-only; baseline and later read envelopes retain UserPublicID scope. Geometry controls inherit only their direct published surface: Flower preview resize retains companion, unrelated windows dismiss it.

## Contextual window
### Shared input card
Both hosts use published PromptCard through the shared launcher, not a conversation/window manager. Maximum width 384px fits viewport; height follows actual notes, bounded reference strip/editor and errors. One frameless opaque floating plane contains context/attachments, editor and toolbar (attachment, model, Send), without divider, ink wash or ordinary border; contrast modes retain a boundary. Chips use opaque inset wells through `data-floe-prompt-reference`, not glow/shadow.

Model/file selection restores insertion point. Published searchable grouped Select uses provider brand, full model name and availability, with stable submitted IDs and request-local selection; never substitute reasoning shorthand. Shared attachment staging runs once; uncertain admission retains exact model, attachment IDs and request for explicit retry.

### Host boundary and motion
Measure visible Shell header bottom and Desktop titlebar safe area in client coordinates. PromptCard positions beside the supplied point, flips upward and clamps via Floe observeViewport, including soft keyboard/CSS zoom. File/Git retain original menu points through async preparation; preview uses its own control anchor; other pointer/keyboard entries capture the initiating element before focus moves. Only source-less programmatic opening uses upper-center placement. Measure layout, never animated bounds.

Published createFloatingPresence owns 280ms entrance/140ms exit, twelve/six-pixel origin lift and restrained scale. Clamping preserves direction; reduced motion settles immediately. Initial styles commit once even inside rAF; input is ready in the opening task. Product adds no alternative recipe. Exit retains intent/anchor/draft while immediately inert, then unmounts; same-intent reversal preserves editor/request identity.

### Interaction continuity
Autofocus unless explicitly disabled. Escape/Close restore origin; outside dismissal preserves destination interaction. IME and nested previews retain Escape ownership; related previews/direct geometry controls count inside. Sending paints local busy feedback before admission, disables duplicate sends/dismissal and makes references inert. Shared launcher retains exact retry/uncertainty, removal, localization and footer placement contracts.

# Boundaries

Workbench contributes placement only, retaining canvas/window/focus contracts. Companion never auto-expands for completion, failure, approval or input. Moving the retained tree creates no second list load/stream and deselection does not move it back. Redeven owns content, reference actions and request identity; Floe owns reusable input/focus/geometry/presence. Explicit viewport portal scope unifies related Activity/Workbench previews; host body attributes own constrained scrolling. Contextual cards add no durable state or window manager; main Flower/other windows remain separate.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.flowerCompanion.browser.test.tsx` - Full-page continuity through real card opening, dismissal, failed admission and handoff at desktop/mobile widths.
- `redeven:desktop/scripts/check-ask-flower-previews.mjs` - Built Env App and real Runtime qualification of source visibility, canonical/provider references, tool execution, new-task answers and retained source drafts.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerTurnLauncherWindow.bounds.browser.test.tsx` - Browser continuity and viewport acceptance.
- `redeven:desktop/scripts/check-flower-ask-card.mjs` - Real Desktop entries across locales, themes and widths.
