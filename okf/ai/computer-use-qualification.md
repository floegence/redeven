---
type: Acceptance Contract
title: Computer use product qualification
description: Establish scope-specific evidence for decoded frames, real target input, control handback and isolated cleanup.
tags: [ai, computer-use, desktop, testing]
timestamp: 2026-09-17T00:00:00Z
---
# Summary

Redeven qualifies Computer use through the actual product renderer, Runtime,
media decoder and target adapter. A passing scenario proves only its declared
target and provider scope. Fixture outcomes, decoded pixels and cleanup are
required evidence; successful HTTP responses or tool metadata alone are
insufficient. Failed input and uncertain effects must never be replayed to
manufacture a passing result.

# Contract

## Semantic execution acceptance

Browser and desktop belong to one delivery scope. Neither may substitute for
the other. Current focused evidence covers real Chromium semantic operations,
same-profile login and cross-profile isolation, explicit CDP selection, nested
cross-site frames, event waits, downloads surviving managed-browser shutdown,
real Native Messaging, nested extension frames, request cancellation, closed-tab
and managed-process loss, and QuickJS resource limits. Swift
unit tests and real GTK/AT-SPI/Xvfb fixtures provide separate native evidence.

Native popup tests cover links, targeted forms, WindowProxy callers, cached
openers and other-site windows. Creation preserves web behavior, while the
opener stops and the child remains unbound until explicitly selected and
authorized. Cancellation and revocation before the click prevent dispatch;
unknown click acknowledgements remain terminal. Occasional focus changes are
accepted, with task completion taking priority over simultaneous human use.
The disposable extension fixture separately verifies virtual focus without tab
activation, release before reattachment, rejection of stale URL/title selection,
and refusal to operate an unbound popup. Chrome is attached with `noDefaults`
so Playwright cannot manufacture a passing background-focus result.
After the user unlocked the console and explicitly continued,
macOS background and foreground fixtures passed. The background scope checks
AX labels, occluded target-only pixels, excluded-owner filtering and unchanged
foreground/pointer. The native action scope checks AX values/buttons, canvas
double-click, Enter, actual scrolling and restoration of the original application,
window and pointer after every operation. The built Desktop private-flow fixture
also passes ordinary/private preview, every frame rate, native IME, rejected and
successful handback, single navigation, narrow layout and preference persistence.
The 2026-09-17 model-driven native Desktop scope passes three turns with 21
actual provider requests. It confirms exact click counts of 2 then 4, canvas
double-click, text/Enter, actual wheel scrolling, canonical target references,
and final screenshots. The three turns decode 13/76/13 live frames, with
13/75/13 distinct images. Incidental input no longer interrupts the sequence.
The complete Desktop browser scope also passes with 43 actual provider requests: semantic and visual input, navigation, Stage layout and hidden execution, computer settings, private ASCII/IME, handback and explicit Stop. Stopping dispatched navigation records an unknown outcome without replay; both cancellation paths allow a new same-thread visual task. Browser turns decode 6/15/80 frames with 6/15/69 distinct images.
Earlier failed startup, scroll-region and input-pause runs remain failed
historical evidence; they are not counted as successes. Lock-screen operation
remains outside the supported scope.

Performance acceptance requires paired runs with the same model, model settings,
task set, initial application state and authorization. Record model round trips,
observed tokens, image bytes, action waiting, total duration, success and user
interference. Targets are at least 40% fewer model round trips, 70% fewer model
image bytes and 30% lower median task time, with no lower success rate. Record
foreground operations and interference;
incidental focus changes do not fail capability acceptance. See
[paired model measurements](computer-use-performance.md) for the runner,
measurement limits and current evidence. Deterministic fixtures cannot stand in
for model-based paired evidence.

The current paired managed-browser run passes all three efficiency thresholds
with both variants completing 9/9 tasks. The latest pair after Codex design
comparison measures 46.2% fewer model requests, 92.7% fewer image bytes and 41.9%
lower median duration. These managed-browser measurements are separate from
native or extension capability evidence. Product UI fixtures choose the target and
save site/application access through Computer connections before model work.
They open Stage through its visible entry and verify that a fork inherits no
site grant before authorizing its own follow-up task.
The 2026-09-17 complete Linux Webtop browser/X11 scope passes with 82 real
provider requests: private handback, cancellation, media isolation, fork,
Runtime restart and cleanup are verified. Browser turns decode 8/4/29 live
frames and X11 turns decode 18/54, all distinct within each turn. No error frames
or failed public viewer/media responses were recorded. This qualifies the
tested worktree build; the exact-main pre-push gate separately qualifies integration. Semantic target
and requested-access references survive the real public Activity projection.
Native protocol coverage separately proves short and split JSONL responses with
stdin still open; it needs no window capture or system input.
`REDEVEN_COMPUTER_UI_SCENARIO=native` limits Desktop model qualification to
three native-window turns with real effects, canonical target references and
continuous decoded frames. It does not qualify browser or private-input flows.
A control pause ends the scenario and requires explicit user continuation;
the runner never resumes or replays an interrupted action automatically.

The exact-main integration gate invokes `check_computer_execution.sh` for real
browser, extension, Native Messaging, QuickJS, relocated bundle, managed profile
and Swift unit coverage. Native popup and incidental-input regression tests
verify capability without weakening explicit target or takeover boundaries.
`check_computer_private_desktop.sh` builds a Linux test
binary and runs GTK/AT-SPI/Xvfb in a disposable pinned container. Neither script
uses the host desktop. Foreground macOS and credentialed model qualification
remain explicit runs; the integration gate cannot substitute for their evidence.

## Existing product fixtures

Desktop qualification observes the preload workspace stream; Linux Webtop uses
CDP's passive HTTP workspace stream copy. Both run the same Composer scenarios
and hash decoded Stage Blob bytes, requiring matching thread, target and image
hash across multiple live events in every turn. Animated fixture markers prove
pixels change without more model actions. Observation stops before private
takeover; reports exclude image bytes and private input. A missing native or
browser live-frame match fails that scope.

`scripts/check_computer_use_webtop.sh` runs the actual Flower UI and configured
DeepSeek model in disposable Debian Webtop. It builds with `GOWORK=off`, consumes
an explicitly verified published Linux plugin runtime, stages the production
browser bundle and installs the isolated Runtime CA. Browser, X11 display,
private D-Bus, fixtures and input remain inside the owned container. Desktop
environment addresses come only from children of the verified Runtime, never
from a guessed durable storage path or another user's session.

Setup has a ten-minute deadline. A supplied `REDEVEN_NODE_ARCHIVE` must match
`.node-version`, architecture and the official checksum. An explicit HTTPS
`REDEVEN_COMPUTER_WEBTOP_DEBIAN_MIRROR` is recorded and retains APT signature
checks; there is no automatic mirror fallback. Unused image repositories do not
participate. Runtime sockets and credential copies remain in container storage.

The complete scope requires managed-browser and X11 effects, decoded frames in
every turn, hidden-viewer persistence, settings and private ASCII/IME handback.
It also verifies these independent lifecycle outcomes:

- Flower Stop cancels ordinary work without appending a Stop message or error
  card. Stopping a dispatched navigation instead produces terminal
  `floret_effect_outcome_unknown`, a visible warning and no replay action. The
  fixture receives exactly one navigation. Both cases restore the composer and
  allow an explicit visual follow-up in the same thread.
- An unrelated thread receives 404 for another thread's media and shows no stale
  Stage. A fork retains authorized historical media but needs its own site grant
  for a new action. No test reads Floret-owned storage.
- A graceful restart of the verified Runtime against the same state preserves
  historical media hashes and decoded pixels, retains cross-thread rejection,
  and supports a new browser turn.

`REDEVEN_COMPUTER_UI_SCENARIO=lifecycle` and `recovery` isolate those respective
scopes. A focused report cannot qualify the complete browser/X11 matrix. The
held-navigation fixture makes interruption observable without injecting model
calls or replacing the production adapter. Observable fixture state is published
atomically; a partial write is never accepted as an outcome.

Diagnostics retain bounded public command identities, status codes, revisions
and event times. They stop before private input and retain no private text or
image bytes. The provider proxy drains streams through an awaited pipeline;
upstream failure propagates without crashing evidence collection, downstream
cancellation closes the upstream body, and no request is replayed to conceal a
transport failure. HTTP 200 alone does not prove completed model output.

Cleanup removes the exact container, temporary bundles and credential copies,
checks source configurations remain byte-identical, and verifies port release.
It waits for exact container-ID absence because stop/removal acknowledgements
can precede deletion. Inventory failure or timeout fails the run. Cleanup is
mandatory after failures and after Runtime replacement as well as on success.

`acceptance-summary.json` binds the declared scope, frozen source commit,
Runtime/computer/plugin artifact hashes, provider/image evidence, scenario
outcomes and cleanup. Missing evidence, provider rejection, retained resources
or private-data exposure fail acceptance even if earlier turns passed. The
report names the native macOS, connected Chrome and other scopes it does not
qualify.

## Private preview and handback

`checkDesktopPrivateComputer.mjs` runs against an explicitly identified,
task-owned Desktop built from the current checkout. Its provider is deterministic;
the Runtime, managed browser helper, workspace stream, private IPC and decoder
remain production implementations. It verifies ordinary preview after unchanged
samples, a 600ms delayed private page change at default 3 FPS, all FPS choices,
client persistence, narrow header placement, native text insertion and Chromium
IME, rejected handback and one safe continuation without navigation replay.
The 2026-09-17 current-worktree Desktop run passes this scope, with delayed
private pixels decoded in 363ms. Resize checks wait for the visible control's
actual bounds after the native window updates. The earlier failed route and
immediate-layout assertions are not passing product evidence.
The isolated headless Stage browser test separately verifies clipboard paste
through the native paste shortcut; the Desktop script does not alter the user's
system clipboard.
Only presentation diagnostics and outcome facts are reported. Test threads and
fixture servers are removed on exit; the owner of the isolated Desktop launch
must stop its exact process tree and verify port release.

# Boundaries

This acceptance contract does not grant target authority or replace the
[media contract](computer-use-media.md) or
[canonical takeover boundary](computer-use-takeover.md). Scripted provider
qualification does not prove a real provider's tool choice or image reasoning.
Google verification is an optional human check, never an automated dependency.
Private user pixels and input must stay out of logs and retained evidence;
synthetic fixture outcomes may be recorded without their input or image bytes.

Restart and history checks use a task-owned built Desktop and Runtime with a
local verification fixture. Cover fresh-client waiting, explicit takeover,
Runtime disconnect and resume after new decoded pixels, terminal collapse,
historical entry and narrow layout. Restart must not navigate or replay input.
Browser tests separately inject late decoding, expired interactions and queued
commands to verify close, selection and connection boundaries deterministically.

# Evidence

- `redeven:internal/envapp/ui_src/scripts/checkDesktopComputerStage.mjs` - Built Desktop and Linux scenarios with actual provider and pixel evidence.
- `redeven:internal/envapp/ui_src/scripts/checkDesktopPrivateComputer.mjs` - Deterministic provider with real Desktop takeover, frames and handback.
- `redeven:scripts/check_computer_use_webtop.sh` - Isolated Linux product qualification and cleanup.
- `redeven:internal/envapp/ui_src/scripts/computerViewerInteraction.mjs` - Published floating window and launcher interaction checks.
