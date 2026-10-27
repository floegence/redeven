---
type: AI Operation Contract
title: Redeven environment operations
description: redeven env and redeven targets exec are the product boundaries for Flower and automation environment lifecycle and target diagnostic requests.
tags: [ai, flower, cli, desktop, runtime]
timestamp: 2026-07-10T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Redeven environment lifecycle requests must go through the Redeven product surface, not through inferred container, SSH, systemd, launchctl, or process-manager commands. Flower learns this boundary through the standard `redeven-environment` system skill, not through a bespoke environment workflow embedded in the global prompt.

# Contract

## Mechanism
The `redeven env` CLI surface exposes machine-readable environment status, diagnostics, and lifecycle operation plans through the shared agent protocol envelope. A missing or version-mismatched bundle is a structured CLI failure and never falls back to an unrelated system `redeven` binary.

Password SSH targets, container placements, provider environments, Gateway environments, and external Local UI targets return structured unsupported or unavailable results instead of falling back to ad hoc low-level commands.

# Boundaries

`redeven env` and `redeven targets exec` output is sanitized for Flower and automation. Target execution JSON must include `target_id` and `execution_location` when execution occurs.

It can be used to invoke Redeven product commands, but it must not be described as remote execution unless the product command result itself contains target execution provenance such as `execution_location=ssh_target`.

# Evidence

- `redeven:cmd/redeven/env.go:13` - The `env` command dispatches lifecycle subcommands.

- `redeven:internal/agentprotocol/targets.go:37` - Target discovery projects the default local target and saved catalog connections into target descriptors.
