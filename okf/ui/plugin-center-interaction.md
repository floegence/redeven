---
type: UI Contract
title: Plugin Center interaction
tags: [ui, plugins, plugin-center, workbench, accessibility]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Redeven owns retained Center navigation/search/filter/selection/scroll; Floe owns dialogs/presence/input. Authoring starts with centered composer and quiet canvas.

# Contract

## Management
Applications uses Floe's bounded viewport portal above retained windows, anchored to the original trigger; Workbench retains local Dock material. Launching never remounts/reparents documents. Center is a lazy retained Applications page, not new Activity item/modal/drawer. It fills existing content/chrome; mode changes resize the same page. Back returns to prior surface; shell navigation leaves; Escape closes narrow details/nested dialogs. Preserve search/filter/selection/scroll through history/navigation.

Center owns catalog/install/update/remove; exact installed/preview configuration opens global Settings then returns. Lock/recovery hides retained pages for unlock; covered content remains mounted/inert, yielding Flower/plugin windows. Open leaves only after exact placement succeeds. Settings gates input/portals through exit; global confirmations sit outside transformed/inert Workbench ancestors.

Use released controls/cards/Tags/fills, no resting contours/lift/custom shadows. Floe owns focus/busy/disabled/Tabs/modal sizing. Keep primary details/actions outside scroll and disclose evidence. Source tabs equal width with ellipsis/full names; mobile targets>=44px. Progress never moves cards; long locales/themes/reduced motion remain usable. Filters retain identity; refresh stays outside grid.

## Creation and persistence
Creation/history are addressable lazy content with shell chrome, awaiting authenticated readiness. Dedicated threads stay outside ordinary lists; Back traverses detail→history→Center. Resize stable container/iframe across modes; ordinary Flower stays retained/hidden. Navigation awaits close/persistence and respects cancel. One ordinary Send; no synthetic creation prompt. Refresh preserves embedded selection.

After Send conversation width defaults280–328px; released keyboard/drag separator permits280–720px while reserving360px canvas. Save preference through Desktop bridge/browser storage without overwriting on clamp. Mobile uses tabs/named44px pane controls. Fit/phone resize same iframe. One toolbar owns sizing/comments/build/install; low-frequency permissions use overflow. Only shell header owns native drag/insets.

Embedded HTML remains source, other media/file actions remain usable; other conversations keep inline HTML. Titles prefer user, then verified preview, then localized untitled without draft rewrites. Checks expose actual stages/logs.

Cards use13px titles/12px summaries-padding/32px icons without status growth or duplicate refresh. Managers see Add plugin only in unfiltered installed/discovery grids including empty, not loading/error/update. Published menu routes creation, marketplace with cleared filters, or source review and restores focus.

History is bounded, modification-ordered with mark/title/localized time/Continue and localized-untitled search. Refresh retains records/query with explicit states. Verified artifact icons bind digest/authenticated URL before installation; absent icons are neutral. Five-second visible/focus refresh preserves keyed focus/composer. Initialize/rename persist title; legacy verified names project without durable rename.

Create is idempotent and URL-durable. Authority-free IndexedDB stores unsent text/File bytes with transaction status. Navigation awaits create/capture/save; errors/missing bytes retain page. Uncommitted snapshots protect unload. Restart flushes bounded exact-session drafts/files/comments/route across private origins, restoring before ACK/mount then authorizing reads. Never transfer grants/credentials/ports/targets or replace on failed read. Revision-bound rename/delete await the same pending create; restart resumes cleanup/admission.

## Preview and installation
Released isolated author sandbox survives conversation loading. First verified artifact may auto-apply; subsequent Apply uses normal unsaved close review. Failed build keeps good preview/accessible diagnostics. Every artifact/platform generation gets a fresh container even for equal bytes. Confirmed close plus failed update rereads authority before reopening; canceled close keeps original. Back/Forward await close/persistence. Open installed retains author route/composer/thread/preview and opens a separate creation-owned surface; stale/missing targets fail in place.

Primary action is Install, Update for newer artifact, Open for current. Inspect exact pending bytes against formal instance before preview close; successful close applies those bytes and opens same review, otherwise stop. Conflicts offer explicit localized Flower repair via outbox; preserve composer and overflow Open. New builds cannot replace reviewed bytes. Metadata/draft observers preserve composer; equal scope/revision cannot restart save feedback. Changed release bytes require higher SemVer.

Reload reconciles original install identity; unknown blocks replacement. Committed installation survives inventory-read failure; later artifacts update that instance. Only authoritative not_committed permits fresh review. Installation and grants remain separate.

## Decoration
Stationary two-scale lattice/traveling theme illumination under type specimen, three samples, strokes/chart; neutral ink plus one warm accent, no fake window/paper/cursor. Four-second clip/opacity reveal-hold-dissolve changes ink only. Actual status is separate, never inferred progress. Hidden/inactive/failure pauses; reduced-motion/forced-colors is static/fully inked. Pointer illumination settles then stops; leave/drag/scroll/blur/lifecycle clears it. Touch/pen has no hover. Decoration intercepts no input and yields to sandbox.

## Comments and recovery
Released same-channel context-menu callbacks supply reviewed artifact/generation/frame and normalized geometry, never cross-origin DOM. Noninteractive pin/outline plus measured/clamped Floe popover retain anchor; busy Send keeps height. Provide keyboard/whole-preview alternatives and44px controls, without permanent cover/header. Comments open preview; accepted submission returns conversation without iframe unmount. New text during Send keeps editor open; close retains text/focus.

Same-thread durable outbox queues independently of ordinary composer, including active runs. Submit only explicit reviewed visual context; repair/comments inherit no unrelated files/references. Pending/unknown never resubmits; handler/storage/permission/input/admission guards apply. Selectors/text are untrusted; source editing/build approval/Apply/install remain explicit. Persist only authenticated-draft text; navigation/reload/replacement/resize/app input invalidates selection, not text. Send rechecks identity. Persistence errors block unsafe leaving; deletion clears snapshots after close.

Details discovers retained data read-only, even while enabled. Date/instance suffix identifies recovery; Disable and continue requests exact Host review with retention warning. No automatic enable/hash wall. Bind owner/instance/current RW-admin rights. Refresh retains review, close aborts reads. Unknown recovery checks status; unknown disable rereads inventory without repeating writes. Completed recovery survives list failure. Native radios/Floe Dialog own focus/isolation/keyboard and mobile targets.

# Boundaries

Delete awaits preview close/revocation then platform removal. Canceled close preserves drafts; rejected delete restores fresh preview only while active. Retire SDK before routes. Management grants no execution. Global placement covers confirmations/Settings, not ordinary widget menus.

# Evidence

November9 isolated production Desktop verified placements, Settings return, search, Back/Escape, history and narrow details, not model/plugin execution. Browser fixtures cover geometry/authority/preview/comments; IndexedDB/outbox tests cover drafts/lost receipts. scripts/check_plugin_creation_model.mjs qualifies actual generation/apply/install/restart/delete. Admission-only runtime continuity certifies Files/Terminal/composer only. Retained-data fixtures cover exact commits, unknown outcomes, authority, locales and focus.
