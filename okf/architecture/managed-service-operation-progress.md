---
type: Runtime Contract
title: Managed Service operation progress
tags: [architecture, managed-services, operations, observability, security, ui]
lifecycle: contract
reviewed_at: "2026-11-06"
---
# Summary

Manager Reporter owns live output; Registry owns history. One operation ID retains disclosure/completion through refresh. Redact command templates before storage; output grants no identity. Capture/storage/transport failures must not expose secrets, queries, private paths or control bytes.

# Contract

## Reporter and persisted detail
ManagedOperationProgressDetail schema v2 alone owns detail. Duplicate command IDs get deterministic suffixes. Failed uninstall retains records/output for [reviewed recovery](service-management-recovery.md#management-recovery).

## Service-row interaction
Page state keys disclosure by operation_id, never component/service-object identity. Rejected submissions retain local safe failure without backend operation or observed-state change. Compact status opens explicitly; failure labels/notices survive settlement and dismissal. Reduced motion removes animation, not readable completion hold.

## Install admission and handoff
Final install immediately closes the template drawer, clears collection filters and shows a request-owned row at the service's append position. This row is presentation only, never a fabricated ServiceView or persistent cache entry. A raw CreateResult binds its reviewed service ID to the real operation; slow collection refresh cannot hide operation details, cancellation or terminal outcome. Full ServiceView handoff preserves expansion and transfers focus only when the replaced row owned it. No management drawer or service window opens automatically.

Explicit rejection offers fresh review with non-secret inputs; secrets clear with the drawer. Ambiguous transport outcomes offer read-only request-ID receipt lookup, never blind POST replay. A missing receipt proves no rejection. Accepted work uses existing lifecycle retry, not new creation. Identity/permission generations fence late results; reopening a drawer cannot cancel work or let an earlier review overwrite it.

## Execution panel
Published Floe planes, ink, LinearProgress, StableText and presence compose a connected rail and fixed-height panel. Narrow rail reveals its current step without scrolling the page. Open details show commands/output immediately in one scrolling transcript; no secondary disclosure. Logs/transfer/stage changes preserve neighboring geometry and existing output nodes. Preserve canonical interleaved output order; follow only while already at the end.

Restrained transitions retain progress identity. Reduced motion is static. Open is natively disabled during operations with its ordinary icon and keyboard/touch/hover action-stage tooltip.

# Boundaries

Operation output is observability data, not a terminal, shell, downloadable transcript, or raw debug channel. Renderer cannot request an unredacted variant. Template hooks parse it, and the generic URL validator keeps their result outside this progress document.

# Evidence

- `redeven:internal/managedwebservice/operation_progress.go` - Redacted detail owner.
- `redeven:internal/envapp/ui_src/src/ui/pages/ManagedServiceOperation.browser.test.tsx` - Bounded transcript, retained reading, disabled Open, current step, themes/locales and reduced motion.

- `redeven:internal/envapp/ui_src/src/ui/pages/WebServicesPage.browser.test.tsx` - Real drawer install handoff, delayed receipt/list, focus and expansion continuity across wide/narrow light/dark locales and reduced motion.
