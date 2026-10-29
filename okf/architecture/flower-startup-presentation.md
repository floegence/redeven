---
type: Interaction Contract
title: Flower startup and recovery presentation
tags: [flower, startup, readiness, recovery, ui]
lifecycle: contract
reviewed_at: "2026-10-25"
---
# Summary

Env App/Desktop project one owner's readiness and typed Stop/Retry while retaining navigation and drafts. Close failure requires restart; unknown or contradictory facts are non-retryable contract failures. No surface adds an availability controller. First content admits the workspace; later refresh/reconnect retains mounted conversation state.

# Contract

- Activity, Workbench and Settings share readiness. After Runtime readiness, retain Flower loading until the first authoritative list page or selected detail is applied. Confirmed empty lists admit; empty partial-ready envelopes do not. Remaining pages load progressively. Embedded conversations wait only for their own detail.
- Before admission, hide welcome suggestions, composer and stale reconnect banners. Initial retries retain loading; terminal failure stops the indicator and offers localized Retry/access/version/capacity/timeout guidance. No raw diagnostics/error card or extra UI timer/controller.
- A collapsed Activity companion presents runtime preparation/failure and initial conversation loading/failure as one bounded status button, including the 24-pixel Terminal footer. Pointer or keyboard activation opens details without retrying or stopping work. Expanded details retain close, progress and explicit recovery actions. Readiness never auto-expands the companion; compact presentation derives from the existing shell phase and readiness owner.
- After admission, refresh/reconnect preserves selection, transcript, drafts and navigation with existing notices. [Message continuity](../ui/flower-live-timeline.md) also retains prose during growth/completion; body locators cannot restart loading.
- Historical preparation leaves the operational generation mounted. Thread-local loading/failure retains New chat/navigation; only oldest snapshot stores may wait for their identity scan before new-thread admission.
- Unconfirmed/failed/revoked permissions block mutations until renewed. Show completed/total counts only for known totals.

# Boundaries

Readiness is process-local availability, never Agent lifecycle. [Generation ownership](ai-readiness-lifecycle.md) and [complete-set recovery](../ai/flower-backup-and-recovery.md) remain authoritative.

# Evidence

- [Companion readiness browser tests](../../internal/envapp/ui_src/src/ui/FlowerSurface.companionReadiness.browser.test.tsx) cover real companion geometry across both startup boundaries, explicit recovery, keyboard operation, localization, reduced motion and forced colors.

- `redeven:desktop/src/welcome/flower/DesktopFlowerRuntimeBoundary.client.test.tsx:1` - Stop deduplication, explicit retry, failure and draft continuity.
