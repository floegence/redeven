---
type: Release Contract
title: Self-contained installer distribution
tags: [release, installer, security, runtime]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Release produces CGO-free macOS/Linux amd64/arm64 self-contained installers, renders bootstrap from exact binary digests and signs SHA256SUMS. Receiver needs shell/HTTPS downloader/SHA256, not Go/Cosign/Python/OpenSSL/package manager.

# Contract

## Trust and acquisition
Initial HTTPS bootstrap's reviewed fixed digest authenticates installer. Upstream Cosign Blob API verifies exact repository/workflow/OIDC/tag using authenticated TUF roots/certificate transparency/Rekor. Only detached.sig and PEM/base64PEM; no format guessing/trust overrides/bypass/fake markers. Failures never execute Runtime.

TUF requests are bounded/cancellable, without user trust cache. Bound log replies before SDK parsing; admit only detached X.509 hashedrekord/0.0.1, rejecting OpenPGP/other types before generic parser. Crypto receives unchanged bytes.

Default resolves GitHub latest, exact version overrides. Explicit managed channel uses public manifest/GitHub-first acquisition; self-upgrade environment semantics remain. Automatic resolution cannot downgrade known version; explicit rollback can.

## Activation transaction
No-follow nonblocking root lock and closed bounded archive reject links/duplicates/traversal/missing-extra members/trailers/changed bytes. Published artifact-cache owns verified acquisition.

Stage complete .redeven-runtime-suites/<archive-sha256>, sync/read back inventory/digests/version, prepare pinned ripgrep before atomic symlink switch. Linux uses musl ripgrep15.2.0 both architectures. New/reused binaries must execute/report exact version; loader/timeout/version/output failures preserve old activation. Detect concurrent change; restore/verify old entry after post-switch failure. Distinguish unchanged from committed-unconfirmed.

Keep published suites/legacy flat resources for live old processes; deletion needs explicit unused/rollback assessment, with disk growth disclosed. Fresh install uses writable user directory, no sudo. Idempotent bash/zsh/fish PATH blocks affect future shells; print current-shell/direct-path guidance. Upgrade edits no profile and starts no service; Runtime owns maintenance/re-exec.

## Publication and promotion
Since0.13.13 signed redeven-installer-contract.json declares minimum installer/closed targets/archive; older installers stop before incompatible acquisition. One template renders GitHub/Portal using four actual pins, signed aggregate checksums. Portal uses official mirror fallback, not another implementation.

Publish --latest=false. Before promotion, check-distribution authenticates inventory/contract and full bootstrap digest/tag/channel/four pins independently of default. After promotion, --check-active-entry requires GitHub byte equality; Portal validates its active bootstrap's own signed release/candidate minimum, allowing older recommended Runtime. Independently read default back. README selects generated GitHub bootstrap; Portal UI/endpoint redirect to generated channel entry, without signature authority. Missing/placeholder assets cannot activate. Deployment is explicit. Rollback uses compatible immutable signed releases, never obsolete external-tool installers/duplicate shell logic. Historical/native/page qualification stays explicit outside push gates.

## Dependency security
Use verified published Cosign/Rekor, go-jose>=4.1.6 and released gRPC1.83.1 fixes; preserve identity/signing time/roots/transparency. Qualify official releases/tamper/cross-tag denial. No imported legacy golang.org/x/crypto/openpgp path; the general SDK's distinct deprecated OpenPGP implementation remains reported as GO-2026-5932. Reject those formats before SDK parsing. Nonzero symbol scans are not clean audits; no blanket suppression or removal of boundary without upstream replacement review/fixtures.

# Boundaries

Online trust/transparency outage fails closed. Bootstrap cannot protect against original HTTPS script compromise. Cross-compilation proves no native execution. Preserve reviewed scanner limitation and exact accepted input format.

# Evidence

internal/installer/signature.go and install_test.go cover authentication/transaction boundaries; Git retains audit and release provenance.
