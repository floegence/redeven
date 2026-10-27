---
type: Validation Guide
title: Gateway deployment qualification
description: Qualify outbound membership, isolated TLS applications and Cloud access under real network restrictions.
tags: [gateway, desktop, validation, networking, security]
timestamp: 2026-10-07T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Qualification must prove Runtime-to-Gateway connection direction and real application behavior. Unit tests alone do not establish Electron certificate handling, browser MFA, MySQL migration or an isolated network path. Record each command's actual result; source changes or installer builds are not proof that an application flow passed. These affected-feature checks are separate from release packaging and the aggregate push gate.

# Contract

## LAN application acceptance
`scripts/check_gateway_access_browser.sh` starts production Gateway handlers and Runtime application handlers without Runtime TCP listeners or Cloud.

No global TLS exception, dependency overlay or system trust installation is permitted.

## Network and Cloud acceptance
`scripts/check_gateway_cloud_isolation.sh` provides a Docker network in which Runtime cannot reach Cloud IPs, public IPs or public DNS.

Automatic publication and manual unpublication must preserve their different approval semantics.

## Product and release boundaries
Desktop renderer qualification checks all ten locales, narrow viewports, large text, keyboard activation, cancel focus, failed refresh and partial batches.

A local source fixture cannot certify those results. Do not delete another task's processes, volumes, branches or worktrees while preparing or cleaning acceptance resources.

# Boundaries

These checks qualify Gateway membership, access, and isolation behavior on task-owned resources. They do not replace unit contracts, release packaging evidence, or the aggregate push gate, and a passing local fixture cannot certify an installer or an unrelated deployment target.

# Evidence

- `redeven:internal/localui/gateway_member_browser_test.go` — No-inbound-TCP production application fixture.

- `redeven:desktop/scripts/fixtures/gateway-access-electron.ts` — Real Electron member access assertions.
