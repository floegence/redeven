---
type: AI Runtime Contract
title: Model request recovery
tags: [ai, providers, recovery, diagnostics]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Floret owns retry admission, physical-request deadlines and attempt identity. Redeven supplies protocol facts through one adapter and displays the authoritative current view. Frozen input, confirmed tool exchanges and user cancellation retain their existing authority across transport recovery.

# Contract

Published Floret v7.58.0 shares provider.RetryAdviceForError across direct and Desktop paths. Adapters supply HTTP/stream/close-code facts; Engine owns bounded replay, cancellation, attempt identity and draft retirement.

Redeven neither repairs old cancellation records nor owns a second retry loop.

Adapter-owned response checks use typed diagnostic codes and reviewed constant
messages for output conflicts or gaps, tool namespace/argument conflicts, invalid
usage and native history preparation/commit failures. Classification does not
change retry advice, cancellation, response validation or tool dispatch. Original error messages and wrapped causes are retained separately from the
sanitized summary. Published Floret v7.101.0 owns the FailureDetails contract.
The authorized original field preserves complete HTTP/SSE bytes, messages,
status and native identifiers without truncation, normalization or redaction.
Bytes remain base64 in JSON; valid UTF-8 also has a readable original_body_text
view. Partial reads retain received bytes and explicitly mark incompleteness.
Request headers, keys and prompts are not collected. Returned evidence may
contain private provider content and must be rendered as literal text.

The Responses attempt collector normalizes failures before attaching transport
facts. Its versioned envelope preserves HTTP status, request/response identifiers,
terminal event, output index when known, and Floret attempt identity through
Desktop RPC and canonical failure storage. Logs serialize numeric timings and
only the safe failure classification, excluding original evidence. Restart retains the details without
replaying the request; older envelopes remain readable. Flower shows the safe
reason with collapsed, expandable and fully copyable original evidence. Display
and copy preserve whitespace; provider text is never interpreted as markup. Missing historical evidence is not
reconstructed.

Tool repetition diagnostics use only validated Floret ToolRepetition fields:
tool name, call ID, consecutive count, limit, prior feedback and non-execution.
They share the existing expandable/copyable error detail with canonical thread,
turn and run identity. No argument values are exposed. Historical failures retain
their safe reason without invented counts or claims that recovery feedback was
sent. Localized copy preserves saved-result and explicit-retry guidance.

# Boundaries

[Provider history](model-provider-surface-and-history.md) remains canonical. Recovery never creates a product retry loop, durable transport ledger or automatic replay of uncertain tool effects.

# Evidence

- `redeven:internal/ai/floret_request_timeout_integration_test.go` - Stream/argument deadlines, typed failure and resource release without dispatch.

- `redeven:internal/ai/provider_failure.go` - Structured response-time retry advice and safe diagnostics.
- `redeven:internal/ai/provider_failure_details_test.go` - Local failures, Desktop RPC, cancellation, retry advice and safe logs.
- `redeven:internal/ai/model_gateway_chatgpt_floret_test.go` - Canonical failure detail preservation across restart.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.contextErrors.test.shared.tsx` - Visible failure reason and complete copyable attempt evidence.
