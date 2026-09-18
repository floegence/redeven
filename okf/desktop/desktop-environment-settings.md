---
type: Desktop Contract
title: Desktop environment settings
description: Open one target-bound settings session, preserve independent drafts, and save through the registered owner.
tags: [desktop, environments, settings, interaction]
timestamp: 2026-09-18T00:00:00Z
---
# Summary

Desktop owns one settings window and one opening session per Environment. Opening
never waits for a Runtime access read and a failed read never selects another
editor. Registration ownership determines available sections; every access read
and write carries an explicit Environment ID and resolves its registered
management authority. Runtime owns access configuration. A failed operation
preserves input and reports its real diagnostic; an obsolete response cannot
change a newer opening. Cloud, URL and Gateway registrations cannot read or save
Local access settings.

# Contract

## Sections and authority

Local opens Access & security and has no connection editor. SSH and container
registrations open Connection and load Access & security on its first visit.
WSL opens Connection with an editable name and its registered distribution,
Linux user and Runtime directory as identity information. Access management uses
existing WSL authority only after discovery confirms that exact distribution is
running; opening settings or automatic loading never starts a stopped distro.
The error surface offers the existing explicit Start action.

URL registrations edit their name, address and automatic status detection.
Gateway Environment profiles retain their existing Gateway write permissions and
connection fields. Neither provides Runtime access management. Cloud shows its
connection information and the existing Redeven Cloud management entry. None of
these sections grants additional lifecycle or access authority.

The main-frame Desktop settings bridge resolves each requested ID against the
registration catalog before invoking any management operation. There is no
selected-Environment or Local fallback and no legacy launcher save action.
Running compatible Runtimes use private control; stopped Runtimes use the same
registered host's authorized CLI. An older native Runtime's saved configuration
can be read through the bundled authority, while saving requires stopping or
updating that Runtime. Current process password constraints remain distinct from
saved next-start configuration.

## Opening, drafts and saves

One opening owns the committed connection baseline, connection draft and lazily
loaded access baseline and draft. There is no access-settings cache in Welcome
snapshots. Live snapshots update health and actual addresses without replacing
inputs. Access dirty state and save/discard availability use the same comparison;
manually restoring the baseline clears the dirty state.

Switching tabs keeps both forms mounted, preserving drafts, expanded controls and
scroll positions. Save submits only the active tab and stays in the window.
Submitted forms reject further edits and duplicate saves until completion.
Failure retains the draft. Close, Cancel, Escape and backdrop dismissal discard
unsaved changes directly; they do not cancel an already submitted save. A
requested save-and-restart continues for its original target after dismissal.
If persistence succeeds but restart fails, the result is explicitly saved but
not applied, recoverable through the existing Restart action.

Connection saves return the committed canonical target ID. A change of host,
port, container or Runtime directory cannot submit while access edits remain;
the user first saves or discards them. Successful identity changes invalidate old
access data and the next Access visit reads the new registered target. A rename
retains the access draft. Removed registrations close their session. Reads,
saves, certificate refreshes and connection failures are scoped to opening and
target identity. Starting a save invalidates older reads; late failure from a
closed opening is a notification, never an error in the next editor.

## Presentation and recovery

The window uses released Floe Dialog, Tabs and retained TabPanel components.
Multiple sections expose tabs; a single section omits the tab bar. The responsive
panel is at most 48rem wide, respects the Desktop titlebar and viewport, and keeps
title, tabs and actions fixed while each body scrolls. Multi-section windows use
a stable 42rem height capped by the available viewport; changing tabs or resolving
an access read must not move the window or its action baseline. Single-section
windows retain content-driven height. A stable native scrollbar gutter prevents
horizontal field shifts when a section becomes scrollable.

The released Floe slider provides the active tab's 200ms underline transition.
Product styling uses a restrained 160ms opacity entrance for section content and
actions, without translating fields or delaying selection. Retained inactive
panels remain hidden from pointer, keyboard and accessibility navigation. Rapid
switching follows the latest selection immediately; animation has no separate
selection state, timer or request owner. Reduced motion disables the content fade
and Floe's slider transition. Floe owns modal material, focus trapping, nested
Escape, focus restoration and exit motion. Retained exit presentation never
blanks the closing panel.

Access loading and failures remain inside the access section. Failures show their
structured summary or original diagnostic with Copy and Retry. Control HTTP 401
and 403 retain their status, code and original diagnostic across settings IPC;
the visible message explains in the selected language that this Environment
rejected Desktop's settings authority. Copy retains the original diagnostic.
The same message projection applies to a save failure delivered after dismissal.
Retry keeps the current window and connection draft. Missing or invalid
responses never become fabricated defaults or a generic claim that Runtime is
preparing.

# Boundaries

Address namespace and copy/browser/QR policy are owned by
[Environment connections](desktop-environment-connections.md); certificate
operations are owned by [Local UI certificates](../security/local-ui-certificates.md).
SSH field and secret details are owned by
[SSH environment settings](desktop-ssh-environment-settings.md).

# Evidence

- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.tsx` - Published modal and tabs with retained, independently scrolling panels.
- `redeven:desktop/src/welcome/environmentSettingsSession.ts` - Opening identity, independent drafts and asynchronous result isolation.
- `redeven:desktop/src/welcome/EnvironmentSettingsEntry.client.test.tsx` - Actual card entry, read failures, reopening, deletion and late save behavior.
- `redeven:desktop/src/welcome/environmentSettingsSession.test.ts` - Read/write ordering, manual revert, tab drafts and target rebinding.
- `redeven:desktop/src/main/environmentAccessSettings.ts` - Explicit owner, WSL guard, compatibility and Runtime configuration projection.
- `redeven:desktop/src/main/environmentAccessSettings.test.ts` - Cloud write rejection, no implicit WSL start and process-bound pending state.
- `redeven:desktop/scripts/check-environment-settings.mjs` - Actual card openings, per-frame tab geometry and motion, successful/failed/delayed reads, rapid keyboard switching, reduced motion and retained drafts/scroll positions.
- `redeven:scripts/check_desktop.sh` - Full Desktop validation includes settings and endpoint browser acceptance; ordinary source checks do not launch browsers.
