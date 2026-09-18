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

A loopback URL on this device remains copyable and browser-openable but has no cross-device QR action. SSH, WSL, and container loopback addresses appear as an internal-only browser-access explanation naming their namespace and directing users to Open Env App in Desktop. Their literal URL is selectable only after expanding internal listening details, which explain that loopback belongs to that host and separate hosts may reuse a port. These rows have no URL copy, browser, or share controls. This-device and network addresses have explicit browser-access labels. Actual non-loopback addresses remain copyable, browser-openable, and shareable, with a network-availability explanation rather than a claim of tested client reachability. Connection information may be copied separately and never enters the QR component.

An explicitly present public-address list, including an empty list, is authoritative; its singular companion is not a second fallback source. The legacy singular-only report shape is read only when no list exists. Welcome chooses one current managed report rather than merging report, private entry, and generic card text. A stopped Runtime's report overrides a stale open session. No-address presentation follows health freshness and explicit stopped reasons: not checked, checking, unconfirmed, running without a reported address, or confirmed stopped. These are presentation results, not another lifecycle state machine.

Popover sharing is keyed by Environment and address-row identity. Snapshot refresh preserves the open popover and removes only an absent or no-longer-shareable selection. Settings also clear sharing when their Environment changes. Keyboard dismissal restores trigger focus; explanatory rows retain native text selection.

Refresh continuity includes component and DOM identity, not just the open flag. Cards, semantic facts (independent of translated labels), and connection rows render by stable IDs with reactive access to the latest data. A fresh snapshot must not reconstruct their interactive subtree, replay entry motion, reclaim focus, reset native text selection or scrolling, discard copy feedback, or recreate a still-valid QR panel. Usable browser addresses precede internal listeners; each group has a deterministic order independent of Runtime enumeration. An expanded listener disclosure keeps its native DOM, open state and focus across equivalent snapshots. Refresh is never suspended while a panel is open: changed values appear in place, invalid addresses disappear immediately, and removing the owning Environment closes its surface. Client and real-card browser regressions exercise repeated snapshot publication during interaction.

The endpoint popover presents a compact Environment heading, inline management connection rows and distinct scoped address surfaces in one bounded panel. Hostnames and URLs use the product sans-serif text face without changing their literal display or copied content. Opening, closing and QR disclosure use brief transitions; reduced-motion preferences remove movement. The panel retains one width when sharing expands, and motion never changes the dimensions used to anchor it. Closing content is immediately non-interactive, remains visible only for its exit transition, and can be reopened without a stale dismissal removing it. Opening moves focus into the panel; Escape and its Close control restore the trigger. Retained QR presentation may reference only an address that is still public and shareable in the current model.

# Boundaries

Environment cards place runtime age and Cloud affiliation on one full-width metadata row below the title and header actions. Affiliation describes the control-plane relationship, not remote availability; it never borrows an online status dot. Cloud identity appears once in metadata instead of repeating as a label/value fact. Long localized ages and names truncate within that row without pushing adjacent cards' runtime facts out of alignment; their full text remains available on hover. Unsupported legacy control-plane links retain their explicit recovery fact.

## Access settings and independent clients

Public Runtime addressing is independent from Desktop bridge use: other Desktops and browsers may connect concurrently through an address usable from their own network namespace. Saved bind and protocol are next-start settings and never synthesize an online URL. Settings put the current connection and Desktop/browser actions above scope, password, protocol, port, and advanced listening controls. Editing a draft leaves the current address intact until a new Runtime report arrives. Private bridge URLs and tokens are excluded from every displayed endpoint, clipboard value, QR payload, and system-browser target.

Narrow settings windows keep the current URL on its own full-width row, with copy and share actions below it. Translated action labels must not compress the address into a narrow column; the footer remains visible while configuration content scrolls.

Background snapshots refresh connection details while preserving expanded settings sections, scroll position, input focus, selection and unsaved edits. Certificate state and pending operations belong to the actual Environment ID, not the snapshot object. Only a target change or reopening the certificate section initializes a new check; explicit refresh remains available. Responses from a previous target or closed section are ignored.

Missing saved protocol settings use HTTP on load and startup, including existing Environment catalogs. The connection security control selects HTTP without a confirmation or certificate prompt. Explicit HTTPS remains unchanged. When saving a stopped Environment, Desktop supplies any retained password with `keep` to the Runtime authority. Runtime may establish a missing verifier, but never replaces an existing server password unless the user explicitly chooses replacement.

HTTPS settings follow [Local UI certificates](../security/local-ui-certificates.md): validity, client trust, and operation outcomes stay separate. The certificate row exposes explicit management with inline replacement/removal confirmation and privileged file selection. Checks and mutations block HTTPS restart until they finish; main revalidates the saved identity and bind coverage before stopping Runtime. Certificate changes survive canceling settings and become active only on restart. The Runtime reports pending certificate changes across settings reopen. Older runtimes without management capability show an update hint instead of unsupported actions.

Managed server settings read and save the selected Runtime's access configuration through its private control channel, or the authorized host CLI while stopped. The same single-column settings surface labels the exposure control as browser access and uses "Environment only" for remote loopback and never opens that address in the client browser. This control does not change Desktop’s managed connection; the port field explicitly configures a listening port on the environment. Public network addresses remain copyable and shareable, and SSH connection details remain available in the same window’s Connection tab. URL registrations edit connection information only. Remote certificate maintenance runs on the selected server; each client verifies trust in its issuing CA. Runtime retains the password verifier for independent restarts as specified by [Local UI network exposure](../security/local-ui-network-exposure.md).

When the server cannot return its settings, Desktop shows the failure and Retry in Access & security; Connection remains available in the same window. Password inputs validate the 72-byte UTF-8 limit before saving. A failed server settings write restores the prior password verifier and reports the failure; it must not claim that an incomplete save succeeded.

Saved access changes remain visibly pending across dialog reopenings until a new Runtime applies them. The pending report belongs to one process start identity, including password-only changes; it does not replace the current URL. Native saved settings remain readable through the bundled authority for older Runtimes; saving requires stopping or updating that Runtime first. The session and section contract is owned by [Environment settings](desktop-environment-settings.md).

# Evidence

- `redeven:desktop/src/shared/desktopEnvironmentConnection.ts` - One typed connection, address, and status model for Welcome and settings.
- `redeven:desktop/src/main/desktopWelcomeState.ts` - Selects current public reports and preserves stopped Presence authority over stale sessions.
- `redeven:desktop/src/welcome/environmentEndpoints.test.ts` - Covers host, WSL, container, Cloud, URL and Gateway scopes and no-address states.
- `redeven:desktop/src/welcome/EndpointsPopover.client.test.tsx` - Exercises allowed actions, invalid sharing, refresh and keyboard dismissal.
- `redeven:desktop/src/welcome/EnvironmentSettingsEntry.client.test.tsx` - Verifies the actual card subscription preserves endpoint nodes, focus, selection and QR while applying new snapshots and removing invalid targets.
- `redeven:desktop/src/welcome/EnvironmentAccessSettingsForm.client.test.tsx` - Verifies live snapshot updates preserve expanded sections, scroll, focused input selection, and drafts without restarting certificate checks.
- `redeven:desktop/src/main/desktopPreferences.test.ts` - Loads existing catalogs without a protocol into HTTP startup while preserving the saved port, password, and explicit HTTPS choice.
- `redeven:desktop/scripts/check-environment-endpoints.mjs` - Isolated browser acceptance for the actual product popover and settings components, including narrow and dark surfaces.
