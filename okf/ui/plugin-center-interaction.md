---
type: UI Contract
title: Plugin Center interaction
tags: [ui, plugins, plugin-center, workbench, accessibility]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Redeven owns Plugin Center navigation; Floe owns dialogs, presence and input. Workbench uses a retained drawer and Activity the same directory page. Search/filter/selection/scroll persist. Closing management does not cancel Host execution; released ReDevPlugin owns lifecycle, permissions and surface authority.

# Contract

## Management placement and input
Only Plugin Center explicitly selects global Dialog placement at the product modal layer. Recent Dock or widget interactions cannot mount the drawer under `.workbench-surface`, `inert`, or a transformed canvas ancestor.

A successful Open closes management and focuses the target after canvas input becomes available; a failed Open preserves the directory and error feedback.

## Directory and responsive details
Local filters combine source (official or community) and lifecycle without rebuilding identity. Refresh status remains outside the card grid, so a pending refresh cannot appear as a duplicate card.

External installation source tabs retain three columns with the same complete accessible names when their visible selection labels need ellipsis.

## Shared design language

The directory, detail actions, package-install source form and update review compose released Floe controls. Cards use the shared default plane, without visible resting contours, decorative lift, icon magnification or custom shadow stacks. Selected cards use the shared selection fill. Shared Tags carry source/lifecycle semantics without changing Host authority.

Floe owns Input focus, Button pending/disabled treatment and Tabs keyboard/selection behavior. Search, source/lifecycle filters, retained selection and scroll remain product state. Menu triggers are single focusable boundaries with centered content, neutral hover and visible keyboard focus; nested trigger boxes are avoided. Details keep primary actions outside their scroll body, with secondary evidence in quiet disclosures.

Source tabs retain complete accessible names and three equal columns on compact dialogs. Mobile actions remain at least 44px; install progress replaces the primary action without changing card/sibling geometry. Reduced-motion, localized long copy and light/dark themes use the same shared controls.

Changing the external install source may increase body height and show scrolling. The published Floe Dialog keeps its body scrollbar gutter stable, so the panel and body widths remain fixed while the existing height transition settles; content stays scrollable.

## Plugin creation workspace

Creation opens a full product page, with an addressable draft and return path.
Creation and draft-library code load on navigation, outside the initial shell graph.
Deep links wait for the authenticated environment and plugin session before mounting
the draft reader; they do not turn connection startup into a failed draft read.
Files, Terminal, the ordinary Flower surface and Workbench retain their existing
instances while this page is active. The dedicated embedded Flower surface owns
one composer; requirements discussion and direct creation submit through it.
Desktop conversation/preview columns use a 38/62 balance with a usable minimum
conversation width. Compact screens select conversation or preview through
44-pixel tabs. The toolbar stays quiet and matches the shell's typography.

Directory cards use 13-pixel names, 12-pixel summaries, 32-pixel icons and 12-pixel
padding; selection and status do not enlarge cards or duplicate refresh content.
Drafts use a compact list with title, modified time and continuation action.

Draft creation is request-idempotent and the URL becomes durable after creation.
Unsent text and File bytes persist through the canonical authority-free composer
snapshot. Saving status follows the actual IndexedDB transaction, and leaving
waits for initial draft creation, snapshot capture and outstanding saves. Failed
creation or unavailable attachment bytes retain the page and unsent input.
Document reload/close asks for native confirmation while the latest composer
snapshot is unsaved; a completed transaction clears that protection.
A failed saved-draft read cannot display a fresh
composer or silently create a replacement. Renaming and deletion bind the current
revision; renaming an empty draft first completes its request-idempotent creation.
Deleting during creation waits for that same draft before cleanup. Restart resumes
pending admission or cleanup.

The preview is a real released sandbox surface in an isolated author Host.
Conversation resources have a local loading boundary: an asynchronous Flower read
must not detach the independent live preview through the page's loading fallback.
The first verified artifact can be applied automatically; later artifacts require
an explicit apply that respects unsaved application state. Failed builds keep the
last working preview and expose actual failure stages and bounded command output in
a keyboard-operable disclosure, including truncation notices. Installation reviews the
exact currently displayed artifact. Installation and access grants stay separate.
Each applied artifact and platform generation owns a fresh preview container,
including builds with identical package bytes. After confirmed close, an update
failure re-reads authoritative preview state before reopening; cancelling close
keeps the original surface and does not apply the artifact.
Toolbar Back, browser Back/Forward and Open installed application share the preview close confirmation
and persist the composer before navigation. A cancelled close keeps the current
surface; failed navigation reconciles and reopens a fresh preview container.
The shell leaves the draft route only after the installed target is authoritatively
present and its placement succeeds; a missing or stale target retains the draft.
A reload queries the original durable install request; it never starts another
request to guess the outcome. A committed install remains successful if inventory
refresh fails, and subsequent builds update the recorded installed instance.
After an authoritative `not_committed` outcome, Try again requests a fresh review
of the current preview instead of querying the same terminal failure forever.
Unknown outcomes retain the original request and never authorize another install.

## Restore saved data

Installed plugin details expose Restore saved data in the existing action menu. Discovery is read-only, including for enabled plugins. The user selects a retained record by date and instance suffix; Disable and continue is explicit when needed, and the Host then produces the exact review. A short confirmation states that current data is also retained. No permanent card, technical hash wall or automatic re-enable is added.

The dialog binds requests to the current session owner, target instance and read/write/admin permissions. Ordinary inventory refreshes preserve the review. Closing aborts reads; reopening the same target retains an uncertain plan and only checks status. Uncertain disabling likewise refreshes authoritative inventory without repeating the write. A completed recovery stays complete if list refresh fails. Source selection uses native keyboard-operable radio inputs; the existing Dialog owns isolation, dismissal and focus restoration, and mobile actions retain at least 44-pixel targets.

# Boundaries

Draft deletion first awaits the live preview's normal close and revocation, then
removes the author workspace. A cancelled close keeps the draft and surface; a
rejected deletion restores a fresh preview only while the draft remains active.
The product must not delete its authenticated author route before SDK retirement.

Management presentation never creates a second lifecycle or permission authority. Global placement applies only to this product modal and its confirmations, not to ordinary Workbench widget dialogs or menus.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterDrawer.tsx:1` - Source.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Source.

- redeven:internal/envapp/ui_src/src/ui/plugins/PluginRetainedDataDialog.browser.test.tsx:1 - Exercises single commits, uncertain outcomes, owner/target changes, permissions, focus, localized layouts and mobile geometry.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCreationWorkspace.browser.test.tsx` - Product interaction tests using fixture HTTP responses.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPreviewUpdates.browser.test.tsx` - Container lifetime across conversation suspension, identical-byte apply, rejected updates and cancelled close; the surface is a fixture.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginComposerPersistence.browser.test.tsx` - Real browser IndexedDB text/File restoration.

- `redeven:internal/envapp/ui_src/scripts/checkPluginCreationContinuity.mjs` - Built product Files, native Terminal and saved-composer continuity qualification; its plugin runtime is admission-only.
