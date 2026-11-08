---
type: Desktop Contract
title: Environment settings sessions, connections and presentation
tags: [desktop, environments, settings, interaction]
lifecycle: contract
reviewed_at: "2026-11-04"
---
# Summary

One target-bound settings session owns connection/access drafts and immediate opening. Local opens Access & security without a connection editor. Access management uses existing WSL authority only after exact-distribution discovery confirms it is running; opening/loading never starts stopped distros. Distinguish current password constraints from saved next-start configuration.

# Contract

## Settings session
- Each opening owns committed connection baseline/draft and lazy access baseline/draft. Health refresh preserves running summary, connection nodes, expanded listeners, address filters, selection, scroll and QR panels; never reload access/certificate/security configuration.
- Save invalidates older reads. Late failure from a closed opening becomes a notification, never an error in the next editor. Access opens current-connection/browser/sign-in/HTTPS tasks; recovery-pending protection must be restored before changing it.

## Presentation
- Cap the panel at 50rem by 44.375rem and viewport/titlebar; only viewport resize changes the cap. Tabs/loading/disclosures cannot recenter it or move actions. Use one Current connection card with aligned, selectable, wrapping text/diagnostics/paths/addresses.
- Browser scope, sign-in and certificate tasks share rows, meaningful icons and published outline controls with borders/hover/focus. Preserve specialized QR/recovery-code geometry. Removal drafts cannot look committed; review never shows passwords. Separate footer feedback/actions. Floe owns focus trapping, nested Escape, restoration, variants and forced colors.
- SSH destination fills the adjacent control column in creation/settings. Loading/cached-host failure uses its trailing inset, preserving width/draft/focus; idle indicators take no external column or input clicks.
- Access steps place equal flexible connectors after non-final labels; narrow layouts stack aligned badges without horizontal connectors. Floe owns modal presence and 200ms tab underline; retained exit never blanks the panel.

## Connection facts
Observations preserve host/container namespaces; failures prove no exit. Explicit Stop clears addresses. Presentation never chooses transport.

- Name the selected Environment before addresses. Never substitute SSH aliases for URL hosts or rely on WSL localhost forwarding. Address count cannot resize settings/move the footer.
- Internal browser access aligns label with one expandable scope/count summary, stacking narrowly. Avoid duplicate scope paragraphs/disclosure labels. Preserve expansion on refresh and show total/filtered counts; environment-only addresses have no browser/copy/share actions.
- Gateway cards retain explicit URL/local/SSH/container transport without Runtime lifecycle authority. Display, clipboard and QR exclude tokens/private loopback credentials.
- Public addresses are independent of private management. Saved bind/protocol/port/password/certificate changes apply next start; drafts cannot synthesize current URLs. Failed writes preserve password verifier and report failure.

# Boundaries

[Verified routes](desktop-environment-access.md) owns identity association/saved access defaults; [SSH settings](desktop-ssh-environment-settings.md) fields/secrets; [library](desktop-environment-library.md#library) grouping/grids/search/counts/pins; [interaction continuity](desktop-interaction-continuity.md) open sessions, drafts, invalidation and stale replies. Unsupported legacy links retain recovery facts. Presentation adds no modal, focus, persistence or lifecycle owner.

# Evidence

- `redeven:desktop/scripts/check-settings-hit-targets.mjs` - Tests.

- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.css` - Source.
