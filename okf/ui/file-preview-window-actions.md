---
type: UI Contract
title: File preview actions and dismissal
tags: [ui, files, preview, floating-windows, selection]
lifecycle: contract
reviewed_at: "2026-11-09"
---
# Summary

Redeven owns file actions, drafts and immediate cancellation; Floe owns titlebar, tabs and exit presence. Sorting moves opaque tabs/neighbors without external borders or insertion bars; release commits, cancel restores, reduced motion skips settling.

# Contract

## Window actions
Use Floe titleContent/WindowTabs/headerActions. One document has a title; multiple documents use scrollable closable tabs without replacing other controls. Tabs never drag/maximize the window. Blank header/grip/inactive feedback/separators move it; real and portaled controls retain pointer ownership. Labels do not select text.

Alt+Shift+Left/Right sorts; Escape cancels sorting before dismissal. Arrow/Home/End/Delete stay local with visible focus and full-name tooltips. Preserve selection, panels and iframes. Header holds Ask Flower, More and fixed controls; More owns Find/Copy path/Edit/Save/Discard/Download under existing policy. No extra path row.

One controller/panel per normalized path serves every filesystem entry. Reopening selects without reread/discard. Switching preserves nodes, drafts, position and mode, pausing inactive native media. Floe RetainedPanel keeps panels laid out at current viewport size, hidden/inert/ARIA-hidden rather than display:none; DOM order is independent of tab order. Each tab owns actions/loading/errors/Retry. Closing inactive tabs preserves selection; active selects adjacent; last closes window. Window close confirms all unsaved edits together, cancellation preserves all, saving prevents discard until settlement.

Attachments use source-identity tabs with independent loaders/retry/cancel/object URLs; repeat selects the same source. Snapshot inspectors, Workbench widgets and conversation-file back navigation keep separate ownership. Workbench content begins below header except sync notices; keyboard/Escape/Tab cannot leak to canvas/shell focus. FilePreviewActions owns availability/feedback; downloads preserve draft mapping and use [product Downloads](../ai/flower-task-files.md#downloads-and-panel), including child previews. Writable PDFs use Edit and PDF.js Unicode saves/NeedAppearances without replacement-font embedding. Live links open current objects; snapshots retain bytes; failed targets offer Retry/Open parent.

## Ask Flower context
The preview frame owns one active-file context reader, including titlebar and portaled actions. Tab changes update that reader; a menu freezes the file identity and explicit selection before focus changes. No selection submits only the file reference. Preview/editor wire validation admits a file reference plus explicit text snapshots; file-browser actions remain path-only. Selected text is a separate snapshot with the source path; preserve indentation, line endings and unsaved status. The file remains an authorized live resource, not a substitute for the frozen selected text. Read-only standalone previews use the same global source capture and intent builder, including the menu anchor; they do not replace the request with a no-argument callback. Monaco's shared adapter reads its model selection, never its hidden DOM input. Preview buttons capture selection on pointer down.

## Separate preview
More opens the active saved filesystem file in a separate Desktop window or browser tab. Busy/loading disables it; unsaved edits show localized save-first feedback without autosave/discard. Retain original document and drafts. Separate previews are read-only, with Ask Flower, Find, Copy path, Download, rendering and Retry. Attachments do not gain this filesystem action.

Ask Flower opens locally in the invoking preview and reveals one retained companion after admission. Native titlebar/context menu/shortcut share that renderer; browser requests create no extra tab. Preserve iframe/scroll/focus through cancellation/completion. Canonical file context/cwd feed the normal launcher. Screenshots require explicit capture. Model/runtime settings and directory browsing have local surfaces; unsupported terminal/app/plugin/navigation commands are absent. Register only supported preview commands, not invisible main-shell shortcuts.

Used downloads expose local progress/error/retry. Task/mobile panels load lazily with localized pending feedback and retain mounts through close presence. Route detection remains separate from lazy implementation and initial-build budgets. Authorized HTML links open another native preview or navigate the browser tab with history, never invisible accumulated panels.

window=file-preview&path=... uses the existing access gate, recovery, controller and sandboxed renderers, filename title and no shell chrome or URL credentials. Invalid/ambiguous paths load nothing. Reads/media retain Runtime authorization; the route grants none. Browser opening is synchronous with click, preserves session bootstrap and clears opener; blocked opens fail without retries.

Desktop's dedicated IPC accepts a bounded absolute identity. Main validates live session, top-level sender and trusted Env entry, deriving URL/partition from that session. Independent OS windows share theme/language and native reading bounds. Session+path deduplicates: repeat focuses without navigation, close retires identity, reopen creates fresh. Native failure never falls through to browser. Session shutdown owns children.

## Preview retirement
Accepted close immediately cancels/fences reads and disables new edits/retries/probes. Keep document/title/resources through Floe exit, releasing on unmount. Tab switches do not close controllers. Reopen reverses the same presence owner; stale release cannot clear newer content. Store constant-size presentation references, not copied lifecycle/timers, blank iframes or extra reads. Disposal fences late replies.

## Files window retirement
Explicit close clears requests/restores focus immediately while host retains last title/key/browser through inert exit. Reopen cancels that exit; old completions, detached browsers and timers cannot survive. Later actions do not wait for animation. The 1,000-entry/five-cycle fixture checks synchronous close, focus, underlying action and <50-ms frames.

# Boundaries

Loading/errors remain in body. [Rendering](file-preview-viewport-and-rendering.md) owns scale/bounds/async rendering. Window changes never bypass discard or duplicate close/motion policy. Controller owns requests/focus; host retains presentation only. Browser/Electron compositor samples certify tested scenarios, not every display or installer.

# Evidence

FilePreviewWorkspace and FlowerAttachmentPreviewTabs browser suites cover tabs, actions, keyboard, narrow geometry, retries and release; FlowerTurnLauncherWindow.preview covers capture/focus/Escape. desktop/scripts/check-{office-preview,file-preview-continuity,file-preview-popout}.mjs qualify built Electron/product controllers, retained dark documents, authorization, read-only routing, drafts, local Flower/settings/capture and supervised cleanup. November 6 Floe 0.96.0/Electron 45.1.0 fixtures passed 16 switches with no light samples/repeated reads and preserved scroll; reintroducing display:none failed. External images stay outside source. These are scoped renderer/Runtime results, not all-platform installer qualification.

`redeven:desktop/scripts/check-ask-flower-previews.mjs` checks built Runtime/Electron code and Markdown selections, titlebar context, repeated right-click focus, standalone previews, canonical/provider equality, real file-tool execution and visible replies.
