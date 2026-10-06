---
type: Desktop Contract
title: Desktop environment settings
description: Open one target-bound settings session, preserve independent drafts, and save through the registered owner.
tags: [desktop, environments, settings, interaction]
quality_exception: One target-bound settings session joins connection drafts, access prerequisites, and restart recovery; keep their cross-domain authority and focus handoff together.
timestamp: 2026-09-27T17:29:30Z
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
Gateway members expose their member identity and Gateway-authorized membership
settings. Neither entry provides Runtime access management. Cloud shows its
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
inputs. Background health revalidation preserves the observed running summary,
connection nodes, expanded listeners, address filters, selection, scroll and QR
panels; it never reloads access, certificate or security configuration. Completed
observations update actual addresses and status, including failure or Stop.
Only a newly observed Runtime start identity invalidates security state; an old
open window cannot restore its historical start time during a probe. Runtime
management actions still use live capability authority. Address
observation continuity follows [Environment connections](desktop-environment-connections.md).
Access dirty state and save/discard availability use the same comparison;
manually restoring the baseline clears the dirty state.

Switching tabs keeps both forms mounted, preserving drafts, expanded controls and
scroll positions. Ordinary Save submits only the active tab and stays in the
window. Submitted forms reject further edits and duplicate saves; only the chosen
save action shows its pending label. Failure retains the draft. Closing the window, Escape and backdrop dismissal
discard unsaved changes; they do not cancel an already submitted save. Returning
to the access overview keeps the draft for explicit review or discard.

Save and restart persists access settings first. Failure stays in the editor;
success closes that exact opening and reveals the Environment card's existing
Runtime progress after the published Dialog reports that its exit has completed.
The card selects the Runtime owner and scrolls into view, clearing search or
source filters only when they hide the target. Submission feedback has no fake
steps or percentage. The admitted operation's exact key and start time bind the
existing lifecycle disclosure, including an operation that finishes before the
window exits. Completed results remain readable; reopening through the card also
retains the settings navigation until another operation replaces it. Dismissing
progress does not cancel work or let later events reopen it.

A connection draft, including a WSL name change, blocks Save and restart with an
inline explanation and navigation to Connection. Explicitly discarding connection
changes retains the access draft; Save for next restart remains available so
identity edits and access edits cannot deadlock. Saving one section never commits
or silently discards the other section.

A requested restart continues for its original target after manual dismissal,
but a late save cannot close a new opening, reveal old progress over it, or steal
focus. A removed target is not restarted. If restart fails or is canceled, the
progress surface distinguishes saved settings from an incomplete restart and
retains diagnostics and recovery. Retry submits only another restart. A lifecycle
conflict reveals the existing owner when the user is still following the request,
even when its first progress snapshot arrives after admission; dismissing that
request or opening settings cancels the pending focus handoff. The owner's
completion never claims that the rejected restart applied settings. Success
leaves users on the card with Open Env App and Return to settings. Visible results
do not also generate success toasts; background results name their Environment.

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
panel is at most 50rem (800px) wide, respects the Desktop titlebar and viewport, and keeps
title, tabs and actions fixed while each body scrolls. All settings windows use
one stable 44.375rem (710px) height capped by the available viewport, including Local and
other single-section windows. Expanding settings, showing certificates, changing
tabs or resolving an access read must not resize or recenter the window or move
its action baseline. Viewport resizing may change the cap. A stable native
scrollbar gutter prevents horizontal field shifts when content becomes
scrollable; automatic scroll anchoring cannot move the body during expansion.

Access opens a task overview: current connection, browser access, sign-in
protection and HTTPS certificate. Choosing a task presents only its relevant
configuration. Access changes proceed through scope/protocol, required password
or certificate preparation, and one next-start review. Advanced bind and port
controls remain available in that task. The same session owns every draft;
task navigation adds no configuration copy or alternate save path. Connection
forms group identity, transport, and probing into quiet 14px-radius lists.
Labels and guidance align left; desktop controls share a 258px right column,
with 88px port fields. Narrow screens stack labels and controls. Advanced fields
start collapsed. Fields follow the shared [settings control treatment](../ui/runtime-settings.md#settings-controls-and-identity). The access editor uses a compact Back label with the full destination in its accessible name and tooltip, so enlarged localized text stays within narrow windows. Local and network browser addresses use disclosures in the
Access overview; remote internal listeners retain their scope explanation.
Copy, filtering, and opening actions remain available inside each disclosure.
WSL identity uses three labeled rows for distribution, Linux user and Runtime
directory. Container selection shares the right control column with the other
connection fields; its refresh action stays beside the selection and errors span
the row. Both adapters stack their fields at narrow widths without hiding values.

A protected HTTP or password change first explains the dependency, verifies
identity and explicitly commits disabling two-factor, then resumes the original
task. Recovery-pending protection must be restored before that change. Password
removal also selects local-only access and reviews both changes together.
Authenticator enrollment, recovery-code confirmation and management use the same
window body and fixed actions, never a nested dialog. Committed security changes
are immediate and survive canceling later access edits. Their authoritative
refresh retains the mounted task and pending draft. HTTPS preparation for
enrollment preserves the existing restart handoff and requires an explicit
return and setup action after restart; it never enrolls automatically.

Authenticator entry uses a compact six-position numeric field in both owner
verification and enrollment, with nearby guidance naming the authenticator app.
One native text input owns selection, keyboard editing, paste and one-time-code
autofill; the positions are visual separators, not six independent inputs.
Input keeps at most six digits, removes pasted separators, and preserves leading
zeroes. Continue and form submission require all six digits. Recovery-code entry
remains an ordinary text field; switching methods clears the old code and focuses
the new field. Floe owns the composite field's single focus border.

The footer stays visible while the task body scrolls. Validation focuses the
related field; save and security errors appear beside the action. Disabled saves
have keyboard-accessible contextual explanations. Review contains no password
value. Password fields have bounded width and ports stay compact. Narrow panels
stack controls without horizontal scrolling. Theme colors, single-line action labels
and enlarged text preserve the hierarchy and reachable actions.

Connection and access tabs retain the released Floe trigger's 12px horizontal
padding and a 40px target height. Product alignment must not remove that padding
or replace clickable space with margins. Back, SSH help, saved-password removal
and disclosure actions have padded targets at least 32px high; coarse pointers
receive at least 44px targets. Shared buttons retain Floe hover and keyboard focus
behavior, while native disclosures retain keyboard activation with visible focus.
The target includes its surrounding padding, not just the text.

The released Floe slider provides the active tab's 200ms underline transition.
Product styling uses a restrained 160ms opacity entrance for section content and
actions, without translating fields or delaying selection. Retained inactive
panels remain hidden from pointer, keyboard and accessibility navigation. Rapid
switching follows the latest selection immediately; animation has no separate
selection state, timer or request owner. Reduced motion disables the content fade
and Floe's slider transition. Floe owns modal material, focus trapping, nested
Escape, focus restoration and exit motion. Retained exit presentation never
blanks the closing panel.

Advanced settings and certificate disclosures expand and collapse over 180ms,
animating only content height and opacity inside the body. Native details retain
browser disclosure ownership; closed content becomes inert immediately while its
visual exit completes. Conditional SSH and certificate-management sections use
released Floe presence to retain their exiting DOM, with immediate inert and
accessibility-hidden state. Rapid reversal follows the existing open state and
keeps drafts. Reduced motion switches these sections immediately. These visual
transitions add no settings, certificate, request or save lifecycle owner.
SSH validation focuses an invalid field immediately and checks its scroll
position again after expansion, keeping both the field and its error message
visible in the body.

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

[Verified access routes](desktop-environment-access.md) owns identity association and locally saved access defaults.

Address namespace and copy/browser/QR policy are owned by
[Environment connections](desktop-environment-connections.md); certificate
operations are owned by [Local UI certificates](../security/local-ui-certificates.md).
SSH field and secret details are owned by
[SSH environment settings](desktop-ssh-environment-settings.md).

# Evidence

- `redeven:desktop/scripts/check-settings-hit-targets.mjs` - Clicks inside tab and action padding, keyboard switching, multilingual narrow layouts and touch target dimensions.

- `redeven:desktop/scripts/check-settings-restart.mjs` - Full Welcome shell acceptance for Local, SSH, WSL and container restart handoff, focus, dismissal, retry, narrow layouts and reduced motion.

- `redeven:desktop/scripts/check-settings-expansion.mjs` - Per-frame window, footer and disclosure measurements, rapid reversals, immediate focus exclusion and reduced motion.
- `redeven:desktop/scripts/check-access-settings.mjs` - Browser evidence for control proportions, all shipped themes and locales, narrow panels, enlarged text, real scrolling, certificate presentation and save recovery.
- `redeven:desktop/src/welcome/EnvironmentAccessWorkflow.tsx` - Task navigation, prerequisite continuation and contextual review/save feedback.
- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.css` - Product geometry, responsive fields and fixed action baseline.
- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.tsx` - Published modal and tabs with retained, independently scrolling panels.
- `redeven:desktop/src/welcome/environmentSettingsSession.ts` - Opening identity, independent drafts and asynchronous result isolation.
- `redeven:desktop/src/welcome/EnvironmentSettingsEntry.client.test.tsx` - Actual card entry, real health-store refresh continuity, read failures, reopening, deletion and late save behavior.
- `redeven:desktop/src/welcome/environmentSettingsSession.test.ts` - Read/write ordering, manual revert, tab drafts and target rebinding.
- `redeven:desktop/src/main/environmentAccessSettings.ts` - Explicit owner, WSL guard, compatibility and Runtime configuration projection.
- `redeven:desktop/src/main/environmentAccessSettings.test.ts` - Cloud write rejection, no implicit WSL start and process-bound pending state.
- `redeven:desktop/scripts/check-environment-settings.mjs` - Actual card openings, per-frame tab geometry and motion, successful/failed/delayed reads, rapid keyboard switching, reduced motion, repeated health probes, and retained nodes, drafts, QR panels, selection and scroll positions.
- `redeven:scripts/check_desktop.sh` - Full Desktop validation includes settings and endpoint browser acceptance; ordinary source checks do not launch browsers.
