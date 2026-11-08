import { controlText } from '../testSupport/controlText';
import type { FlowerChromeStatus, FlowerComputerEnvironment, FlowerTurnLaunchInput } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import '../index.css';
import './flower-feature.css';
import { expect, it, onTestFinished, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { createFlowerComposerDraftCoordinator, type FlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import type { FlowerBrowserInstallationSnapshot, FlowerComputerUserInput, FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { applyFlowerRuntimeCurrentView } from '../../../../flower_ui/src/runtimeCurrentView';
import { activityItem, activityTimeline, adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, renderSurfaceWithDraftCoordinator, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';

async function setup(kind: 'site' | 'captcha' | 'unknown' | 'connection' | 'installation' | 'desktop_setup' = 'site', permission: 'approval_required' | 'full_access' = 'approval_required', draftCoordinator?: FlowerComposerDraftCoordinator) {
  await page.viewport(1280, 900);
  const threadID = 'assistance-fixture';
  const item = activityItem({ item_id: 'step', tool_id: 'navigate', tool_name: kind === 'connection' ? 'computer_list_targets' : 'browser_navigate', renderer: 'structured', status: 'success',
    target_refs: [{ kind: kind === 'connection' ? 'computer_browser_source' : 'computer_control', label: 'Task browser', resource_ref: kind === 'connection' ? 'system' : 'browser-main' },
      ...(kind === 'site' ? [{ kind: 'computer_origin', label: 'https://www.google.com', resource_ref: 'https://www.google.com' }] : [])],
    chips: kind === 'site' ? [] : [{ kind: 'computer_assistance', label: 'Required step', value: kind === 'connection' ? 'connection' : kind === 'captcha' ? 'captcha' : 'inspection' }],
    payload: { operation: 'navigate', status: 'success' },
  });
  const snapshot = thread({ thread_id: threadID, permission_type: permission, status: 'waiting_user', active_run_id: 'run-control', messages: [{
    id: 'message', turn_id: 'turn-control', run_id: 'run-control', role: 'assistant', content: '', status: 'complete', created_at_ms: 10,
    blocks: [activityTimeline({ thread_id: threadID, turn_id: 'turn-control', run_id: 'run-control', status: 'success', items: [item] })],
  }] });
  const base = runtimeCurrentView(snapshot, 1);
  const current = { ...base, items: base.items?.map(entry => {
    if (!entry.activity) return entry;
    const { label, description, renderer, payload, chips, target_refs, ...facts } = entry.activity;
    return { ...entry, activity: { ...facts, presentation: { label, description, renderer, payload, chips, target_refs } } };
  }), interactions: [{ computer_assistance: { kind, tool_call_id: 'navigate', ...(kind === 'connection' || kind === 'installation' ? {} : {target_id: kind === 'desktop_setup' ? 'xvfb-main' : 'browser-main'}) }, id: kind === 'desktop_setup' ? 'ask:desktop' : 'tool-input:step', kind: 'input' as const, turn_id: 'turn-control', run_id: 'run-control', tool_call_id: 'navigate',
    input: { summary: 'Specific external step', questions: [{ id: kind === 'installation' ? 'browser_install' : kind === 'connection' ? 'browser_connection' : 'computer_control', prompt: 'Inspect the selected page.', kind: 'select', options: kind === 'installation' ? ['Continue with installed browser', 'Continue without built-in browser'] : [kind === 'connection' ? 'Continue with connected browser' : 'Return control to Flower'] }] },
  }] };
  const gate = deferred<void>();
  const other = thread({ thread_id: 'other-conversation' });
  const saveAccess = vi.fn(() => gate.promise);
  const loadExtensionStatus = vi.fn(async (): Promise<FlowerChromeStatus> => ({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'personal', name: 'Personal' }] }));
  const loadAccess = vi.fn(async () => ({ origins: ['https://existing.test'], apps: ['dev.Notes'], allow_foreground: false }));
  const submitInput = vi.fn(async () => ({ thread_id: threadID, consumed_prompt_id: 'tool-input:step', current: { ...current, view_version: 2, activity: 'idle' as const, last_outcome: 'completed' as const, interactions: [] } }));
  const inputComputerControl = vi.fn(async (_input: FlowerComputerUserInput) => undefined);
  const setComputerViewer = vi.fn(async (_request: { interaction_id?: string }) => undefined);
  const browser = { storage_bytes: 600000, enabled: true, state: 'not_installed' as const, launch: { state: 'installation_required' as const }, directory: '/state/browser', received_bytes: 0,
    package: { name: 'Chrome for Testing', id: 'fixture', version: '148', platform: 'linux', architecture: 'amd64', url: 'https://cdn.playwright.dev/fixture.zip', sha256: '0'.repeat(64), size_bytes: 180000000, installed_bytes: 390000000 } };
  const loadBrowserInstallation = vi.fn().mockResolvedValue(browser);
  const loadEnvironment = vi.fn<() => Promise<FlowerComputerEnvironment>>().mockResolvedValue({ hostname: 'udesk26', platform: 'linux', managed: { state: 'on_demand' }, desktop: { state: 'on_demand' }, chrome: { installations: [], profiles: [] } });
  const verifyDesktop = vi.fn().mockResolvedValue({ state: 'ready' });
  const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => ({ client_request_id: input.client_request_id, thread_id: 'repair-conversation' }));
  let receiveInstallation: ((value: FlowerBrowserInstallationSnapshot) => void) | undefined;
  const unsubscribeInstallation = vi.fn();
  const subscribeBrowserInstallation = vi.fn((listener: (value: FlowerBrowserInstallationSnapshot) => void) => {
    receiveInstallation = listener;
    return unsubscribeInstallation;
  });
  const publishInstallation = (value: FlowerBrowserInstallationSnapshot) => receiveInstallation!(value);
  const installBrowser = vi.fn().mockResolvedValue({ ...browser, state: 'downloading', launch: { state: 'installation_required' as const }, operation_id: 'confirmed' });
  let deliver: (envelope: FlowerLiveStreamEnvelope) => void = () => undefined;
  const publishStatus = (computer_status: NonNullable<FlowerLiveStreamEnvelope['computer_status']>, thread_id = computer_status.thread_id) => deliver({ schema_version: 3, kind: 'computer.status', thread_id, computer_status });
  const publish = (value: FlowerLiveStreamEnvelope) => deliver(value);
  const loadThread = vi.fn(async (id: string) => id === threadID ? { thread: applyFlowerRuntimeCurrentView(snapshot, current), current } : liveBootstrap(thread({ thread_id: id })));
  const source = { ...adapter(true), launchTurn, submitInput, inputComputerControl, setComputerViewer,
    computerManagement: { loadEnvironment, verifyDesktop, loadBrowserInstallation, subscribeBrowserInstallation, installBrowser, saveBrowserEnabled: vi.fn(), openExtension: vi.fn(), loadExtensionStatus, setupExtension: vi.fn(), listCandidates: vi.fn().mockResolvedValue({current_target_id:"",candidates:[]}), selectCandidate:vi.fn(), loadAccess, saveAccess,     },
    listThreads: vi.fn(async () => [snapshot, other]), loadThread,
    connectLiveStream: async function* ({ signal }: { signal: AbortSignal }) {
      yield { schema_version: 3 as const, kind: 'ready' as const, baseline_complete: true, observer_id: 'assistance-observer', summaries: [snapshot, other] };
      while (!signal.aborted) {
        const envelope = await new Promise<FlowerLiveStreamEnvelope | undefined>((resolve) => {
          const abort = () => resolve(undefined);
          deliver = (value) => { signal.removeEventListener('abort', abort); resolve(value); };
          signal.addEventListener('abort', abort, { once: true });
        });
        if (envelope) yield envelope;
      }
    },
  };
  const focusThreadRequest = { request_id: 'select-assistance', thread_id: threadID };
  const surface = draftCoordinator ? renderSurfaceWithDraftCoordinator(source, draftCoordinator, { focusThreadRequest })
    : renderSurfaceWithAdapterProps(source, { focusThreadRequest, layout: true });
  Object.assign(surface.style, { width: '1200px', height: '800px' });
  await waitFor(() => !!surface.querySelector('.flower-computer-control-heading'));
  return { surface, gate, saveAccess, loadAccess, submitInput, inputComputerControl, setComputerViewer, publishStatus, publish, loadThread, loadExtensionStatus, loadBrowserInstallation, installBrowser, browser, publishInstallation, unsubscribeInstallation, verifyDesktop, loadEnvironment, launchTurn };
}

async function requestDesktopRepair(s: Awaited<ReturnType<typeof setup>>) {
  s.loadEnvironment.mockResolvedValue({ hostname: 'udesk26', platform: 'linux', managed: { state: 'on_demand' },
    desktop: { state: 'setup_required', reason: 'window_manager_missing' }, chrome: { installations: [], profiles: [] } });
  const card = s.surface.querySelector('.flower-computer-control-heading')!.closest('section')!;
  const install = [...card.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === 'Ask Flower to install')!;
  install.click(); install.click();
  await waitFor(() => s.launchTurn.mock.calls.length === 1);
}

it('opens the accepted repair and provides a working reference back to the unanswered original task', async () => {
  const drafts = createFlowerComposerDraftCoordinator();
  const s = await setup('desktop_setup', 'approval_required', drafts);
  drafts.open('assistance-fixture').mutate(value => ({ ...value, text: 'Preserve this draft',
    references: [{ local_id: 'kept-file', kind: 'file', path: '/workspace/notes.txt', label: 'notes.txt' }] }));
  const originalLoad = s.loadThread.getMockImplementation()!;
  s.launchTurn.mockImplementation(async input => {
    const context = input.context_action as { context: { thread: { thread_id: string } }[] };
    const repaired = thread({ thread_id: 'repair-conversation', messages: [{ id: `user:${input.client_request_id}`, turn_id: 'repair-turn',
      role: 'user', content: input.prompt, status: 'complete', created_at_ms: 10, references: [{ reference_id: 'original-task',
        kind: 'thread', referenced_thread_id: 'assistance-fixture', label: 'Original task', text: JSON.stringify(context.context[0].thread) }] }] });
    const base = runtimeCurrentView(repaired, 1);
    const current = { ...base, items: base.items?.map(item => ({ ...item, references: repaired.messages[0].references })) };
    s.loadThread.mockImplementation(async id => id === 'repair-conversation' ? { thread: repaired, current } : originalLoad(id));
    return { client_request_id: input.client_request_id, thread_id: repaired.thread_id, current };
  });
  await requestDesktopRepair(s);
  await waitFor(() => s.surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === 'repair-conversation');
  await waitFor(() => !!s.surface.querySelector('[data-flower-chat-context-chip="true"]'));
  await userEvent.click(s.surface.querySelector<HTMLButtonElement>('[data-flower-chat-context-chip="true"]')!);
  await userEvent.click(page.getByRole('button', { name: 'Open conversation', exact: true }));
  await waitFor(() => s.surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === 'assistance-fixture');
  await waitFor(() => !!s.surface.querySelector('.flower-computer-control-heading'));
  expect(drafts.read('assistance-fixture').value).toMatchObject({ text: 'Preserve this draft',
    references: [{ local_id: 'kept-file', path: '/workspace/notes.txt' }] });
  expect(s.surface.textContent).toContain('Inspect the selected page.');
  expect(s.submitInput).not.toHaveBeenCalled();
  expect(s.inputComputerControl).not.toHaveBeenCalled();
});

it('keeps an unknown repair recoverable and retries the same new-conversation request identity', async () => {
  const s = await setup('desktop_setup');
  s.launchTurn.mockRejectedValueOnce(flowerTurnAdmissionError('unknown', new Error('Connection lost')));
  await requestDesktopRepair(s);
  await waitFor(() => !!s.surface.querySelector('[data-flower-transport-delivery="unknown"]'));
  const original = s.launchTurn.mock.calls[0][0];
  const retry = s.surface.querySelector<HTMLButtonElement>('[data-flower-transport-delivery="unknown"] [aria-label="Retry send"]')!;
  expect(retry).toBeTruthy();
  retry.click(); retry.click();
  await waitFor(() => s.launchTurn.mock.calls.length === 2);
  expect(s.launchTurn.mock.calls[1][0]).toEqual(original);
  expect(original.thread_id).toBeUndefined();
  expect(s.submitInput).not.toHaveBeenCalled();
});

it('does not redirect another conversation when delayed repair acceptance arrives', async () => {
  const s = await setup('desktop_setup');
  const pending = deferred<{ client_request_id: string; thread_id: string }>();
  s.launchTurn.mockImplementation(() => pending.promise);
  await requestDesktopRepair(s);
  s.surface.querySelector<HTMLButtonElement>('[data-thread-id="other-conversation"] .flower-thread-card-select-button')!.click();
  await waitFor(() => s.surface.querySelector('[data-thread-id="other-conversation"]')?.getAttribute('data-flower-thread-active') === 'true');
  pending.resolve({ client_request_id: s.launchTurn.mock.calls[0][0].client_request_id, thread_id: 'repair-conversation' });
  await waitFor(() => !s.surface.querySelector('[data-flower-transport-delivery="pending"]'));
  expect(s.surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id')).toBe('other-conversation');
  expect(s.submitInput).not.toHaveBeenCalled();
});

it('accepts canonical repair confirmation before a lost HTTP receipt without sending twice', async () => {
  const s = await setup('desktop_setup');
  const pending = deferred<{ client_request_id: string; thread_id: string }>();
  s.launchTurn.mockImplementation(() => pending.promise);
  await requestDesktopRepair(s);
  const request = s.launchTurn.mock.calls[0][0];
  const repaired = thread({ thread_id: 'repair-conversation', messages: [{ id: `user:${request.client_request_id}`,
    turn_id: 'repair-turn', role: 'user', content: request.prompt, status: 'complete', created_at_ms: 10 }] });
  s.publish({ schema_version: 3, kind: 'thread.batch', thread_id: repaired.thread_id, current: runtimeCurrentView(repaired, 1) });
  await waitFor(() => s.surface.querySelector('[data-flower-selected-thread-id]')?.getAttribute('data-flower-selected-thread-id') === repaired.thread_id);
  pending.reject(flowerTurnAdmissionError('unknown', new Error('Receipt lost')));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(s.surface.querySelector('[data-flower-transport-delivery="unknown"]')).toBeNull();
  expect(s.launchTurn).toHaveBeenCalledTimes(1);
  expect(s.submitInput).not.toHaveBeenCalled();
});

it('starts a separate Flower repair conversation on the same runtime without answering the original question', async () => {
  const s = await setup('desktop_setup');
  s.loadEnvironment.mockResolvedValue({ hostname: 'udesk26', platform: 'linux', managed: { state: 'on_demand' }, desktop: { state: 'setup_required', reason: 'x11_input_missing', components: [{ id: 'x11_input', path: '/usr/bin/xdotool' }], repair: 'ubuntu_apt', packages: ['xdotool'] }, chrome: { installations: [], profiles: [] } });
  const card = s.surface.querySelector('.flower-computer-control-heading')!.closest('section')!;
  [...card.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === 'Environment diagnostics')!.click();
  await waitFor(() => [...document.querySelectorAll('button')].some(item => item.textContent?.trim() === 'Ask Flower to install'));
  const install = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(item => item.textContent?.trim() === 'Ask Flower to install')!;
  install.click(); install.click();
  await waitFor(() => s.launchTurn.mock.calls.length === 1);
  const request = s.launchTurn.mock.calls[0][0];
  expect(request.thread_id).toBeUndefined();
  expect(request.prompt).toContain('udesk26');
  expect(request.prompt).toContain('/usr/bin/xdotool');
  expect(request.prompt).toContain('xdotool');
  expect(request.prompt).toContain('runtime');
  expect(request.context_action).toMatchObject({ target: { locality: 'current_runtime' },
    context: [{ kind: 'thread_reference', thread: { thread_id: 'assistance-fixture' } }] });
  expect(s.submitInput).not.toHaveBeenCalled();
  expect(s.inputComputerControl).not.toHaveBeenCalled();
  expect(s.verifyDesktop).not.toHaveBeenCalled();
});

it('opens desktop repair for the current evidence and leaves the original question unanswered after verification', async () => {
  const s = await setup('desktop_setup');
  const card = s.surface.querySelector('.flower-computer-control-heading')!.closest('section')!;
  expect(card.textContent).toContain('Install system components');
  [...card.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === 'Environment diagnostics')!.click();
  await waitFor(() => !![...document.querySelectorAll('button')].find(item => controlText(item) === 'Verify desktop'));
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => controlText(item) === 'Verify desktop')!.click();
  await waitFor(() => document.body.textContent?.includes('Private desktop verified:') === true);
  expect(s.verifyDesktop).toHaveBeenCalledTimes(1);
  expect(s.submitInput).not.toHaveBeenCalled();
  expect(s.inputComputerControl).not.toHaveBeenCalled();
  expect(s.setComputerViewer).not.toHaveBeenCalled();
  expect(card.textContent).toContain('Inspect the selected page.');
});

it('explains the exact site grant and grants it once before continuing without manual browser control', async () => {
  const s = await setup();
  const card = s.surface.querySelector('.flower-computer-control-heading')!.closest('section')!;
  expect(card.textContent).toContain('https://www.google.com');
  expect(card.textContent).toContain('Allow website access');
  const entry = s.surface.querySelector('.flower-computer-entry')!;
  expect(entry.textContent).toBe('Allow website access');
  expect(entry.hasAttribute('data-floe-progress-shimmer')).toBe(false);
  const activity = s.surface.querySelector('.flower-activity-inline-title')!;
  expect(activity.textContent).toBe('BrowserUse: Open page');
  expect(entry.getAttribute('data-session-state')).toBe('awaiting_control');
  expect(card.querySelector('[data-computer-control-action="take"]')).toBeNull();
  const allow = card.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!;
  expect(allow.textContent).toBe('Allow and continue');
  for (const button of card.querySelectorAll('button')) {
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(card.getBoundingClientRect().right + 1);
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
    expect(getComputedStyle(button).cursor).toBe('pointer');
  }
  if (import.meta.env.VITE_COMPUTER_ASSISTANCE_SCREENSHOT === '1') await page.screenshot({ element: card, path: '__screenshots__/flower-assistance-site-card.png' });
  allow.click(); allow.click();
  await waitFor(() => s.saveAccess.mock.calls.length === 1);
  expect(s.saveAccess).toHaveBeenCalledWith('assistance-fixture', { origins: ['https://existing.test', 'https://www.google.com'], apps: ['dev.Notes'], allow_foreground: false });
  expect(s.submitInput).not.toHaveBeenCalled();
  s.gate.resolve();
  await waitFor(() => s.submitInput.mock.calls.length === 1);
  await waitFor(() => !s.surface.querySelector('.flower-computer-control-heading'));
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
});

it('does not continue a different conversation after an in-flight grant finishes', async () => {
  const s = await setup();
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.click();
  await waitFor(() => s.saveAccess.mock.calls.length === 1);
  s.surface.querySelector<HTMLButtonElement>('[data-thread-id="other-conversation"] .flower-thread-card-select-button')!.click();
  await waitFor(() => s.surface.querySelector('[data-thread-id="other-conversation"]')?.getAttribute('data-flower-thread-active') === 'true');
  s.gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(s.submitInput).not.toHaveBeenCalled();
  expect(s.saveAccess).toHaveBeenCalledTimes(1);
});

it('does not save access after the user leaves while access is loading', async () => {
  const s = await setup();
  const loaded = deferred<{ origins: string[]; apps: string[]; allow_foreground: boolean }>();
  s.loadAccess.mockImplementation(() => loaded.promise);
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.click();
  await waitFor(() => s.loadAccess.mock.calls.length === 1);
  s.surface.querySelector<HTMLButtonElement>('[data-thread-id="other-conversation"] .flower-thread-card-select-button')!.click();
  await waitFor(() => s.surface.querySelector('[data-thread-id="other-conversation"]')?.getAttribute('data-flower-thread-active') === 'true');
  loaded.resolve({ origins: [], apps: [], allow_foreground: false });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(s.saveAccess).not.toHaveBeenCalled();
  expect(s.submitInput).not.toHaveBeenCalled();
});

it('keeps the request actionable when saving access fails and does not continue', async () => {
  const s = await setup();
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.click();
  await waitFor(() => s.saveAccess.mock.calls.length === 1);
  s.gate.reject(new Error('write failed'));
  await waitFor(() => !!s.surface.querySelector('.flower-computer-control-notice'));
  expect(s.submitInput).not.toHaveBeenCalled();
  expect(s.surface.querySelector('.flower-computer-control-notice')?.textContent).toContain('Access');
  expect(s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="grant"]')!.disabled).toBe(false);
});

it('names the CAPTCHA task and tells the user where to perform it', async () => {
  const s = await setup('captcha');
  expect(s.surface.querySelector('.flower-computer-control-heading')?.textContent).toContain('Complete the CAPTCHA');
  expect(s.surface.querySelector('[data-computer-control-action="take"]')?.textContent).toBe('Open page');
  expect(s.surface.querySelector('[data-computer-control-action="return"]')?.textContent).toBe('Continue check');
  expect(s.saveAccess).not.toHaveBeenCalled();
});

it('does not invent a sign-in requirement when page inspection fails', async () => {
  const s = await setup('unknown');
  expect(s.surface.querySelector('.flower-computer-control-heading')?.textContent).toContain('could not safely inspect');
  expect(s.surface.querySelector('.flower-computer-control-heading')?.textContent).not.toContain('Complete sign-in');
});

it.each(['unknown', 'site'] as const)('fills the %s action icon slot and keeps its geometry through submission and recovery', async (kind) => {
  const originalTheme = document.documentElement.className;
  onTestFinished(() => { document.documentElement.className = originalTheme; });
  document.documentElement.classList.toggle('dark', kind === 'unknown');
  const s = await setup(kind);
  const button = s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="return"], [data-computer-control-action="grant"]')!;
  const card = button.closest('section')!;
  const idleIcon = button.querySelector('svg');
  expect(idleIcon).not.toBeNull();
  const idleIconBounds = idleIcon!.getBoundingClientRect();
  expect(idleIconBounds.width).toBeGreaterThan(0);
  expect(idleIconBounds.height).toBeGreaterThan(0);
  expect(button.getAttribute('aria-busy')).toBeNull();
  expect(getComputedStyle(button).cursor).toBe('pointer');
  const idleBounds = button.getBoundingClientRect();
  const pending = deferred<never>();
  s.submitInput.mockImplementationOnce(() => pending.promise);
  s.gate.resolve();
  if (import.meta.env.VITE_COMPUTER_ASSISTANCE_SCREENSHOT === '1') await page.screenshot({ element: card, path: `__screenshots__/flower-assistance-${kind}-idle.png` });

  button.click(); button.click();
  await waitFor(() => s.submitInput.mock.calls.length === 1);
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  const spinner = button.querySelector<SVGElement>('svg.animate-spin');
  expect(spinner).not.toBeNull();
  expect(getComputedStyle(spinner!).width).toBe(getComputedStyle(spinner!.parentElement!).width);
  expect(Math.abs(button.getBoundingClientRect().width - idleBounds.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(button.getBoundingClientRect().height - idleBounds.height)).toBeLessThanOrEqual(1);
  if (import.meta.env.VITE_COMPUTER_ASSISTANCE_SCREENSHOT === '1') await page.screenshot({ element: card, path: `__screenshots__/flower-assistance-${kind}-submitting.png` });

  pending.reject(new Error('Check could not be submitted'));
  await waitFor(() => !button.disabled);
  expect(button.getAttribute('aria-busy')).toBeNull();
  expect(button.querySelector('svg')).not.toBeNull();
  expect(button.querySelector('svg.animate-spin')).toBeNull();
  expect(Math.abs(button.getBoundingClientRect().width - idleBounds.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(button.getBoundingClientRect().height - idleBounds.height)).toBeLessThanOrEqual(1);
  expect(getComputedStyle(button).cursor).toBe('pointer');

  await page.viewport(390, 844);
  s.surface.style.width = '360px';
  await new Promise(resolve => requestAnimationFrame(resolve));
  for (const action of card.querySelectorAll<HTMLButtonElement>('button')) {
    expect(action.getBoundingClientRect().left).toBeGreaterThanOrEqual(card.getBoundingClientRect().left - 1);
    expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(card.getBoundingClientRect().right + 1);
    expect(action.scrollWidth).toBeLessThanOrEqual(action.clientWidth + 1);
    expect(getComputedStyle(action).whiteSpace).toBe('nowrap');
  }
  if (import.meta.env.VITE_COMPUTER_ASSISTANCE_SCREENSHOT === '1') await page.screenshot({ element: card, path: `__screenshots__/flower-assistance-${kind}-narrow.png` });
  button.click();
  await waitFor(() => s.submitInput.mock.calls.length === 2);
  await waitFor(() => !s.surface.querySelector('.flower-computer-control-heading'));
});

it('submits the canonical check answer without opening or capturing the page first', async () => {
  const s = await setup('captcha');
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
  s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="return"]')!.click();
  await waitFor(() => s.submitInput.mock.calls.length === 1);
  expect(s.submitInput).toHaveBeenCalledWith(expect.objectContaining({ answers: { computer_control: { choice_id: 'Return control to Flower' } } }));
  expect(s.setComputerViewer).not.toHaveBeenCalled();
  expect(document.querySelector('.flower-computer-stage')).toBeNull();
});

it('shows target loss from a workspace event without an open viewer and ignores stale or mismatched events', async () => {
  const s = await setup('captcha');
  const card = s.surface.querySelector('.flower-computer-control-heading')!.closest('section')!;
  const initialHint = card.querySelector('p')!.textContent;
  const unavailable = { thread_id: 'assistance-fixture', interaction_id: 'tool-input:step', target_id: 'browser-main', state: 'unavailable' as const, reason_code: 'target_closed', at_unix_ms: 100 };
  s.publishStatus(unavailable, 'another-thread');
  await new Promise(resolve => setTimeout(resolve, 20));
  s.publishStatus({ ...unavailable, interaction_id: 'old-interaction' });
  await new Promise(resolve => setTimeout(resolve, 20));
  s.publishStatus({ ...unavailable, target_id: 'another-target' });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(card.querySelector('p')!.textContent).toBe(initialHint);
  expect(card.querySelector('[data-computer-control-action="take"]')).not.toBeNull();

  s.publishStatus(unavailable);
  await waitFor(() => Boolean(card.querySelector('p')?.textContent?.includes('available targets')));
  expect(card.querySelector('[data-computer-control-action="take"]')).toBeNull();
  s.publishStatus({ ...unavailable, state: 'available', reason_code: undefined, at_unix_ms: 99 });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(card.querySelector('[data-computer-control-action="take"]')).toBeNull();
  s.publishStatus({ ...unavailable, state: 'available', reason_code: undefined, at_unix_ms: 101 });
  await waitFor(() => card.querySelector('[data-computer-control-action="take"]') !== null);
});


it('continues an existing full-access pause without granting the same operation again', async () => {
  const s = await setup('site', 'full_access');
  expect(s.surface.querySelector('.flower-computer-control-title')?.textContent).toBe('Full access is enabled');
  expect(s.surface.querySelector('[data-computer-control-action="grant"]')).toBeNull();
  expect(s.surface.querySelector('[data-computer-control-action="take"]')).toBeNull();
  const resume = s.surface.querySelector<HTMLButtonElement>('[data-computer-control-action="return"]')!;
  expect(resume.textContent).toBe('Continue task');
  resume.click(); resume.click();
  await waitFor(() => s.submitInput.mock.calls.length === 1);
  expect(s.loadAccess).not.toHaveBeenCalled();
  expect(s.saveAccess).not.toHaveBeenCalled();
});

it('keeps actual CAPTCHA instructions in full access mode', async () => {
  const s = await setup('captcha', 'full_access');
  expect(s.surface.querySelector('.flower-computer-control-title')?.textContent).toBe('Complete the CAPTCHA');
  expect(s.surface.querySelector('[data-computer-control-action="take"]')?.textContent).toBe('Open page');
  expect(s.submitInput).not.toHaveBeenCalled();
});


it('opens the system-browser connection guide and resumes the canonical request once without private control', async () => {
 const s = await setup('connection', 'full_access');
 const card = s.surface.querySelector('.flower-computer-control-heading')!.closest('section')!;
 expect(card.textContent).toContain('Connect your browser');
 expect(card.querySelector('[data-computer-control-action="take"]')).toBeNull();
 expect(card.querySelector('[data-computer-control-action="return"]')).toBeNull();
 const button = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(value => value.textContent === 'Connect your browser')!;
 button.click();
 await waitFor(() => s.submitInput.mock.calls.length === 1);
 expect(s.saveAccess).not.toHaveBeenCalled();
 expect(document.querySelector('.flower-computer-stage')).toBeNull();
});

it('closes the connection guide when its conversation changes during a connection check', async () => {
  const s = await setup('connection', 'full_access');
  const check = deferred<FlowerChromeStatus>();
  s.loadExtensionStatus.mockImplementationOnce(() => check.promise);
  const card = s.surface.querySelector('.flower-computer-control-heading')!.closest('section')!;
  Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find(value => value.textContent === 'Connect your browser')!.click();
  await waitFor(() => s.loadExtensionStatus.mock.calls.length === 1);
  s.surface.querySelector<HTMLButtonElement>('[data-thread-id="other-conversation"] .flower-thread-card-select-button')!.click();
  await waitFor(() => s.surface.querySelector('[data-thread-id="other-conversation"]')?.getAttribute('data-flower-thread-active') === 'true');
  await waitFor(() => !document.querySelector('[role="dialog"]'));
  check.resolve({ installations: [{ id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", kind: "google_chrome" as const, name: "Google Chrome", installed: true, prepared: true, connected: false }], profiles: [{ installation_id: "browser-aaaaaaaaaaaaaaaaaaaaaaaa", library_id: "chrome-library", id: 'personal', name: 'Personal' }] });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(s.submitInput).not.toHaveBeenCalled();
});

it('opens management without resuming a conversation that is waiting for Chrome', async () => {
  const s = await setup('connection', 'full_access');
  s.surface.querySelector<HTMLButtonElement>('button[aria-label="Browser and desktop"]')!.click();
  await new Promise(resolve => requestAnimationFrame(resolve));
  expect(document.querySelector('[data-flower-computer-panel="overview"]')).not.toBeNull();
  expect(s.loadExtensionStatus).not.toHaveBeenCalled();
  expect(s.submitInput).not.toHaveBeenCalled();
});

it('shows one installation action and continues only after the confirmed browser is installed', async () => {
  const s = await setup('installation', 'full_access');
  expect(s.surface.querySelector('[data-computer-control-action]')).toBeNull();
  const setupButton = [...s.surface.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Set up the built-in browser')!;
  setupButton.click();
  await waitFor(() => !!document.querySelector('[role="switch"]'));
  expect(s.installBrowser).not.toHaveBeenCalled();
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Download and install')!;
  confirm.click(); await waitFor(() => s.installBrowser.mock.calls.length === 1);
  expect(s.submitInput).not.toHaveBeenCalled();
  s.publishInstallation({ ...s.browser, state: 'installed', launch: { state: 'ready' as const } });
  await vi.waitFor(() => expect(s.submitInput).toHaveBeenCalledTimes(1), { timeout: 4000 });
  expect(JSON.stringify(s.submitInput.mock.calls)).toContain('Continue with installed browser');
});
it('never continues another conversation after an installation completes', async () => {
  const s = await setup('installation', 'full_access');
  [...s.surface.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Set up the built-in browser')!.click();
  await waitFor(() => !!document.querySelector('[role="switch"]'));
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Download and install')!.click();
  await waitFor(() => s.installBrowser.mock.calls.length === 1);
  expect(s.loadBrowserInstallation).toHaveBeenCalledTimes(1);
  s.surface.querySelector<HTMLButtonElement>('[data-thread-id="other-conversation"] .flower-thread-card-select-button')!.click();
  await waitFor(() => s.surface.querySelector('[data-thread-id="other-conversation"]')?.getAttribute('data-flower-thread-active') === 'true');
  expect(s.unsubscribeInstallation).toHaveBeenCalledTimes(1);
  // A queued notification must remain harmless even after unsubscription.
  s.publishInstallation({ ...s.browser, state: 'installed', launch: { state: 'ready' as const } });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(s.submitInput).not.toHaveBeenCalled();
});
