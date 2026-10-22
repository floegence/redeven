---
type: Desktop Contract
title: Desktop SSH runtime operations
description: Direct SSH and SSH-container Runtime lifecycle execution owned by Desktop.
tags: [desktop, ssh, runtime, process]
timestamp: 2026-10-13T07:10:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop manages an SSH-host or SSH-container Runtime only through the exact saved SSH connection and placement. The same process-local lifecycle coordinator, Launcher Operation, transport lease, platform observation, and temporary helper session serve Start, Stop, Restart, Update, Refresh, Open recovery, and Reinstall. Gateway and Provider credentials are never substituted for SSH authority, and the target stores no Desktop lifecycle lock or supervisor state.

# Contract

## Transport
The SSH transport manager keys a connection by normalized destination, port, authentication mode, SSH binary, and credential scope. A transport failure ends the current command with its original SSH diagnostics; Desktop does not silently select another connection, Gateway, public URL, or Provider route.

A metadata-normalization failure leaves the live slot unchanged, while ReDevPlugin remains the final fail-closed executable-admission authority at startup.

## Host and container behavior
SSH-host actions execute against the confirmed remote user and Runtime root. Start, Restart, Update, or Reinstall may start that saved container when required; Stop never starts a stopped container and succeeds idempotently when the Runtime inventory is already empty.

Desktop owns sequence, timeouts, cancellation, progress, and retry.

## User-facing result
Direct host bootstrap fetches the canonical maintained installer at `https://raw.githubusercontent.com/floegence/redeven/main/scripts/install.sh` and passes the selected release tag explicitly.

A Gateway-only or Provider-only Environment has no SSH authority and therefore cannot borrow this execution path.

# Boundaries

Desktop never scans unrelated processes, selects a similarly named container, deletes a home directory, or performs global container cleanup. Multiple Desktop processes controlling one SSH target are unsupported and do not justify a target-side coordination protocol.

# Evidence

- `redeven:desktop/src/main/sshTransportManager.ts:1` - Credential-scoped SSH transport reuse and cancellation.

- `redeven:desktop/native/windows-ssh/main.go:1` - Native Windows askpass prompt and credential boundary.

- `redeven:desktop/src/main/sshTransportManager.test.ts:1` - Platform execution, failure classification, and owned-child disposal.
