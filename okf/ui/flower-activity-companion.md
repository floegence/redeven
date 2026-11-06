---
type: UI Contract
title: Flower Activity companion and contextual Ask Flower placement
tags: [ui, flower, activity, companion, read-state, floret]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

One retained Flower surface moves between authorized Activity and Workbench hosts. Published Floe owns companion geometry and presence; product adapters supply safe-area measurements and focus handoffs. Contextual Ask Flower adapts the published Floe `PromptCard`; Floe owns its complete layout, motion and viewport behavior. Placement creates neither another stream nor a second execution or editor owner.

# Contract

## Companion
### Companion ownership
Published `BottomBarCompanion` owns geometry, viewport/safe-area clamps, motion, outside dismissal, Escape and mount handling. Its Portal uses the explicit Activity overlay host, never `document.body`. The collapsed field is centered; bounded detail grows upward without changing body geometry. Running work cannot prevent collapse or destination interaction.

### Activity Terminal footer
Desktop Activity Terminal supplies a 24-pixel anchor in its 28-pixel footer, centered in the terminal column with a shrinkable 360-pixel maximum width. Workbench/mobile terminals supply none. Terminal supplies its reactive background/foreground alongside the anchor. Only the collapsed footer entry uses that palette: a restrained tinted surface, visible border and monochrome Flower icon. Expanded Flower keeps the shell theme; palette changes never replace its editor. Placement does not create another Flower instance, alter transport or route Flower input through the terminal.

### Stable Flower placement
After first access readiness, one retained `EnvAIPage`/`FlowerSurface` moves among explicit hosts. Visibility drives `hidden`, `aria-hidden` and `inert` together. Available unfiltered Workbench placement survives deselection; canvas selection governs input/focus only. [Settings](flower-setup-and-settings.md#retained-panels) own retained panels/forms.

### Contextual Ask Flower
New companion conversations may capture the desktop Activity origin using its read-only page reader. [Turn launcher](flower-turn-launcher.md#submission) owns sending/context actions.

### Presence and summary
[Presence](flower-companion-presence.md#presence) owns collapsed priority, live tails, completion feedback, composer precedence and workspace observation.

### Dismissal, focus, and reads
Outside capture includes shell, anchor and classified Flower-owned Portals. Trusted cross-origin plugin bridge events join host pointer/focus dismissal without consuming the destination. Shared SSE summaries are activity-only; initial/reconnect read baselines and later read envelopes are scoped to the same `UserPublicID`.

A floating window's geometry controls inherit ownership only from its direct published surface. Flower preview resize handles retain the companion; unrelated windows still dismiss it.

## Contextual window
### Shared input card
Desktop environment cards and every Env App contextual entry use the published `PromptCard` through the shared launcher. This is a compact input surface, not a conversation window: no `FloatingWindow`, fixed conversation height, draggable title bar, resize handles or maximize controls. The 384-pixel maximum width fits the visible viewport; height follows actual notes, the bounded reference strip, editor and explicit errors. The frameless editor and toolbar share one input surface without a divider. The editor uses the clean opaque Floe floating plane without a muted ink wash; neutral elevation supports the active input surface without a visible border in ordinary themes; accessibility contrast modes retain a boundary. Context and attachments precede the editor, followed by a compact toolbar with a plus attachment action, model choice and Send; text grows naturally within a bounded editor scroll area. File selection, paste and drop update the same editable intent immediately. Model discovery starts after paint through the existing model read resource, without delaying focus. The model name is the primary toolbar label, never a reasoning-level shorthand. There is no generated opening question, reply hint or input placeholder. Only actual intent notes add guidance. Opening focuses the real insertion caret immediately; completing model/file selection returns to the existing insertion point. The model dropdown uses published Select grouping and search, with the same provider brand, full model name and availability content as the Flower conversation picker. Provider groups distinguish identical model names while stable IDs remain the submitted identity. The selected model applies only to this request. The shared attachment controller validates and stages the captured files once; unknown admission retains the exact prepared model, attachment IDs and request identity for explicit retry.

### Host boundary and motion
Reference and attachment chips opt into the published `data-floe-prompt-reference` surface contract. Their opaque inset-well fill separates them from the clean floating-plane editor in light and dark themes without a drawn border, glow or additional shadow; the host retains content and actions.

The host measures the visible Shell header's client-space bottom edge and the Desktop titlebar safe area. Published `PromptCard` places beside the supplied point, flips upward when necessary and clamps to published Floe `observeViewport` bounds, including soft keyboard occlusion and CSS zoom. File and Git menus retain their original client-space point through dismissal and asynchronous detail preparation. Preview actions retain their own control/menu anchor. Other control and keyboard entries capture the initiating element through published `capturePromptCardAnchor` before focus moves; only programmatic openings without a source use the upper central content area. Position uses layout size, never animated bounds.

Published `PromptCard` uses shared `createFloatingPresence` for mounting, exit completion and reversal. Its 280ms entrance and 140ms exit use a twelve/six-pixel origin-based lift with restrained scale; clamped placement keeps its direction and reduced motion settles immediately. The shared presence owner commits the initial style once before opening, including when the host dispatches inside an animation frame; input remains ready in the opening task. The product supplies no alternate motion recipe. Exiting content retains the last intent, anchor and draft, becomes inert immediately and unmounts after the transition. Reversing an unfinished close for the same intent preserves editor and request identity.

### Interaction continuity
Opening focuses the editor unless the caller disables autofocus. Escape and Close restore the initiating control; outside pointer dismissal leaves destination interaction intact. IME composition and nested previews retain their Escape ownership. Related context previews and their direct geometry controls count as inside; unrelated windows remain outside. Sending paints a local busy acknowledgement before invoking host admission, and blocks duplicate submission and dismissal. References are inert during this handoff. Existing exact-request retry, unknown admission, reference removal, localization and panel-placement footer contracts remain with the shared launcher.

# Boundaries

The Workbench Flower widget retains its existing window, canvas, and focus contracts while contributing only a placement host for the Env App-owned Flower product.

The companion never auto-expands for completion, failure, approval, or user input. Showing an available, unfiltered Workbench Flower widget moves the retained product tree into that widget without starting a second list load or live stream, and later canvas deselection does not move it away.

Redeven owns Ask Flower identity, localized content, reference actions and request admission. Published Floe owns the complete reusable input card, focus, visible viewport geometry and presence. The adapter explicitly selects viewport portal scope so related Activity and Workbench previews share one interaction; constrained scrolling uses the host body ownership attributes. The card adds no window management or durable state. These constraints apply to the contextual launcher, not the main Flower surface or other floating windows.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/ActivityPluginSurfacePage.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Tests.

- `redeven:desktop/src/shared/askFlowerWindowViewport.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerTurnLauncherWindow.tsx` - Source.

- `redeven:internal/flower_ui/src/FlowerTurnLauncherWindow.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerTurnLauncherWindow.bounds.browser.test.tsx` - Browser continuity and viewport acceptance.
- `redeven:desktop/scripts/check-flower-ask-card.mjs` - Real Desktop entry acceptance across locales, themes and widths.
