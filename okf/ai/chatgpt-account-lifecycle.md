---
type: Authentication Contract
title: ChatGPT account lifecycle
description: Persist verified local sign-ins, reuse issued registrations and complete renewal, cancellation and logout independently of connection editing.
tags: [ai, flower, authentication, openai, runtime, security]
timestamp: 2026-10-14T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven's canonical protected account store owns verified ChatGPT registrations
and sessions. Returning setup reuses saved registrations; only explicit new-account
or workspace intent creates another. Email is never a registration or workspace
key. OAuth completion persists sign-in independently of connection
editing; identity-only grants never admit inference. Retry reuses issued client
identity with fresh OAuth inputs. Renewal and logout serialize rotating tokens.
Cancellation never installs usable credentials after its commit boundary, and
interrupted cleanup uses the existing durable logout journal. Storage failure
stops account use; local cleanup and remote revocation remain separate outcomes.
Local admission is owned by the [authentication contract](chatgpt-local-authentication.md).

# Contract

## Sign-in and registration
One `chatgpt.Client` owns bounded, five-minute in-memory attempts.

Interrupted logout is completed at startup; normal maintenance scans never clear a live logout.

## Renewal and credential coordination
[Account maintenance](../../internal/chatgpt/lifecycle.go) starts with the Runtime service, independently of AI readiness, connection bindings and open windows. Runtime shutdown cancels maintenance without signing out and never schedules OS background work.

Account updates use model_directory.changed and merge independently of drafts.

## Logout and connection changes
Sign-out first records intent and stops related tasks through Floret's existing immediate Cancel with descendants. The private Desktop model source observes current account facts once per second and passes confirmed account stop reasons to its owning Runtime; it never owns another task lifecycle.

The Runtime Service protocol, secrets schema, Floret public API and domain migration remain unchanged.

# Boundaries

This concept owns local registration and credential lifecycle. Connection configuration stores only account bindings; it cannot commit or roll back OAuth tokens. Cancellation cleanup may retain a verified signed-out registration, and remote revocation failure never becomes confirmed success.

# Evidence

- `redeven:internal/chatgpt/client.go` - Bounded OAuth attempts, verified credential commit, issued-client recovery and canceled-session cleanup.

- `redeven:internal/chatgpt/account_lifecycle_contract_test.go` - Repeated code failures, identity-only persistence, cancellation during exchange/installation, unconfirmed revocation and unbound renewal.

- `redeven:internal/chatgpt/lifecycle_test.go` - Clock resume, cross-process rotation, logout races, storage faults and startup recovery.
