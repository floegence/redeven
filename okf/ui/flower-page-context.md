---
type: UI Contract
title: Flower Activity origin page references
description: Freeze only the visible Activity page facts for a new companion conversation.
tags: [ui, flower, activity, references, draft]
timestamp: 2026-10-12T00:00:00Z
---
# Summary

Redeven owns Activity page readers and unadmitted page references. A new desktop
companion conversation captures one removable origin snapshot without requesting
data or replacing its native editor. Existing conversations never receive it.
Each explicit opening without a selected thread or New action refreshes it;
navigation and editing within that opening do not. Submission and
same-request retry use its exact visible text; the existing draft and transport
owners retain failed intent. Terminal references include the currently displayed
screen through the same local capture path as right-click Ask Flower. Unloaded or
unauthorized page facts are omitted.

# Contract

The desktop Activity companion in Desktop and browser Env App captures the origin
page immediately on every explicit New conversation action and every explicit
companion opening without a selected thread, including reversal during close.
Opening replaces the page reference while retaining text, attachments, file
references, selection and the native editor. A focus-plus-click gesture captures
once, and interactions in an already expanded companion do not refresh it.
An untouched initial blank draft not yet explicitly opened captures on its first
text edit, paste, attachment or file reference instead. Switching pages and
selecting or reopening an existing thread never add context. Escape focus
restoration never captures or reopens. Full Flower, Tessiven, Workbench, mobile and standalone windows do not provide
automatic page context. Embedded Tessiven keeps its existing context path.

Each Activity page exposes a read-only function over already authorized,
presented state. Shell selects it by the real Activity ID, including plugin page
IDs, rather than the last built-in surface. Every snapshot identifies the
environment, page ID/name and capture time. It adds only current page facts:
Monitor sort/internal-session preference, latest displayed metrics and selected
process; committed file directory/mode/selection or Git repository/branch/commit;
active terminal identity/name/known directory and displayed screen; or resource
view/filter and explicit selection. Plugin Center supplies its filters and
selected plugin identity. Plugin pages supply only host-known plugin, instance and
surface identity. No additional request, plugin document/selection readback, file
body, full terminal history or complete resource/monitor table is captured. Unloaded
facts are omitted. Snapshot text is bounded before entering the draft, so its
preview and submitted text remain identical.

Terminal reads only the active session's local semantic viewport, including a
currently projected history or alternate screen. Automatic capture uses the
whole displayed screen even when text is selected; explicit right-click Ask
Flower continues to prefer the selection. Both screen paths share the same
10,000-character Unicode limit and retain the end of an oversized screen. The
automatic page reference remains within its 6,000-character budget: it trims
the screen prefix before JSON serialization, preserving page/session identity,
escaped text and the latest displayed lines. Empty, unavailable or disposed
viewports omit screen text and retain known session facts. Capture never scrolls,
attaches, fetches history or waits for output. Later output cannot change a frozen
reference; a new explicit blank opening or New action reads the current screen.

`ComposerDraftStore` owns `page_context`, its frozen label/title/text and the
edit-time capture marker. Shell retains reader functions, never copied context.
A compact chip uses the shared purpose-designed page-context icon and opens the
exact frozen content in the same host preview as right-click Ask Flower. Env App
uses one `FlowerContextPreviewWindow` with its existing text viewer, persisted
geometry, drag/resize, safe-area and closing behavior. Flower owns reference
validity; refresh, removal or scope replacement closes the obsolete preview.
The preview adds no reader or context state owner. Removal keeps the existing
focus rules. Page changes and subsequent edits do not refresh it;
removal stays effective within the current opening, including after a controlled
Runtime restart. The next explicit blank companion opening or New action captures
again. Submitted outbox requests and their same-request retries keep their
original frozen reference independently of the current editable draft. An
accepted first turn consumes any refreshed origin before carrying newer user
edits into its thread draft; text, attachments and file references survive.
Acceptance of an older request cannot consume an explicitly newer conversation's
origin. The automatic reference alone cannot enable empty Send.

# Boundaries

[Flower composer references](flower-composer-references.md) owns draft freezing,
strict text/file action shapes and canonical Floret admission. Page references
supply facts rather than instructions, execution location or permissions. The
[Activity companion](flower-activity-companion.md) owns placement, dismissal and
one retained Flower product; page capture adds no lifecycle or stream.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerContextPreviewWindow.tsx` - One host presentation for launcher and composer/chat snapshots.
- `redeven:internal/flower_ui/src/icons/FlowerContextIcon.tsx` - Shared reference identity includes a dedicated page-context glyph.

- `redeven:internal/envapp/ui_src/src/ui/flower/flowerPageContext.ts` - Reader functions and bounded immutable page snapshots.
- `redeven:internal/envapp/ui_src/src/ui/widgets/TerminalPanel.loadingContinuity.browser.test.tsx` - Active screen capture, right-click parity, selection preservation, Unicode bounds and unavailable viewports.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.pageContext.test.tsx` - Explicit opening and New refresh, first edit, removal, retained draft and attachments, existing threads, first-turn consumption and frozen same-request retry.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.pageContext.browser.test.tsx` - Native editor identity, preview dismissal and bounded chips at narrow widths.
- `redeven:internal/envapp/ui_src/src/ui/services/sessionRestart.test.ts` - Frozen reference and removed-reference marker survive controlled restart.
- `redeven:internal/envapp/ui_src/src/ui/EnvAppShell.localAccess.e2e.test.tsx` - Real plugin Activity identity and Workbench exclusion.
- `redeven:internal/envapp/ui_src/scripts/checkPackagedRenderer.mjs` - Published-dependency production Shell verifies capture on reopening after navigation, removal and New, plus owned preview interactions.
