import './index.css';

import type { DesktopLauncherActionRequest, DesktopWelcomeIssue, DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';

type DesktopLauncherBridge = Readonly<{
  getSnapshot: () => Promise<DesktopWelcomeSnapshot>;
  performAction: (request: DesktopLauncherActionRequest) => Promise<void>;
}>;

declare global {
  interface Window {
    redevenDesktopLauncher?: DesktopLauncherBridge;
  }
}

function escapeHTML(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function launcherBridge(): DesktopLauncherBridge | null {
  const candidate = window.redevenDesktopLauncher;
  if (!candidate || typeof candidate.getSnapshot !== 'function' || typeof candidate.performAction !== 'function') {
    return null;
  }
  return candidate;
}

function issueKicker(issue: DesktopWelcomeIssue): string {
  switch (issue.scope) {
    case 'remote_device':
      return 'Remote device';
    case 'this_device':
      return 'This device';
    default:
      return 'Desktop startup';
  }
}

function renderIssueActions(issue: DesktopWelcomeIssue): string {
  const actions: string[] = [];
  if (issue.scope === 'this_device') {
    actions.push('<button type="button" data-action="open-this-device" class="inline-flex cursor-pointer items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90">Try This Device Again</button>');
    actions.push('<button type="button" data-action="open-settings" class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent">This Device Options</button>');
  }
  if (issue.scope === 'remote_device' && issue.target_url) {
    actions.push('<button type="button" data-action="retry-remote" class="inline-flex cursor-pointer items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90">Retry Device</button>');
  }
  if (issue.diagnostics_copy) {
    actions.push('<button type="button" data-action="copy-diagnostics" class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent">Copy Diagnostics</button>');
  }
  return actions.join('');
}

function renderRecentDevices(snapshot: DesktopWelcomeSnapshot): string {
  if (snapshot.recent_devices.length === 0) {
    return `
      <div class="rounded-xl border border-dashed border-border/70 bg-background/60 p-5 text-sm text-muted-foreground">
        No recent devices yet. Connect to another machine once and it will show up here next time.
      </div>
    `;
  }

  return snapshot.recent_devices.map((device) => `
    <button
      type="button"
      data-action="open-recent"
      data-url="${escapeHTML(device.local_ui_url)}"
      class="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-border bg-background/70 px-4 py-4 text-left transition hover:border-primary/40 hover:bg-accent/50"
    >
      <div class="min-w-0">
        <div class="text-sm font-medium text-foreground">Recent device</div>
        <div class="redeven-mono mt-1 break-all text-sm text-muted-foreground">${escapeHTML(device.local_ui_url)}</div>
      </div>
      ${device.is_active_session ? '<span class="inline-flex shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Current</span>' : ''}
    </button>
  `).join('');
}

function renderApp(snapshot: DesktopWelcomeSnapshot): string {
  const issue = snapshot.issue;
  const issueMarkup = issue ? `
    <section id="launcher-issue" tabindex="-1" role="alert" aria-live="assertive" class="rounded-2xl border border-destructive/30 bg-destructive/7 p-4 shadow-sm outline-none">
      <div class="text-xs font-semibold uppercase tracking-[0.16em] text-destructive/90">${escapeHTML(issueKicker(issue))}</div>
      <h2 class="mt-2 text-xl font-semibold text-foreground">${escapeHTML(issue.title)}</h2>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">${escapeHTML(issue.message)}</p>
      ${issue.diagnostics_copy ? `<pre id="issue-diagnostics" class="redeven-mono mt-4 overflow-auto rounded-xl border border-border bg-background/80 p-4 text-xs leading-6 text-muted-foreground">${escapeHTML(issue.diagnostics_copy)}</pre>` : ''}
      <div class="mt-4 flex flex-wrap gap-3">${renderIssueActions(issue)}</div>
    </section>
  ` : '';

  return `
    <main id="desktop-welcome-main" class="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-8 sm:px-8">
      <section class="rounded-[28px] border border-border/80 bg-card/90 shadow-2xl shadow-black/8 backdrop-blur-xl">
        <header class="border-b border-border/70 px-6 py-6 sm:px-8">
          <div class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Redeven Desktop</div>
          <div class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 class="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Open a machine</h1>
              <p class="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
                Start from the same welcome surface every time: choose This Device, reopen a recent Redeven machine, or connect to another device by URL.
              </p>
            </div>
            <button
              type="button"
              data-action="close"
              class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
            >
              ${escapeHTML(snapshot.close_action_label)}
            </button>
          </div>

          <div class="mt-6 grid gap-3 md:grid-cols-3">
            <article class="rounded-2xl border border-border/70 bg-background/70 p-4">
              <div class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Current session</div>
              <div class="mt-2 text-lg font-semibold text-foreground">${escapeHTML(snapshot.current_session_label)}</div>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">${escapeHTML(snapshot.current_session_description)}</p>
            </article>
            <article class="rounded-2xl border border-border/70 bg-background/70 p-4">
              <div class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">This Device sharing</div>
              <div class="mt-2 text-lg font-semibold text-foreground">${escapeHTML(snapshot.this_device_share_label)}</div>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">${escapeHTML(snapshot.this_device_share_description)}</p>
            </article>
            <article class="rounded-2xl border border-border/70 bg-background/70 p-4">
              <div class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Remote control link</div>
              <div class="mt-2 text-lg font-semibold text-foreground">${escapeHTML(snapshot.this_device_link_label)}</div>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">${escapeHTML(snapshot.this_device_link_description)}</p>
            </article>
          </div>
        </header>

        <div class="grid gap-6 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.9fr)]">
          <section class="space-y-6">
            ${issueMarkup}

            <section class="rounded-2xl border border-border bg-background/75 p-5">
              <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div class="max-w-2xl">
                  <div class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">This Device</div>
                  <h2 class="mt-2 text-2xl font-semibold text-foreground">Open the runtime on this machine</h2>
                  <p class="mt-2 text-sm leading-6 text-muted-foreground">
                    Treat this like the VS Code "open workspace" default: one primary action, with low-level startup details moved behind This Device Options.
                  </p>
                </div>
                <div class="flex flex-wrap gap-3">
                  <button type="button" data-action="open-this-device" class="inline-flex cursor-pointer items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">Open This Device</button>
                  <button type="button" data-action="open-settings" class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent">This Device Options</button>
                </div>
              </div>
              ${snapshot.this_device_local_ui_url ? `<div class="redeven-mono mt-4 rounded-xl border border-primary/20 bg-primary/6 px-4 py-3 text-sm text-primary">Ready at ${escapeHTML(snapshot.this_device_local_ui_url)}</div>` : ''}
            </section>

            <section class="rounded-2xl border border-border bg-background/75 p-5">
              <div class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recent Devices</div>
              <h2 class="mt-2 text-2xl font-semibold text-foreground">Open another machine</h2>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">
                Recent Redeven Local UI targets stay one click away, just like reopening a recent project from a workbench welcome screen.
              </p>
              <div class="mt-5 grid gap-3">
                ${renderRecentDevices(snapshot)}
              </div>
            </section>
          </section>

          <aside class="rounded-2xl border border-border bg-background/75 p-5">
            <div class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Connect Another Device</div>
            <h2 class="mt-2 text-2xl font-semibold text-foreground">Paste a Redeven URL</h2>
            <p class="mt-2 text-sm leading-6 text-muted-foreground">
              Enter the base Local UI URL from another machine on your network. Desktop will normalize it to the device root before opening it.
            </p>

            <label class="mt-5 block text-sm font-medium text-foreground" for="remote-url">Redeven URL</label>
            <input
              id="remote-url"
              class="redeven-mono mt-2 block w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              type="url"
              autocomplete="url"
              spellcheck="false"
              value="${escapeHTML(snapshot.suggested_remote_url)}"
              placeholder="http://192.168.1.11:24000/"
            >

            <div id="local-error" tabindex="-1" role="alert" aria-live="assertive" aria-hidden="true" class="mt-3 hidden rounded-xl border border-destructive/30 bg-destructive/7 px-4 py-3 text-sm text-destructive outline-none"></div>

            <div class="mt-5 flex flex-wrap gap-3">
              <button type="button" data-action="open-remote" class="inline-flex cursor-pointer items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">Open Device</button>
              <button type="button" data-action="close" class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-accent">${escapeHTML(snapshot.close_action_label)}</button>
            </div>

            <div class="mt-8 rounded-2xl border border-border/70 bg-card/80 p-4">
              <div class="text-sm font-medium text-foreground">Why this layout</div>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">
                Machine choice stays front and center. Desktop-specific bind, password, and bootstrap fields live behind This Device Options so the startup surface behaves like a launcher instead of a settings form.
              </p>
            </div>
          </aside>
        </div>
      </section>
    </main>
  `;
}

async function copyToClipboard(text: string): Promise<void> {
  if (!text) {
    return;
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

async function main(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }

  const bridge = launcherBridge();
  if (!bridge) {
    root.innerHTML = `
      <main class="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-5 py-10">
        <section class="w-full rounded-2xl border border-destructive/30 bg-destructive/7 p-6">
          <div class="text-sm font-semibold uppercase tracking-[0.16em] text-destructive">Desktop bridge missing</div>
          <h1 class="mt-2 text-2xl font-semibold text-foreground">Redeven Desktop could not open the launcher bridge.</h1>
          <p class="mt-3 text-sm leading-6 text-muted-foreground">Restart Redeven Desktop and try again.</p>
        </section>
      </main>
    `;
    return;
  }

  const snapshot = await bridge.getSnapshot();
  root.innerHTML = renderApp(snapshot);

  const localError = document.getElementById('local-error');
  const remoteInput = document.getElementById('remote-url') as HTMLInputElement | null;

  const setLocalError = (message: string) => {
    if (!localError) {
      return;
    }
    const text = String(message ?? '').trim();
    localError.textContent = text;
    localError.classList.toggle('hidden', text === '');
    localError.setAttribute('aria-hidden', text ? 'false' : 'true');
    if (text) {
      queueMicrotask(() => {
        (localError as HTMLElement).focus();
      });
    }
  };

  const performAction = async (request: DesktopLauncherActionRequest) => {
    setLocalError('');
    try {
      await bridge.performAction(request);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  root.querySelectorAll('[data-action="open-this-device"]').forEach((element) => {
    element.addEventListener('click', () => {
      void performAction({ kind: 'open_this_device' });
    });
  });

  root.querySelectorAll('[data-action="open-settings"]').forEach((element) => {
    element.addEventListener('click', () => {
      void performAction({ kind: 'open_advanced_settings' });
    });
  });

  root.querySelectorAll('[data-action="close"]').forEach((element) => {
    element.addEventListener('click', () => {
      void performAction({ kind: 'return_to_current_device' });
    });
  });

  root.querySelectorAll('[data-action="open-recent"]').forEach((element) => {
    element.addEventListener('click', () => {
      const button = element as HTMLElement;
      const externalLocalUIURL = String(button.dataset.url ?? '').trim();
      void performAction({ kind: 'open_remote_device', external_local_ui_url: externalLocalUIURL });
    });
  });

  root.querySelector('[data-action="open-remote"]')?.addEventListener('click', () => {
    const externalLocalUIURL = String(remoteInput?.value ?? '').trim();
    void performAction({ kind: 'open_remote_device', external_local_ui_url: externalLocalUIURL });
  });

  root.querySelector('[data-action="retry-remote"]')?.addEventListener('click', () => {
    const externalLocalUIURL = String(snapshot.issue?.target_url ?? remoteInput?.value ?? '').trim();
    void performAction({ kind: 'open_remote_device', external_local_ui_url: externalLocalUIURL });
  });

  root.querySelector('[data-action="copy-diagnostics"]')?.addEventListener('click', () => {
    void copyToClipboard(String(snapshot.issue?.diagnostics_copy ?? ''));
  });

  const issueElement = document.getElementById('launcher-issue');
  if (issueElement) {
    queueMicrotask(() => {
      (issueElement as HTMLElement).focus();
    });
  }
}

void main();
