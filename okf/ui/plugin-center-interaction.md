---
type: UI Contract
title: Plugin Center interaction
tags: [ui, plugins, plugin-center, workbench, accessibility]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Redeven owns Plugin Center navigation; Floe owns dialogs, presence and input. Workbench uses a retained drawer and Activity the same directory page. Search/filter/selection/scroll persist. Closing management does not cancel Host execution; released ReDevPlugin owns lifecycle, permissions and surface authority.

# Contract

## Management placement and input
Only Plugin Center explicitly selects global Dialog placement at the product modal layer. Recent Dock or widget interactions cannot mount the drawer under `.workbench-surface`, `inert`, or a transformed canvas ancestor.

A successful Open closes management and focuses the target after canvas input becomes available; a failed Open preserves the directory and error feedback.

## Directory and responsive details
Local filters combine source (official or community) and lifecycle without rebuilding identity. Refresh status remains outside the card grid, so a pending refresh cannot appear as a duplicate card.

## Shared design language

The directory, detail actions, package-install source form and update review compose released Floe controls. Cards use the shared default plane, without visible resting contours, decorative lift, icon magnification or custom shadow stacks. Selected cards use the shared selection fill. Shared Tags carry source/lifecycle semantics without changing Host authority.

Floe owns Input focus, Button pending/disabled treatment and Tabs keyboard/selection behavior. Search, source/lifecycle filters, retained selection and scroll remain product state. Menu triggers are single focusable boundaries with centered content, neutral hover and visible keyboard focus; nested trigger boxes are avoided. Details keep primary actions outside their scroll body, with secondary evidence in quiet disclosures.

Source tabs retain complete accessible names, with ellipsized labels in three equal columns on compact dialogs. Mobile actions remain at least 44px; install progress replaces the primary action without changing card/sibling geometry. Reduced-motion, localized long copy and light/dark themes use the same shared controls.

External source changes may increase body height. Published Floe Dialog keeps the scrollbar gutter and widths stable during height transitions; content remains scrollable.

## Plugin creation workspace

Creation opens a full product page, with an addressable draft and return path.
Creation and draft-library code load on navigation, outside the initial shell graph.
Deep links wait for the authenticated environment and plugin session before mounting
the draft reader; they do not turn connection startup into a failed draft read.
Files, Terminal, the ordinary Flower surface and Workbench retain their existing
instances while this page is active. The dedicated embedded Flower surface owns
one composer; requirements and implementation requests use its ordinary Send
action. There is no secondary creation intent or synthesized empty-input prompt.
A new draft has one centered creation composer on a quiet canvas, without an
empty split preview. The landing page and pre-preview canvas share a faint dot
field and slow ambient drift. The placeholder gently rearranges into alternative
application layouts without suggesting measurable build progress. Decoration uses
theme tokens, never captures input, pauses off-screen or in a hidden document,
and becomes static with reduced motion; forced colors omit the background.
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
Both the workspace and directly opened draft library use the shared Desktop drag contract and native window-control
insets; removing the outer header must not place actions under system controls.
The toolbar preserves a user-assigned draft title; otherwise it shows the
verified active preview name, falling back to the localized untitled label only
before a preview is available. This display choice does not rename stored drafts.
The compact checks action reflects actual running, failed, passed or unrun stages;
it never displays a success icon before checks have passed. Detailed output opens
on demand without adding another permanent header.

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

## Canvas comments

Native right-click observations use the released upstream opt-in context-menu
callback on the same sandbox channel. Product never reads cross-origin DOM.
The selection binds the exact artifact, preview generation and current platform
frame. Normalized geometry draws a non-interactive outline and pin; a compact
selection-adjacent comment popover accepts explicit submission and clamps to the
canvas edges. Its target, text and send action form one compact editing surface. Keyboard context menus and the toolbar's
whole-preview comment provide alternatives. Closing the panel preserves text.
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
replacement, navigation, resizing and subsequent application interaction require
a new selection; text survives. Submission rechecks the live frame and artifact.
Failed local persistence keeps unload protection and blocks navigation. Draft
deletion removes its composer and comment snapshots after surface closure.

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
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginCanvasWorkflow.browser.test.tsx` - Artifact-bound comment state, viewport invalidation, single-toolbar Desktop control insets and persistence failures; the sandbox is a fixture.
- `redeven:internal/envapp/ui_src/src/ui/plugins/PluginFlowerAdmission.browser.test.tsx` - Real Flower outbox admission, retained ordinary input and exact-request recovery after lost receipts.
- `redeven:scripts/check_plugin_creation_model.mjs` - Explicit real-model qualification for generation, right-click revision, preview apply, installation, restart and draft deletion; separate from fixture layout evidence.

- `redeven:internal/envapp/ui_src/scripts/checkPluginCreationContinuity.mjs` - Built product Files, native Terminal and saved-composer continuity qualification; its plugin runtime is admission-only.
