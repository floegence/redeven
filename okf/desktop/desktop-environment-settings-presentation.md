---
type: Desktop Contract
title: Desktop environment settings presentation
description: Apply one theme-aware visual hierarchy, fixed window geometry and responsive controls across settings tasks.
tags: [desktop, settings, interaction, themes]
timestamp: 2026-10-12T06:30:00Z
---
# Summary

Desktop composes released Floe Dialog, Tabs, controls and floating presence into
one consistent Environment settings surface. Theme tokens own material and
contrast; product styles own grouping, spacing and responsive geometry. Every
settings page retains readable labels, reachable actions and a fixed window
viewport. Loading, failed operations and expanded disclosures cannot replace
the draft owner or resize the window. The
[settings session contract](desktop-environment-settings.md) owns authority,
persistence, prerequisites and recovery; presentation adds no operation state.

Interaction sessions follow [Desktop interaction continuity](desktop-interaction-continuity.md), including authority invalidation, retained drafts, explicit visibility and stale-completion fencing.

# Contract

## Window and section hierarchy

The panel is at most 50rem (800px) wide and has a stable 44.375rem (710px) height
capped by the available viewport and Desktop titlebar. Title, optional tabs and
actions stay fixed while the active body scrolls. Local and other single-section
windows use the same height and omit tabs. Retained inactive panels remain hidden
from pointers, keyboard and accessibility navigation. Viewport resizing may
change the cap; expanding fields, loading settings, showing certificates or
switching tabs must not resize or recenter the window or move its action baseline.
A stable scrollbar gutter prevents field shifts. Automatic scroll anchoring must
not move the body during expansion.

The dialog uses the theme's `popover` background and `card` settings surfaces.
Do not darken neutral surfaces by mixing foreground into their backgrounds:
light themes must retain their intended warm or cool palette and must not
look disabled. Ordinary surfaces share the theme border, 14px radius and 18px
inset. Related security cards use a 16px gap; independent body sections use a
24px rhythm. Selected choices, warnings and errors retain semantic colors.
Descriptions remain secondary; section titles and actionable values stay readable.

Settings section titles use 13px/550, field labels 13px/400 and descriptions
12px with 1.6-1.7 line height. Workflow headings use 20px/600 with the same
left reading edge and nearby guidance. Semantic section icons use a 36px tile
and an 18-19px glyph; ordinary fact rows need no decorative icon. Product styles
must not erase a published outline button's boundary or disable its hover/focus
affordances merely to make an action resemble text.

## Connection facts and forms

Current connection is one settings card. Its header joins identity, a compact
status indicator and the existing Open Env App action. Runtime placement facts
and address disclosures share that card's inset and separators. Address headers
must not alternate between a different reading edge and a separate outer card.
Address help remains a separate control outside the native summary; using help
does not toggle the address disclosure. Expanded addresses use frameless rows
aligned with the section label, without a separate background or visible table
header. Column labels remain available to assistive technology. Content retains
bounded scrolling, filtering, Copy,
Open and QR actions. Native details keep expansion ownership. Remote internal
listeners retain their scope explanation and on-demand disclosure. Address
semantics remain owned by
[Environment connections](desktop-environment-connections.md).

SSH, URL, container and WSL forms group coherent identity, transport and probing
fields into the same quiet surfaces. Desktop controls share a 258px right column;
short numeric fields remain compact, including 88px SSH port and timeout fields.
Labels and ordinary guidance align left; errors remain associated with their
controls. URL/container guidance uses explicit product classes rather than
structural selectors on generic Tailwind grids or dashed cards. Normal inputs
share a 36px height, with at least 44px for coarse pointers. Advanced fields start
collapsed. Controls retain the published
[settings focus treatment](../ui/runtime-settings.md#settings-controls-and-identity).

WSL exposes labeled distribution, Linux user and Runtime directory facts.
Container selection shares the right control column; refresh stays beside the
selection and errors span its row. Cloud, Gateway and load/retry information use
matching surfaces. Default connection radio choices remain a distinct persisted
operation with their own save action, grouped in a matching surface.
Narrow forms stack labels and controls without hiding values. Text, diagnostics,
paths and addresses remain selectable and wrap within their owner.

## Access tasks and workflows

The access overview presents browser scope, sign-in protection and certificate
tasks as matching rows with meaningful icons and published outline management
buttons. Scope selection cards preserve their whole-card target and selected
state. Sign-in protection groups password state, Set or Change password, and
Remove password in one labeled card before the matching two-factor card.
Password actions stay adjacent in keyboard order and reflow as whole controls.
The removal action references its nearby browser-scope consequence; next-start
timing stays in the same card. Appearance must not turn an uncommitted removal
draft into an already-removed password state.

Certificate identity, system trust, management confirmation and diagnostics stay
inside the same window body and matching settings card. Certificate operations
keep their existing immediate persistence boundary and confirmation owner.
Authenticator verification, enrollment, recovery-code acknowledgement and
management also use the window body and fixed footer, never a nested dialog.

Authenticator entry preserves six visual positions backed by one native numeric
input, including editing, paste, autofill and leading zeroes. Guidance names the
authenticator app. Method changes clear and focus the new code field. Floe owns
its single visible focus boundary. QR pairing and recovery-code grids retain
their specialized geometry; verification and recovery semantics belong to the
settings session contract.

## Actions, responsive layout and focus

Footers keep feedback separate from the action group. Access status contains
text only; Close or Cancel, discard, prerequisite navigation, Review and save
actions share one group, height and baseline. Review is the final primary action
in a pending overview. Errors remain beside their operation and validation
focuses the related field. Disabled saves provide keyboard-accessible context.
Review never contains a password value.

Cancel and Back use ghost controls, body management uses outline controls,
initiating removal uses restrained destructive text, and an explicit commit
retains the appropriate default or destructive variant. Body and footer actions
have at least 32px targets, or 44px for coarse pointers. Address/help and certificate
refresh icons meet the same target sizes. Button labels stay on one line in every
locale and request state. Groups reflow whole controls; explanatory paragraphs
stay outside buttons. Narrow layouts and enlarged text must not produce horizontal
scrolling, clipped actions or unreachable feedback.

Tabs retain 12px Floe trigger padding and 40px height (44px for coarse pointers).
Back uses a compact label and the full destination in its accessible name and
tooltip. Help and native summaries retain padded targets, hover and keyboard
focus. Floe owns focus trapping, nested Escape, restoration, control variants
and forced-colors behavior.

## Motion within the fixed viewport

Floe owns modal entry/exit and the active tab's 200ms underline. Product body
entrance uses 160ms opacity without translating fields or delaying selection.
Rapid switches follow the latest selection without adding state, timers or request
owners. Retained exit cannot blank the closing panel.

Advanced and certificate disclosures expand over 180ms using content height and
opacity inside the body. Closed native details become inert immediately while
visual exit completes. Floe presence retains conditional SSH and certificate
management sections for exit, with immediate inert and accessibility-hidden
state. Rapid reversal follows the existing open state and preserves drafts.
SSH validation focuses invalid input immediately, then checks the field and error
scroll position after expansion. Reduced motion disables these transitions and
tab/content animation. Visual transitions add no lifecycle owner.

# Boundaries

The [settings session contract](desktop-environment-settings.md) owns registration
authority, secret handling, prerequisites and recovery. Presentation preserves
its drafts and operation boundaries. Released Floe owns theme material, modal
presence and focus; Redeven owns composition and responsive geometry. Styling
adds no modal, focus manager or persistence path.

# Evidence

- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.css` - Shared theme material, fields, target sizes and responsive geometry.
- `redeven:desktop/src/welcome/EnvironmentAccessWorkflow.css` - Connection grouping, access tasks, password and workflow hierarchy.
- `redeven:desktop/src/welcome/EnvironmentSettingsDialog.tsx` - Released Dialog, retained panels and fixed scrolling/actions.
- `redeven:desktop/scripts/check-settings-style.mjs` - All shipped themes, three widths, matching surfaces and actual registration forms.
- `redeven:desktop/scripts/check-access-settings.mjs` - Localized access/security/certificate flows, enlarged text, OTP and accessibility.
- `redeven:desktop/scripts/check-environment-settings.mjs` - Real card openings, retained drafts, tab geometry, loading and recovery.
- `redeven:desktop/scripts/check-settings-hit-targets.mjs` - Padded controls, keyboard switching and touch targets.
- `redeven:desktop/scripts/check-settings-expansion.mjs` - Fixed geometry, immediate focus exclusion, rapid reversal and reduced motion.
