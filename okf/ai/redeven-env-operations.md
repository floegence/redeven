---
type: AI Operation Contract
title: Redeven environment operations
tags: [ai, flower, cli, desktop, runtime]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Environment lifecycle goes through Redeven product operations, never guessed container/SSH/systemd/launchctl/process commands. Flower receives this rule from the standard redeven-environment skill; do not embed a second environment workflow into the global prompt.

# Contract

## Mechanism
The `redeven env` CLI surface exposes machine-readable environment status, diagnostics, and lifecycle operation plans through the shared agent protocol envelope. A missing or version-mismatched bundle is a structured CLI failure and never falls back to an unrelated system `redeven` binary.

Password SSH targets, container placements, provider environments, Gateway environments, and external Local UI targets return structured unsupported or unavailable results instead of falling back to ad hoc low-level commands.

# Boundaries

`redeven env` and `redeven targets exec` output is sanitized for Flower and automation. Target execution JSON must include `target_id` and `execution_location` when execution occurs.

It can be used to invoke Redeven product commands, but it must not be described as remote execution unless the product command result itself contains target execution provenance such as `execution_location=ssh_target`.

# Evidence

- `redeven:cmd/redeven/env.go:13` - Source.
- `redeven:internal/agentprotocol/targets.go:37` - Source.
