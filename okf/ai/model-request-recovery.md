---
type: AI Runtime Contract
title: Model request recovery
tags: [ai, providers, recovery, diagnostics]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Floret owns retry admission, physical-request deadlines and attempt identity. Redeven supplies protocol facts through one adapter and displays the authoritative current view. Frozen input, confirmed tool exchanges and user cancellation retain their existing authority across transport recovery.

# Contract

Published Floret v7.58.0 shares provider.RetryAdviceForError across direct and Desktop paths. Adapters supply HTTP/stream/close-code facts; Engine owns bounded replay, cancellation, attempt identity and draft retirement.

Redeven neither repairs old cancellation records nor owns a second retry loop.

Adapter-owned response checks use typed diagnostic codes and reviewed constant
messages for output conflicts or gaps, tool namespace/argument conflicts, invalid
usage and native history preparation/commit failures. Classification does not
change retry advice, cancellation, response validation or tool dispatch. Private
causes remain in the in-process error chain; arbitrary error prose, prompts and
raw response bodies never become diagnostic text.

The Responses attempt collector normalizes failures before attaching transport
facts. Its bounded envelope preserves HTTP status, request/response identifiers,
terminal event, output index when known, and Floret attempt identity through
Desktop RPC and canonical failure storage. Logs serialize numeric timings and
the same safe failure classification. Restart retains the details without
replaying the request; older envelopes remain readable. Flower shows the safe
reason with expandable, copyable evidence. Missing historical evidence is not
reconstructed.

# Boundaries

[Provider history](model-provider-surface-and-history.md) remains canonical. Recovery never creates a product retry loop, durable transport ledger or automatic replay of uncertain tool effects.

# Evidence

- `redeven:internal/ai/floret_request_timeout_integration_test.go` - Stream/argument deadlines, typed failure and resource release without dispatch.

- `redeven:internal/ai/provider_failure.go` - Structured response-time retry advice and safe diagnostics.
- `redeven:internal/ai/provider_failure_details_test.go` - Local failures, Desktop RPC, cancellation, retry advice and safe logs.
- `redeven:internal/ai/model_gateway_chatgpt_floret_test.go` - Canonical failure detail preservation across restart.
- `redeven:internal/envapp/ui_src/src/ui/FlowerSurface.contextErrors.test.shared.tsx` - Visible failure reason and complete copyable attempt evidence.
