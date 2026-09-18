---
type: Desktop Contract
title: Desktop Environment connections
description: Explain each Environment connection and apply one address namespace policy to Welcome and settings.
tags: [desktop, environment, connection, settings]
timestamp: 2026-09-18T00:00:00Z
---
# Summary

Desktop derives connection presentation from the registered host access, process placement, current Runtime-reported public addresses, and existing Runtime health. Welcome cards and settings share one pure model; presentation never chooses or changes a transport. Every address retains its host or container namespace. An absent address does not prove the Runtime stopped, and private bridge authorities never become browser, clipboard, or QR targets. Missing or failed observations remain visibly unconfirmed; explicit Stop clears current addresses even while an old window remains.

# Contract

## Connection information and address actions

Connection details identify the selected Environment before listing access addresses. Native host connections identify this device; SSH connections show the saved authority and explicit port when configured; WSL shows the distribution and Linux user; container placement additionally names its engine and container reference. Desktop never substitutes an SSH alias for a Runtime URL host or relies on WSL localhost forwarding.

Only an HTTP or HTTPS public URL is an address row. Management text, Gateway names or management endpoints, wildcard binds, credential-bearing URLs, and session-only entries cannot become access addresses. Cloud and saved external URL registrations retain their own explicit entry URLs; Gateway cards present Gateway connection information without inventing an Environment URL.

A loopback URL on this device remains copyable and browser-openable but has no cross-device QR action. SSH, WSL, and container loopback addresses are selectable explanatory text naming their namespace, without URL copy, browser, or share controls. Actual non-loopback addresses remain copyable, browser-openable, and shareable, with a network-availability explanation rather than a claim of tested client reachability. Connection information may be copied separately and never enters the QR component.

An explicitly present public-address list, including an empty list, is authoritative; its singular companion is not a second fallback source. The legacy singular-only report shape is read only when no list exists. Welcome chooses one current managed report rather than merging report, private entry, and generic card text. A stopped Runtime's report overrides a stale open session. No-address presentation follows health freshness and explicit stopped reasons: not checked, checking, unconfirmed, running without a reported address, or confirmed stopped. These are presentation results, not another lifecycle state machine.

Popover sharing is keyed by Environment and address-row identity. Snapshot refresh preserves the open popover and removes only an absent or no-longer-shareable selection. Settings also clear sharing when their Environment changes. Keyboard dismissal restores trigger focus; explanatory rows retain native text selection.

# Boundaries

## Access settings and independent clients

Public Runtime addressing is independent from Desktop bridge use: other Desktops and browsers may connect concurrently through an address usable from their own network namespace. Saved bind and protocol are next-start settings and never synthesize an online URL. Settings put the current connection and Desktop/browser actions above scope, password, protocol, port, and advanced listening controls. Editing a draft leaves the current address intact until a new Runtime report arrives. Private bridge URLs and tokens are excluded from every displayed endpoint, clipboard value, QR payload, and system-browser target.

Narrow settings windows keep the current URL on its own full-width row, with copy and share actions below it. Translated action labels must not compress the address into a narrow column; the footer remains visible while configuration content scrolls.

Background snapshots refresh connection details while preserving expanded settings sections, scroll position, input focus, selection and unsaved edits. Certificate state and pending operations belong to the actual Environment ID, not the snapshot object. Only a target change or reopening the certificate section initializes a new check; explicit refresh remains available. Responses from a previous target or closed section are ignored.

Missing saved protocol settings use HTTP on load and startup, including existing Environment catalogs. The connection security control selects HTTP without a confirmation or certificate prompt. Explicit HTTPS remains unchanged. When saving a stopped Environment, Desktop supplies any retained password with `keep` to the Runtime authority. Runtime may establish a missing verifier, but never replaces an existing server password unless the user explicitly chooses replacement.

HTTPS settings follow [Local UI certificates](../security/local-ui-certificates.md): validity, client trust, and operation outcomes stay separate. The certificate row exposes explicit management with inline replacement/removal confirmation and privileged file selection. Checks and mutations block HTTPS restart until they finish; main revalidates the saved identity and bind coverage before stopping Runtime. Certificate changes survive canceling settings and become active only on restart. The Runtime reports pending certificate changes across settings reopen. Older runtimes without management capability show an update hint instead of unsupported actions.

Managed server settings read and save the selected Runtime's access configuration through its private control channel, or the authorized host CLI while stopped. The same single-column settings surface uses "Only this server" for remote loopback and never opens that address in the client browser. Public network addresses remain copyable and shareable, and SSH connection details remain available in the same window’s Connection tab. URL registrations edit connection information only. Remote certificate maintenance runs on the selected server; each client verifies trust in its issuing CA. Runtime retains the password verifier for independent restarts as specified by [Local UI network exposure](../security/local-ui-network-exposure.md).

When the server cannot return its settings, Desktop shows the failure and Retry in Access & security; Connection remains available in the same window. Password inputs validate the 72-byte UTF-8 limit before saving. A failed server settings write restores the prior password verifier and reports the failure; it must not claim that an incomplete save succeeded.

Saved access changes remain visibly pending across dialog reopenings until a new Runtime applies them. The pending report belongs to one process start identity, including password-only changes; it does not replace the current URL. Native saved settings remain readable through the bundled authority for older Runtimes; saving requires stopping or updating that Runtime first. The session and section contract is owned by [Environment settings](desktop-environment-settings.md).

# Evidence

- `redeven:desktop/src/shared/desktopEnvironmentConnection.ts` - One typed connection, address, and status model for Welcome and settings.
- `redeven:desktop/src/main/desktopWelcomeState.ts` - Selects current public reports and preserves stopped Presence authority over stale sessions.
- `redeven:desktop/src/welcome/environmentEndpoints.test.ts` - Covers host, WSL, container, Cloud, URL and Gateway scopes and no-address states.
- `redeven:desktop/src/welcome/EndpointsPopover.client.test.tsx` - Exercises allowed actions, invalid sharing, refresh and keyboard dismissal.
- `redeven:desktop/src/welcome/EnvironmentAccessSettingsForm.client.test.tsx` - Verifies live snapshot updates preserve expanded sections, scroll, focused input selection, and drafts without restarting certificate checks.
- `redeven:desktop/src/main/desktopPreferences.test.ts` - Loads existing catalogs without a protocol into HTTP startup while preserving the saved port, password, and explicit HTTPS choice.
- `redeven:desktop/scripts/check-environment-endpoints.mjs` - Isolated browser acceptance for the actual product popover and settings components, including narrow and dark surfaces.
