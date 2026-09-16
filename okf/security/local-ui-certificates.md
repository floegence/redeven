---
type: Security Contract
title: Local UI certificates
description: Manage saved HTTPS identities, explicit file imports and replacements, and independent client trust without interrupting a running Runtime.
tags: [security, local-ui, desktop, certificates]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

Runtime owns the saved HTTPS identity and validates it before serving. Desktop exposes explicit certificate creation, import, regeneration, and removal only through the registered management channel. Certificate validity, client trust, and the latest operation result are independent. No operation silently replaces an identity or installs trust. Invalid imports preserve the saved pair; changes affect the next HTTPS start while the running identity and sessions remain intact. HTTP remains the default and requires no certificate.

# Contract

## Identity and trust

The user explicitly creates a device CA with `local-authority device-ca generate` and inspects it with `status`. Generation refuses an existing identity, including an invalid one. Runtime startup never generates, replaces, or repairs certificate material. The device CA is a self-signed P-256 certificate with a matching PKCS#8 key. Each HTTPS start creates an in-memory leaf for the exact configured DNS and IP SANs; that leaf is not persisted.

A valid untrusted identity is a successful status query with `identity: ready`, not a damaged certificate. Expired, not-yet-valid, incomplete, and malformed identities remain separate from permission, timeout, and inspection failures. Reports carry only public metadata, certificate kind, SHA-256 fingerprint, and operation capabilities. The maintenance report schema remains `redeven.local_authority_maintenance.v1`; older runtimes without lifecycle capabilities require an update before new management actions are offered.

For a device CA, macOS and Windows support explicit current-user `install --scope user`. Linux requires manual trust configuration after public export. Redeven never modifies system-wide trust, invokes sudo, or silently elevates privileges. Installation success requires a fresh trust check. Cancellation and failure retain the certificate and allow retry without regeneration. macOS authorization-sheet cancellation is recognized even when its diagnostic omits the numeric OSStatus. Trust on one OS user does not establish trust on other devices or in browsers with separate stores.

Imported server certificates use their issuing CA for trust. They are never installed as trusted roots by Redeven. Remote maintenance inspects the server's identity; its trust report is never presented as trust on the current Desktop client. Public export contains certificate material only, never the key.

## Explicit certificate changes

`import`, `regenerate`, and `remove` require `--confirm`. Import reads one closed JSON object on stdin with `certificate_pem` and `private_key_pem`. Accept a PEM leaf-first certificate chain and one matching unencrypted private key, at most 1 MiB each; an existing Redeven device CA and key can also be restored. Reject malformed or extraneous PEM blocks, trailing text, encrypted/mismatched keys, invalid dates, invalid chains, missing SANs, and certificates unsuitable for server authentication. A public certificate file must never contain private material that could later be exported.

Imported server certificates are served directly. HTTPS startup validates their coverage for every actual listener authority; Desktop preflight also checks the configured bind before stopping a running Runtime. Trust remains the connecting client's responsibility. A failed preflight keeps the existing Runtime running, and a certificate failure never selects HTTP automatically.

Regeneration creates a new device CA and fingerprint; clients must explicitly configure its trust. Removal deletes the saved certificate and private key, preventing the next HTTPS start until a usable identity exists. Existing OS trust entries are not removed. The in-memory serving certificate and active connections remain unchanged until an explicit restart. Private runtime-control access reports compare the complete saved certificate-chain digest with the running HTTPS identity so pending state survives settings close/reopen without a second client-owned flag.

Readers and writers share the state-scoped certificate maintenance lock. A replacement is validated in a private staging directory before publishing the complete pair. During publication, the previous directory is retained until commit succeeds; a failed rename restores it. On the next locked operation, an interrupted pre-commit replacement restores the previous directory, while a committed target wins and its previous directory is removed. Removal commits an explicit tombstone so recovery cannot resurrect a deliberately removed identity. Unsafe directories and symlinks fail closed. This supports process-interruption recovery; it does not promise an OS trust rollback or filesystem power-loss durability.

## Desktop interaction and private input

The compact HTTPS panel presents certificate validity, expiry, and system trust separately. The certificate row offers “Manage certificate”; import, regeneration, and removal each have an inline explanation and explicit confirmation. Cancellation has neutral feedback. Pending operations disable duplicate actions and HTTPS restart. Completed changes update the panel in place and return keyboard focus to management. Public path, fingerprint, and bounded selectable diagnostics live in the expandable details section.

“Create and trust on this device” checks, creates only when missing, requests current-user trust, and verifies. Retrying reuses a valid certificate. The epoch 18 legacy `failed + ready + untrusted` report still means an intact identity awaiting trust.

Every certificate IPC request names the registered Environment management target. Main validates its authority before opening native certificate and key file pickers, reads bounded files privately, and sends PEM only over maintenance stdin or the existing authorized remote execution channel. Renderer requests cannot supply filesystem paths or PEM; renderer reports, clipboard, and diagnostics contain no private key. Canceling either picker does not mutate the store. Imported input is never placed in process arguments.

Changing the selected Environment or closing the section invalidates outstanding UI results. Background snapshots preserve management confirmation, expanded details, scroll, and drafts. Certificate changes are saved immediately and survive canceling the settings dialog; restart is the separate step that applies them to Runtime. Saving next-start HTTPS settings remains possible with an unusable certificate, with an explicit startup warning.

# Evidence

- `redeven:internal/localui/device_identity.go` - Validated imports, locked replacement, interruption recovery, explicit removal, and bind preflight.
- `redeven:internal/localui/device_identity_test.go` - Invalid input preservation, real TLS serving, restart boundaries, CA restore, and transaction recovery.
- `redeven:internal/localui/device_ca.go` - Device identity validation, ephemeral exact-SAN leaves, public status/export, and client trust inspection.
- `redeven:internal/localui/device_ca_install.go` - Explicit current-user trust installation and cancellation classification.
- `redeven:internal/localui/runtime_access_test.go` - Saved-versus-serving certificate fingerprint comparison.
- `redeven:cmd/redeven/local_authority_test.go` - Confirmation, secret-free reports, and intact identity after rejected import.
- `redeven:desktop/src/main/desktopCertificate.test.ts` - Private picker input, capability checks, explicit operations, trust separation, and preflight.
- `redeven:desktop/src/welcome/LocalCertificateSettings.client.test.tsx` - Inline confirmation, cancellation, failure recovery, keyboard state, and target changes.
