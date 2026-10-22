---
type: AI Runtime Contract
title: Model request recovery
description: Recover frozen provider requests through one Engine budget and expose sanitized attempt progress without adding a product lifecycle.
tags: [ai, providers, recovery, diagnostics]
timestamp: 2026-10-20T00:00:00Z
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

- `redeven:internal/ai/model_gateway_terminal_deadline_test.go` - Terminal text, tools, truncation and content filtering release an open HTTP stream.

- `redeven:internal/ai/provider_failure.go` - Structured response-time retry advice and safe diagnostics.
