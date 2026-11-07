---
type: UI Contract
title: File preview actions and dismissal
tags: [ui, files, preview, floating-windows, selection]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Redeven owns file actions, drafts and immediate cancellation; Floe owns titlebar, tabs and exit presence. Retained panels preserve document state through switching and close motion. Accepted dismissal fences work before releasing resources, with unsaved-change confirmation and responsive focus restoration.

# Contract

## Window actions
Activity consumes Floe titleContent/WindowTabs/headerActions. One document has ordinary title;>=2 replace title only with scrollable closable tabs. Selection never drags/maximizes. Blank header/grip/inactive feedback/separators move window; real controls own pointer,including portaled actions via physical titlebar ownership. Labels do not select text.

Sorting retains opaque face/quiet shadow under pointer,shifts neighbors/settles without insertion bar/external border. Commit order on release,cancel restores; reduced motion skips settling. Alt+Shift+Left/Right sorts;Escape cancels before dismissal. Preserve selection/panel DOM/live iframes. Arrow/Home/End/Delete stay local;focus visible,long names truncate/full path tooltip. Header retains Ask Flower/More/fixed controls. More owns Find/Copy path/Edit/Save/Discard/Download with existing permission/selection/feedback;no extra path row.

One retained controller/panel per normalized path serves all filesystem entries; repeated open selects without reread/discard. Switching preserves draft/nodes/position/mode and pauses inactive native media. Published Floe RetainedPanel keeps each inactive panel laid out at the current viewport size with visibility hidden, inert and ARIA-hidden; never use hidden/display:none for tab activation. Panel DOM order remains independent of tab order. Independent actions/load/errors/Retry per tab. Inactive close preserves active;active close selects adjacent;last closes window. Window close confirms all unsaved together;cancel preserves all. Saving blocks discard until settled.

Flower attachments use source-identity tabs through same header in both hosts,independent loaders/retry/cancel/object-URL retirement;repeat selects existing source. Snapshot inspectors,Workbench widgets and modal conversation-file back navigation retain separate ownership. Workbench starts beneath header except sync notices;tooltip/Copy exposes path,keyboard/Escape/Tab cannot trigger canvas or shell focus reclaim. FilePreviewActions is sole availability/feedback owner and download builder retains draft mapping. Writable PDFs use Edit;PDF.js saves Unicode,NeedAppearances for unsupported fonts,no replacement-font embed. Product Downloads owns all downloads,including child previews ([lifetime](../ai/flower-task-files.md#downloads-and-panel)). Live navigation opens current objects;historical snapshots retain bytes;failed targets offer Retry/Open parent.

## Preview retirement
Cancel/fence reads immediately on accepted close; no new edits/retries/probes. Retain document/title/existing resources through Floe exit,release on unmount;switching tabs never closes controller. Reopen reverses same presence owner;old release cannot clear current/retained preview. Store constant-size presentation token/references only,no copied lifecycle/timer/blank iframe/extra read or brightness rebound. Disposal always cleans/fences late responses.

## Files window retirement
Explicit close clears browser request/restores focus immediately while host memoizes last title/key/live browser through shared inert exit. Same owner cancels exit on reopen;no old completion/detached browser/timeout survives. Subsequent actions need not await motion. A1000-entry/five-cycle fixture checks synchronous close,opener focus,underlying action and<50ms frame intervals.

# Boundaries

Loading/errors stay in body. [Rendering](file-preview-viewport-and-rendering.md) owns scale,bounds/async renderer; window changes cannot bypass discard,duplicate close policy or alter Floe motion. Controller owns requests/focus;host retains presentation only,never snapshots/polling. Compositor sampling qualifies tested browser/Electron renderer scenarios,not every display frame or an installer release.

# Evidence

- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewWorkspace.browser.test.tsx` - Multi-document state, actions, keyboard, narrow header and CSV-mode acceptance.
- `redeven:internal/envapp/ui_src/src/ui/FlowerAttachmentPreviewTabs.browser.test.tsx` - Attachment identity, retry, cancellation and resource release.
- `redeven:desktop/scripts/check-office-preview.mjs` - Real Electron `file://` acceptance verifies header tabs, retained CSV canvas/zoom/source state, close-to-single and Escape.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewSurface.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewPanel.tsx` - Source.

- `redeven:internal/envapp/ui_src/src/ui/widgets/createFilePreviewController.ts` - Source.

- `redeven:internal/envapp/ui_src/src/ui/widgets/createFileBrowserSurfaceController.ts` - Source.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserSurfaceHost.browser.test.tsx` - Tests.

- `redeven:internal/envapp/ui_src/scripts/previewContinuityAcceptance.mjs` - Shared Chromium/Electron multi-point compositor sampling, real tab controls, scroll/input/script identity and inactive input checks.
- `redeven:internal/envapp/ui_src/src/ui/widgets/FilePreviewWorkspace.browser.test.tsx` - Dark HTML in light/dark shells at mobile/desktop widths, late reads and rapid selection.
- `redeven:desktop/scripts/check-file-preview-continuity.mjs` - Production-built file:// Electron workspace with real product controllers/panels, deterministic byte transport, optional external HTML evidence and verified cleanup; no installer claim.
- 2026-11-06: published Floe 0.96.0, Electron 45.1.0; synthetic and two supplied dark reports each passed 16 tab switches with zero light samples, preserved scroll420, no repeated read and verified disposal. Reintroducing display:none failed the same retained-viewport assertion. External documents/screenshots stay outside tracked source.
