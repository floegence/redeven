---
type: Desktop Contract
title: Desktop Environment connections
description: Explain each Environment connection and apply one address namespace policy to Welcome and settings.
tags: [desktop, environment, connection, settings]
timestamp: 2026-09-26T00:00:00Z
---
# Summary

Desktop derives connection presentation from the registered host access, process placement, current Runtime-reported public addresses, and existing Runtime health. Welcome cards and settings share one pure connection model; presentation never chooses or changes a transport. An exactly linked Runtime and Cloud Environment share one visual card while retaining independent action owners. Every address retains its host or container namespace. An absent address does not prove the Runtime stopped, and private bridge authorities never become browser, clipboard, or QR targets. Missing or failed observations remain visibly unconfirmed; explicit Stop clears current addresses even while an old window remains.

# Contract

## Connection information and address actions

Connection details identify the selected Environment before listing access addresses. Native host connections identify this device; SSH connections show the saved authority and explicit port when configured; WSL shows the distribution and Linux user; container placement additionally names its engine and container reference. Desktop never substitutes an SSH alias for a Runtime URL host or relies on WSL localhost forwarding.

Only an HTTP or HTTPS public URL is an address row. Management text, Gateway names or management endpoints, wildcard binds, credential-bearing URLs, and session-only entries cannot become access addresses. Cloud and saved external URL registrations retain their own explicit entry URLs; Gateway cards present Gateway connection information without inventing an Environment URL.

A loopback URL on this device remains copyable and browser-openable but has no cross-device QR action. SSH, WSL, and container loopback addresses appear as an internal-only browser-access explanation naming their namespace and directing users to Open Env App in Desktop. Their literal URL is selectable only after expanding internal listening details, which explain that loopback belongs to that host and separate hosts may reuse a port. These rows have no URL copy, browser, or share controls. This-device and network addresses have explicit browser-access labels. Actual non-loopback addresses remain copyable, browser-openable, and shareable, with a network-availability explanation rather than a claim of tested client reachability. Connection information may be copied separately and never enters the QR component.

An explicitly present public-address list, including an empty list, is authoritative; its singular companion is not a second fallback source. The legacy singular-only report shape is read only when no list exists. Welcome chooses one current managed report rather than merging report, private entry, and generic card text. Pending health probes retain the last complete public-address list and process start identity in the existing observed-health record while withdrawing live control presence. That observation takes precedence over an older open-window startup report; it supplies presentation only, never control authority. A completed stopped or failed observation clears current addresses even with a stale open session. No-address presentation follows health freshness and explicit stopped reasons: not checked, checking, unconfirmed, running without a reported address, or confirmed stopped. These are presentation results, not another lifecycle state machine.

Popover sharing is keyed by Environment and address-row identity. Snapshot refresh preserves the open popover and removes only an absent or no-longer-shareable selection. Settings also clear sharing when their Environment changes. Keyboard dismissal restores trigger focus; explanatory rows retain native text selection.

Refresh continuity includes component and DOM identity. Cards, semantic facts, and connection rows use stable IDs with live snapshot values. Refresh must preserve entry motion, focus, text selection, scroll, copy feedback, expanded listeners, and still-valid QR panels. Changed values appear immediately; invalid addresses disappear, and removing an owner closes its surfaces. Usable addresses precede internal listeners in deterministic numeric order independent of report order and locale. Client and browser regressions publish fresh snapshots during interaction.

The endpoint popover has one compact Environment heading and flat connection facts, with quiet rules and a shared label/value reading edge. Settings use aligned columns without another card. Hostnames and URLs use the product sans-serif face without changing copied content. Opening, closing, and QR disclosure use brief transitions; reduced motion removes movement. QR expansion retains panel width, and motion never alters anchor measurements. Closing content immediately becomes non-interactive; reopening cancels stale dismissal. Opening focuses the panel; Escape and Close restore the trigger. A QR selection must remain public and shareable.

Address presentation groups this-device, network and internal listeners by their existing access scope. Each group keeps its scope label and address count above compact URL rows with their existing actions. This-device and network explanations appear in a question-mark tooltip beside the label, available on hover and keyboard focus in both the connection popover and settings. The help control has a localized scope name and accessible description; explanations never reserve a visible paragraph or resize the surface when shown. Internal listeners retain their namespace and Desktop entry guidance beside the disclosure. Lists have a bounded, keyboard-scrollable viewport, retain every reported address and wrap long URLs without horizontal overflow. More than six addresses exposes a localized filter; once exposed it stays mounted for that group so shrinking inventories cannot remove a focused input. Explicit filtering resets only list scroll; equivalent Runtime refreshes preserve the query, focus, row identity, copy feedback and list scroll. Changing Environment identity resets filter state. A filter changes visibility only and must not revoke a still-valid QR selection; authoritative address removal still invalidates sharing immediately. Settings keep their fixed window and footer geometry regardless of address count.

# Boundaries

## Environment library presentation

[Environment library](desktop-environment-library.md) owns relationship cards, Runtime/Cloud access perspectives, source grids, searching, counts, and owner-scoped pin presentation. A selected perspective supplies the original owner to this connection model. Switching perspectives closes the previous owner's endpoint popover; it does not change address validity, cancel work, or rebind open settings. Standalone Runtime metadata retains startup age and one Cloud affiliation, while Cloud perspectives show only source, ENV ID and remote entry facts. Unsupported legacy links retain their recovery fact.

## Access settings and independent clients

Public Runtime addresses are independent from Desktop's private management connection. Other Desktops and browsers may connect concurrently within their own reachable namespace. Saved bind, protocol, port, password, and certificate changes apply on the next Runtime start; drafts never synthesize or replace the current reported URL. Pending changes remain visible across settings reopenings and belong to one process start identity, including password-only changes.

Settings show connection identity and access actions before configuration. Narrow windows wrap full URLs and retain trailing icon actions. Overflowing address groups scroll internally; when a group has no scroll range or reaches its upper or lower boundary, vertical wheel input continues into the settings body, including over address actions and filtered or empty results. The window and footer stay fixed, and the modal prevents scrolling the Welcome background. Live snapshots preserve expanded sections, scroll, focus, selection, and drafts. Certificate checks and pending operations bind to the real Environment ID; responses from an old target or closed section are ignored. Refreshing a snapshot does not restart a certificate check.

Managed settings use the selected Runtime's private control channel, or its authorized host CLI while stopped. Browser access and listening-port controls configure the Environment, not Desktop's managed connection. Remote loopback is labeled Environment only and cannot open in the client browser. SSH connection details remain available if access settings fail; the failure has an explicit Retry. URL registrations edit connection information only.

[Environment settings](desktop-environment-settings.md) owns section layout, draft/session identity, validation, and committed rebinding. [Local UI certificates](../security/local-ui-certificates.md) owns explicit HTTPS, certificate validity and client trust, maintenance confirmation, and restart blocking. [Local UI network exposure](../security/local-ui-network-exposure.md) owns bind, public-address, and password authority. Missing saved protocols retain HTTP; explicit HTTPS is preserved. Native settings remain readable for older Runtimes, while unsupported management requires an update or stop before saving. Failed writes preserve the prior password verifier and report failure rather than claiming success.

# Evidence

- `redeven:desktop/src/shared/desktopEnvironmentConnection.ts` - One typed connection, address, and status model for Welcome and settings.
- `redeven:desktop/src/welcome/EnvironmentConnectionRows.tsx` - Shared scoped groups, bounded address lists, stable row identity and Environment-owned filtering.
- `redeven:desktop/src/main/desktopWelcomeRefresh.test.ts` - Exercises real pending, failed, stopped and empty-address observations for Local, SSH and WSL, with and without an old open window.
- `redeven:desktop/src/main/desktopWelcomeState.ts` - Selects current public reports and preserves stopped Presence authority over stale sessions.
- `redeven:desktop/src/welcome/environmentEndpoints.test.ts` - Covers host, WSL, container, Cloud, URL and Gateway scopes and no-address states.
- `redeven:desktop/src/welcome/EndpointsPopover.client.test.tsx` - Exercises allowed actions, invalid sharing, refresh and keyboard dismissal.
- `redeven:desktop/src/welcome/EnvironmentSettingsEntry.client.test.tsx` - Verifies the actual card subscription preserves endpoint nodes, focus, selection and QR while applying new snapshots and removing invalid targets.
- `redeven:desktop/src/welcome/EnvironmentAccessSettingsForm.client.test.tsx` - Verifies live snapshot updates preserve expanded sections, scroll, focused input selection, and drafts without restarting certificate checks.
- `redeven:desktop/src/main/desktopPreferences.test.ts` - Loads existing catalogs without a protocol into HTTP startup while preserving the saved port, password, and explicit HTTPS choice.
- `redeven:desktop/scripts/check-environment-endpoints.mjs` - Isolated browser acceptance for the actual product popover and settings components, including narrow and dark surfaces, localized help on hover and keyboard focus, native wheel chaining through short, long and filtered address lists, fixed footer geometry and modal scroll isolation.
