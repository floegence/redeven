---
type: AI Runtime Contract
title: Model request recovery
tags: [ai, providers, recovery, diagnostics]
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Floret owns retry admission, physical-request deadlines and attempt identity. Redeven supplies protocol facts through one adapter and displays the authoritative current view. Frozen input, confirmed tool exchanges and user cancellation retain their existing authority across transport recovery.

# Contract

Published Floret v7.58.0 shares provider.RetryAdviceForError across direct and Desktop paths. Adapters supply HTTP/stream/close-code facts; Engine owns bounded replay, cancellation, attempt identity and draft retirement.

Redeven neither repairs old cancellation records nor owns a second retry loop.

# Boundaries

[Provider history](model-provider-surface-and-history.md) remains canonical. Recovery never creates a product retry loop, durable transport ledger or automatic replay of uncertain tool effects.

# Evidence

- `redeven:internal/ai/floret_request_timeout_integration_test.go` - Heartbeat and incomplete-argument deadlines, typed failures, no dispatch, and released admission/HTTP resources.

- `redeven:internal/ai/provider_failure.go` - Structured response-time retry advice and safe diagnostics.
