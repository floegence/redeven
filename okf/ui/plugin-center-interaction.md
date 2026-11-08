---
type: UI Contract
title: Plugin Center interaction
tags: [ui, plugins, plugin-center, workbench, accessibility]
lifecycle: contract
reviewed_at: "2026-11-08"
---
# Summary

Redeven owns Plugin Center navigation; Floe owns dialogs, presence and input. Workbench uses a retained drawer and Activity the same directory page. Search/filter/selection/scroll persist. Closing management does not cancel Host execution; released ReDevPlugin owns lifecycle, permissions and surface authority.

# Contract

## Management placement and input
Only Plugin Center explicitly selects global Dialog placement at the product modal layer. Recent Dock or widget interactions cannot mount the drawer under `.workbench-surface`, `inert`, or a transformed canvas ancestor.

Workbench Open closes the drawer and focuses its widget. Activity opens above the retained directory. Failed Open keeps context and error feedback.

## Directory and responsive details
Source and lifecycle filters preserve identity. Refresh status stays outside the card grid.

## Shared design language

Directory, details and install/update reviews compose released Floe controls. Cards use the shared default plane and selection fill without resting contours, lift, magnification or custom shadows. Shared Tags present source/lifecycle without changing Host authority.

Floe owns Input focus, Button pending/disabled states and Tabs keyboard behavior.
Redeven owns search, filters, selection and scroll. Menu triggers have one focusable
boundary, neutral hover and visible focus. Details keep primary actions outside
the scroll body; secondary evidence stays in disclosures.

Compact source tabs use three equal columns with ellipsis and full accessible names. Mobile targets remain at least 44px. Install progress replaces the primary action without shifting cards. Shared controls support reduced motion, long localized copy and both themes.

External source changes may increase body height. Published Floe Dialog keeps the scrollbar gutter and widths stable during height transitions; content remains scrollable.

## Plugin creation workspace

Creation is an addressable full page loaded lazily outside the initial shell graph.
Deep links await authenticated environment/plugin readiness before reading drafts.
Files, Terminal, ordinary Flower and Workbench retain their instances. Embedded
Flower owns one composer and ordinary Send; no secondary creation intent or
synthesized empty-input prompt exists.
A new draft has one centered creation composer on a quiet canvas, without an
empty split preview. The landing page and pre-preview canvas share a faint dot
field and slow ambient drift. An original SVG application silhouette uses restrained
assembly motion and concise actual status, without simulated progress. Theme-token
decoration never captures input, pauses while hidden or after failure, and respects
reduced motion; forced colors omit the background.
A live sandbox replaces the placeholder and its motion. After submission the conversation occupies a compact
280–328px column and the application becomes the primary canvas. Fit and phone
width controls resize the same live iframe without moving or recreating it. Compact screens select conversation or preview through
44-pixel icon tabs within the same toolbar, with accessible names and a visible
project title. The dedicated page omits the ordinary display-mode top bar. One compact
toolbar owns preview sizes, comments, build status and
installation; permissions remain in its overflow menu. The live application fills
the remaining area without a nested header, card border or bottom tool dock.
The embedded conversation explicitly renders HTML links and fences as source;
the sandbox owns the live application. Source links still open through the host's
file action, and reference images, audio and video retain their ordinary rendering.
Other Flower conversations retain inline HTML previews.
Workspace/history use shared Desktop drag and native-control insets. A user title
wins; otherwise show verified preview name, then localized untitled, without renaming
stored drafts. Checks reflect actual stages; detailed output opens on demand.

Directory cards use 13px names, 12px summaries/padding and 32px icons.
Selection/status never enlarge cards or duplicate refresh content.
The unfiltered installed/discovery grid ends with an Add plugin card for managers,
including an empty directory. Its released Floe menu opens creation or the existing
installation review; it is absent during loading/errors, filtered searches and updates.
Menu dismissal and installation return focus to the card. Compact toolbar actions
keep accessible names while using icons to leave room for translated titles.

Creation history uses a bounded-width list ordered by modification time: project
mark, title, localized timestamp and continuation. Search includes localized untitled
names. Refresh retains records/query; loading, retry and empty states stay explicit.
Draft records never imply generated icons or build status. Initialization and Flower
renaming persist project titles; polling refreshes them without remounting the composer.
Unnamed legacy projects display verified package names without changing durable titles.

Draft creation is request-idempotent and the URL becomes durable after creation.
Unsent text and File bytes persist through the canonical authority-free composer
snapshot. Saving status follows the actual IndexedDB transaction, and leaving
waits for initial draft creation, snapshot capture and outstanding saves. Failed
creation or unavailable attachment bytes retain the page and unsent input.
Document reload/close asks for native confirmation while the latest composer
snapshot is unsaved; a completed transaction clears that protection.
Desktop Runtime restart flushes the active workspace before capture. The existing
bounded, exact-session restart handoff carries cached draft snapshots, File bytes,
comment text and the current draft route across the new private origin. Restoration
commits that cache before acknowledging the handoff or mounting the workspace, so
a subsequent reload retains it. Server authorization still precedes reading a
restored draft; surface targets, ports, credentials and grants are never restored.
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
Back/Forward await preview close and composer persistence; cancellation retains the
surface and failure reconciles it. Open installed retains the route, conversation,
composer and preview, showing an independent creation-owned floating surface in
either display mode. Missing or stale targets keep the workspace and report failure.

One primary action shows Install, Update for newer artifacts, or Open when current.
Install/Update first applies a pending artifact through normal close confirmation,
then reviews those exact bytes; it never commits without confirmation. Cancellation
or failure stops the sequence. Open remains in the overflow menu during iteration.
Review copy uses the Host's install/update intent. New builds arriving during review
cannot replace its artifact. Composer identity survives draft metadata refreshes.
Authoring increments source SemVer for changed bytes; Host update rules remain exact.
Reload queries the original durable request; unknown outcomes prohibit another
install. A committed install survives inventory refresh failure. Subsequent builds
update the recorded instance; authoritative not_committed outcomes allow fresh review.

## Canvas comments

Native right-click observations use the released upstream opt-in context-menu
callback on the same sandbox channel. Product never reads cross-origin DOM.
The selection binds the exact artifact, preview generation and current platform
frame. Normalized geometry draws a non-interactive outline and pin; a compact
selection-adjacent comment popover accepts explicit submission and clamps to the
canvas edges. Position is measured before reveal; published Floe presence owns
enter/exit and reduced motion. Freshness changes do not move the editing anchor.
Busy feedback stays on Send without a paragraph or height shift. Keyboard context
menus and whole-preview comments are alternatives. Closing preserves text and focus.
Compact screens retain 44-pixel comment action targets and legible input without
adding another header or permanently covering the application.
Their whole-preview comment and preview-update actions sit in the existing overflow
menu, preserving readable title space across translated labels. A pending update
marks that menu with a small dot; applying it remains an explicit choice. Selecting
the comment action opens the preview tab. Once a comment is accepted, compact
screens return to the conversation so Flower progress is visible; the live preview
remains mounted. New edits made during submission keep the comment editor open.

Comments are independent of the canonical composer and enter its existing durable
Flower outbox for the same dedicated thread. Unsent text, references and files
remain untouched. Pending or uncertain sends cannot be duplicated; normal outbox
recovery remains authoritative. Selection text is untrusted quoted context and
never grants execution authority. Source edits and builds retain normal approval;
preview application and installation remain explicit existing actions.

Only comment text is cached under the authenticated draft key. Reload, preview
replacement, navigation, resizing and application interaction invalidate selection,
not text. Submission rechecks the live frame/artifact. Failed persistence protects
unload and blocks navigation; deletion removes snapshots after surface closure.

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

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginAddCard.browser.test.tsx` and `redeven:internal/envapp/ui_src/src/ui/plugins/PluginDraftLibrary.browser.test.tsx` cover entry actions, focus, permission/loading restrictions, history search/retry and responsive themes.

- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginManagement.browser.test.tsx` - Tests.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterDrawer.tsx:1` - Source.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx:1` - Source.

- redeven:internal/envapp/ui_src/src/ui/plugins/PluginRetainedDataDialog.browser.test.tsx:1 - Exercises single commits, uncertain outcomes, owner/target changes, permissions, focus, localized layouts and mobile geometry.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCreationWorkspace.browser.test.tsx` - Product interaction tests using fixture HTTP responses.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginPreviewUpdates.browser.test.tsx` - Preview/composer lifetime and repeated install/update review; fixture surfaces.
- `redeven:internal/envapp/ui_src/src/ui/plugins/pluginComposerPersistence.browser.test.tsx` - Real browser IndexedDB text/File restoration.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCanvasWorkflow.browser.test.tsx` - Artifact-bound comment state, viewport invalidation, single-toolbar Desktop control insets and persistence failures; the sandbox is a fixture.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginFlowerAdmission.browser.test.tsx` - Real Flower outbox admission, retained ordinary input and exact-request recovery after lost receipts.
- `redeven:scripts/check_plugin_creation_model.mjs` - Explicit real-model qualification for generation, right-click revision, preview apply, installation, restart and draft deletion; separate from fixture layout evidence.

- `redeven:internal/envapp/ui_src/scripts/checkPluginCreationContinuity.mjs` - Built product Files, native Terminal and saved-composer continuity qualification; its plugin runtime is admission-only.
