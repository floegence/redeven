---
type: UI Contract
title: Flower references, origin context and canonical admission
tags: [ui, flower, composer, references, floret]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Connection-local chips carry authorized discovery and frozen page/thread context into explicit Send. Floret alone owns admitted ordered references. Labels and paths grant no authority; source failures retain drafts and outbox reconciliation never overwrites newer input or creates duplicate canonical records.

# Contract

## Reference drafts
Launcher/Tessiven linked chips wrap/scroll in bounded input;editable @ requires whitespace boundary/collapsed caret. Focus changes color without changing1px geometry/shadow;retain candidate/action focus. Discover under immutable thread cwd or new-thread directory draft;slashless token uses bounded global matching. Root failures Retry,inaccessible descendants skip within bound.

Ordered file/directory/page/thread chips hold connection-memory local IDs/labels,never another connection/persistence. [Tool runtime](../ai/ai-tool-runtime.md#runtime) owns one-pass canonical MessageReference/context admission. Queue preview binds exact ThreadID/QueueID/ReferenceID;resubmit reauthorizes. Only outbox retains original ordinary launch until canonical confirmation/terminal cleanup;after admission read canonical references through current authorization,no second queryable mapping.

## Origin page
Capture requires no resource read or editor replacement; submission uses exact visible text, terminal current screen only, excluding unloaded/unauthorized facts.

Desktop Activity companion in both hosts captures origin immediately on explicit New or explicit open with no selected thread,including close reversal. Page switches/existing-thread opens never add context. Automatic reference alone cannot enable empty Send. Reuse context-preview/text component for draft/admitted snapshots without draft-authority transfer.

## Global Ask Flower

Redeven-owned pages expose pull readers through Floe's connection-local context-source registry. The deepest interacted source wins; menu/card focus preserves that origin. Instance IDs distinguish same-type Workbench widgets and retained preview tabs. Inputs, reading selections, file paths, terminal visible output, plugin identity and current thread identity are bounded facts, never instructions or execution authority. Hidden/inert sources cannot be captured. No background project scan is performed.

The global header action and `Mod+Shift+J` open one PromptCard; repeating the command focuses its existing draft. Activity, Workbench, preview overlays, standalone Tessiven and the Desktop launcher share this behavior. Desktop CodeSpace, Web Service and hosted application child windows forward title/credential-free URL through their session owner; they never gain shell IPC authority. User-opened external browsers and other OS applications are outside this scope.

Each fresh submission creates a task. Merely opening the card creates nothing. Context freezes at open; Send and unknown-admission Retry use the existing immutable request/staging path. No source watcher, automatic screenshot or model-driven capture continues during the answer.

### Explicit screenshots

The camera tool is the only screenshot trigger. It adds a previewable/removable image through ordinary attachment staging. Capture errors retain draft text and references; closing/reopening cancels the operation and discards late results. Source navigation or ownership changes reject the result, without silently choosing another window.

Desktop captures only the main-process-bound WebContents and visible region, with pre/post checks, visible privacy-marker rejection and bounded PNG size. Browser capture requires the native picker, a matching current-tab capture handle and native Region Capture. A bounded frame reader drains pre-crop frames and accepts the first new cropped frame; an explicit minimum frame rate keeps static sources responsive. Browsers without these verified capabilities report unavailable. Frames close and acquired tracks always stop. Prompt chrome remains mounted/focused but is omitted for the capture frame; it is restored before image encoding. Cross-origin embedded content is captured as pixels only, not inspected as host DOM; the image is a user-reviewed attachment, not a promise of automatic secret redaction.

## Thread references
Right-click/More/keyboard menu appends current-draft reference without selecting source/sending. Shared type dispatch owns identity/serialization/description;thread never becomes filesystem path. [Thread tools](../ai/flower-thread-queries.md) authorize further reads. Existing draft owner handles dedupe/preview/remove/recovery.

## Context actions
One authorized privacy-checked mapper emits ordered MessageReference and UserInput.Context snapshots. Malformed/forged/unknown input or failed projection rejects admission and preserves editable drafts.

One assistant.ask.flower action carries target/source/presentation/typed items. Runtime enforces privacy matrix:file_path for files,terminal_selection for terminal,process_snapshot for monitoring,bounded text_snapshot for Git/environment. Never reconstruct references from product action copies. Product routing commands independently resolve/authorize environment target. Missing thread/reference means absence;other Floret failures remain unavailable,no product fallback.

# Boundaries

Labels,paths/search/context are information,never filesystem/target/execution authority. They cannot change cwd,tool routing,permissions or attachment ownership. Floret owns admitted history;companion owns retained placement/dismissal/stream. Outbox cannot become canonical lifecycle or reference authority.

# Evidence

- `redeven:internal/flower_ui/src/composer/FlowerComposerContextReferences.tsx` - Source.
- `redeven:internal/flower_ui/src/FlowerTurnLauncherPanel.test.tsx` - Tests.

- `redeven:internal/envapp/ui_src/src/ui/widgets/FlowerContextPreviewWindow.tsx` - Source.
- `redeven:internal/envapp/ui_src/src/ui/flower/flowerPageContext.ts` - Source.

- [Shared surface](../../internal/flower_ui/src/FlowerSurface.tsx), [reference type dispatch](../../internal/flower_ui/src/composer/flowerDraftReferenceModel.ts) and [thread menu](../../internal/flower_ui/src/threads/FlowerThreadList.tsx).
- [Shared runtime identity](../../internal/flower_ui/src/flowerRuntimeIdentity.ts) and [Env App adapter regression](../../internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.test.ts).

- `redeven:desktop/src/welcome/environmentFlowerContext.ts` - Source.
- `redeven:desktop/src/welcome/environmentFlowerContext.test.ts` - Tests.

- `redeven:internal/envapp/ui_src/src/ui/flower/FlowerContextSource.tsx` - Source ownership adapter.
- `redeven:internal/flower_ui/src/manualScreenshot.ts` - Explicit gesture and cancellation.
- `redeven:desktop/src/main/manualScreenshot.ts` - Authorized native capture.
- `redeven:desktop/scripts/check-global-ask-flower.mjs` - Built Desktop/new-task/image/retry acceptance.
