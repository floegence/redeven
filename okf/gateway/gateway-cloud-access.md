---
type: Gateway Contract
title: Optional Runtime Cloud egress
tags: [gateway, security, access]
lifecycle: contract
reviewed_at: "2026-11-02"
---
# Summary

Cloud is optional Runtime functionality. Route operations retain an operation ID, expected revisions, target fingerprint, confirmation and queryable result. Changing an attachment, certificate, route or Cloud identity invalidates previous consent. An unknown result queries the original operation.

# Contract

## Independent enrollment
Runtime owns one Cloud association, owner-issued setup authorization and its existing Flowersec connection controller. Gateway attachment consent cannot authorize Cloud registration. Attachment lookup uses an explicit Gateway identity, or the sole attachment when unambiguous; a selected Cloud route never supplies a default attachment for general lookup or removal. Runtime may select a Gateway route before initial Cloud enrollment, using route/association revision zero; enrollment verifies the actual Cloud target when it becomes known.

A canceled committed operation remains committed.

## Local egress
New Gateways deny egress with an empty destination list. Host administrators configure exact canonical host:port destinations and per-attachment inherit/allow/deny overrides. Wildcards, URLs, paths, duplicate or malformed authorities are rejected. Executable policy uses attachment.admit, access.open and egress.open; no Cloud approval is consulted.

Admission requires the current Runtime attachment certificate, current local policy and unexpired credentials. The published Flowersec HTTPSProxy carries inner HTTPS without exporting Runtime Cloud keys. Public product policy rejects private resolved destinations; the isolated acceptance harness explicitly opts into its private fixture network. No unrestricted proxy or global proxy environment mutation is introduced.

Disabled egress closes only egress reservations. Independent reverse application streams remain available. Removing an attachment closes all streams depending on that attachment. Credential expiry and stale timers cannot restore withdrawn policy. Policy snapshots copy destination lists so callers cannot widen authority by mutating them.

The catalog's effective_egress_allowed is a policy decision, not a reachability result. It combines the active attachment, inherit/allow/deny and the hook decision for the current policy revision. Egress admission requires an active eligible attachment, its current unexpired client certificate and an allowed destination. The authenticated CONNECT request is independent of the reverse application connection: a disconnected reverse channel does not withdraw egress authority, while attachment removal, certificate replacement and policy revocation do. Only a completed route preflight proves the tested destination was reachable at that time. Empty destinations disable forwarding even when policy permission is true.

Reevaluate egress policy uses manage_network, applies only the selected attachment version and committed policy, and runs no application-health or Cloud-registration test. Unsaved editor changes remain drafts. Access.open hooks continue to evaluate individual sessions; this action does not reevaluate that domain.

## No fallback or cross-path revocation
Runtime registration, recovery, Cloud transport and enabled official-platform traffic use the explicitly chosen route. Route failure reports unavailable; it never silently dials Cloud directly. Cloud logout, user removal or binding revocation cannot alter Gateway device trust, attachments or environment passwords/MFA. Cloud sessions remain subject to their own authorization and Runtime security checks.

# Boundaries
Cloud owns users, roles and resource bindings. Runtime owns Cloud enrollment and sessions. Gateway owns only local device admission and constrained forwarding. There is no Gateway Cloud notification owner, Namespace delegation or publication state.

# Evidence

- redeven:internal/gatewayegress/controller.go

- redeven:internal/gatewayegress/controller_test.go — Egress-only revocation and stale-timer isolation.
- redeven:internal/gatewayegress/isolation_test.go — Isolated Runtime reaches a fixture only through authenticated Gateway proxy.
