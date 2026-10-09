import '../index.css';
import '../ui/flower-feature.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { commands, page, userEvent } from 'vitest/browser';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { parseAskFlowerContextActionEnvelope } from '../../../../flower_ui/src/contextActionWire';
import { flowerTurnAdmissionError } from '../../../../flower_ui/src/flowerTurnAdmission';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TessivenFlowerPanel, type CanvasFlowerRequest } from '../../../../tessiven_ui/src/TessivenFlowerPanel';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { CanvasFlowerTestSurface, canvasFlowerAdapter } from './tessiven-flower.test-support';
import { liveBootstrap, thread } from '../ui/FlowerSurface.media.test-support';
import { inputRequest, liveBootstrap as interactionBootstrap, thread as interactionThread } from '../ui/FlowerSurface.navigation.testHarness';
import type { FlowerLiveStreamEnvelope, FlowerSurfaceAdapter } from '../../../../flower_ui/src';
beforeEach(async () => { await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('redeven-flower-transport'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); });
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.removeAttribute('style'); document.documentElement.classList.remove('dark', 'light'); });
function mount(transformed = false, overrides: Partial<FlowerSurfaceAdapter> = {}, graph = false, initialComposer = false) {
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = `position:absolute;left:30px;top:30px;width:1100px;height:700px;${transformed ? 'transform:scale(.8);transform-origin:top left;' : ''}`;
  document.body.append(host);
  const [request, setRequest] = createSignal<CanvasFlowerRequest>({
    selection: { canvas_id: 'commerce', version_id: 2, object_refs: ['orders'] }, labels: { orders: 'Orders API' }, nonce: 0,
  });
  const base = { ...canvasFlowerAdapter(), ...overrides };
  const sent = vi.fn(base.launchTurn);
  const queued: FlowerLiveStreamEnvelope[] = [];
  let wake = () => {};
  const connections = vi.fn();
  const adapter: FlowerSurfaceAdapter = { ...base, launchTurn: sent, connectLiveStream: async function* ({ signal }) {
    connections();
    yield { schema_version: 1, kind: 'ready', summaries: [] };
    while (!signal.aborted) {
      const value = queued.shift();
      if (value) { yield value; continue; }
      await new Promise<void>(resolve => { wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
    }
  } };
  const navigate = vi.fn();
  dispose = render(() => <FloeConfigProvider><LayoutProvider>
    {graph && <TessivenGraph t={tessivenText('en-US')} historical={false} onAsk={() => {}} onInspect={() => {}}
      version={{ canvas_id: 'commerce', number: 2, created_at: 1, digest: 'fixture', document_yaml: '', source: 'flower', summary: '',
        document: { apiVersion: 'redeven.io/tessiven/v1', kind: 'ServiceCanvas', metadata: { title: 'Commerce / Production' },
          nodes: [{ id: 'core', name: 'production-01', runtimeRef: 'local:local' }],
          groups: [{ id: 'app', name: 'Application', nodeRefs: ['core'] }],
          services: [{ id: 'orders', name: 'Orders API', kind: 'api' }, { id: 'storefront', name: 'Storefront', kind: 'web' }],
          instances: [{ id: 'orders-01', nodeRef: 'core', serviceRef: 'orders', role: 'standalone' }, { id: 'web-01', nodeRef: 'core', serviceRef: 'storefront', role: 'standalone' }],
          resources: [{ id: 'db', name: 'Orders database', kind: 'database', endpoint: 'postgresql://orders/commerce' }, { id: 'cdn', name: 'Content delivery', kind: 'cdn' }],
          relations: [{ id: 'read', from: 'orders', to: 'db', kind: 'reads', evidenceRefs: ['config'] }, { id: 'route', from: 'cdn', to: 'storefront', kind: 'forwards', evidenceRefs: ['config'] }],
          evidence: [{ id: 'config', source: 'configuration', locator: 'repo://commerce/config.yaml', summary: 'Test configuration' }],
          presentation: { initiallyExpanded: ['app'] },
        } }} />}
    <TessivenFlowerPanel
    request={request()} visible initialComposer={initialComposer} t={tessivenText('en-US')} onOpenConversation={navigate}
    onRemoveReference={id => setRequest(previous => ({ ...previous, selection: {
      ...previous.selection, object_refs: previous.selection.object_refs.filter(ref => ref !== id),
    } }))}
    renderSurface={surface => <CanvasFlowerTestSurface {...surface} adapter={adapter} />}
  /></LayoutProvider></FloeConfigProvider>, host);
  return { setRequest, sent, connections, navigate, push: (event: FlowerLiveStreamEnvelope) => { queued.push(event); wake(); } };
}
const editor = () => page.getByRole('textbox');
const replyMenu = () => page.getByRole('button', { name: 'Reply actions', exact: true });
const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
const expectConversationAction = async (available: boolean) => {
  await replyMenu().click();
  const action = page.getByRole('menuitem', { name: 'Open conversation', exact: true });
  if (available) await expect.element(action).toBeVisible();
  else await expect.element(action).not.toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
};
it('paints the canonical rounded input outline in the conversation window', async () => {
  await page.viewport(1200, 800);
  mount();
  await expect.element(editor()).toBeVisible();
  const composer = document.querySelector<HTMLElement>('.tessiven-flower-output .flower-composer')!;
  expect(parseFloat(getComputedStyle(composer).borderTopWidth)).toBe(1);
  expect(parseFloat(getComputedStyle(composer).borderRadius)).toBeGreaterThanOrEqual(8);
  expect(composer.getBoundingClientRect().height).toBeGreaterThanOrEqual(84);
});

it('keeps long questions scrollable with all reply controls inside a short canvas window', async () => {
  await page.viewport(800, 320);
  const runtime = mount(false, {}, true);
  host.style.cssText = 'position:absolute;inset:0;width:800px;height:320px';
  await expect.element(editor()).toBeVisible();
  await editor().fill('Help with this architecture');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  const current = interactionBootstrap(interactionThread({ thread_id: 'canvas-thread', status: 'waiting_user',
    input_request: inputRequest({ questions: [{ id: 'next', header: 'Next Step', question: 'What would you like me to do with the selected Hadoop canvas (version 4)?', response_mode: 'select_or_write', write_label: 'Describe your own request',
      choices: [
        { choice_id: 'explain', value: 'explain', label: 'Walk me through the current architecture', description: 'Explain the layers, services, instances and key relationships of version 4 as saved.', kind: 'select' },
        { choice_id: 'change', value: 'change', label: 'Change the canvas', description: 'Add, remove or reorganize nodes, services, instances or relations, saved as a new version.', kind: 'select' },
        { choice_id: 'history', value: 'history', label: 'Show version history', description: 'List saved versions and summarize what changed across them.', kind: 'select' },
        { choice_id: 'runtime', value: 'runtime', label: 'Map it to a real environment', description: 'Inspect an explicitly connected Runtime and record observed services instead of the conceptual reference.', kind: 'select' },
      ] }] }),
  }), 2).current;
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current });
  await expect.element(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  const output = document.querySelector<HTMLElement>('.tessiven-flower-output')!;
  const content = output.querySelector<HTMLElement>('[data-floe-floating-window-content]')!;
  const questions = output.querySelector<HTMLElement>('.flower-input-request-questions')!;
  expect(getComputedStyle(output.querySelector('.flower-input-request-actions')!).borderTopWidth).toBe('0px');
  expect(getComputedStyle(questions).maskImage).toContain('linear-gradient');
  for (const preset of builtInShellThemePresets) {
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    for (const [token, value] of Object.entries(preset.semanticTokens ?? {}))
      if (value) document.documentElement.style.setProperty(token, value);
    for (const [width, height] of [[800, 320], [320, 320], [320, 170]]) {
      await page.viewport(width, 320);
      host.style.width = `${width}px`; host.style.height = `${height}px`;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (const button of output.querySelectorAll('.flower-input-request-actions button')) {
        const rect = button.getBoundingClientRect();
        expect(rect.bottom).toBeLessThanOrEqual(content.getBoundingClientRect().bottom - 8);
        expect(rect.right).toBeLessThanOrEqual(content.getBoundingClientRect().right - 8);
      }
      expect(questions.clientHeight).toBeGreaterThan(24);
      expect(questions.scrollHeight).toBeGreaterThan(questions.clientHeight);
      expect(questions.scrollWidth).toBeLessThanOrEqual(questions.clientWidth);
      questions.scrollTop = 0;
      await page.screenshot({ path: `__screenshots__/tessiven-short-question-${preset.name}-${width}-${height}.png` });
      questions.scrollTop = questions.scrollHeight;
      await expect.poll(() => questions.scrollTop).toBeGreaterThan(0);
      const lastChoice = questions.querySelector<HTMLElement>('.flower-input-request-choice-custom')!;
      expect(lastChoice.getBoundingClientRect().bottom).toBeLessThanOrEqual(questions.getBoundingClientRect().bottom - 15);
    }
  }
  await page.getByText('Map it to a real environment', { exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
  const touch = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
  try {
    await touch.emulateTouchInput(true);
    for (const button of output.querySelectorAll('.flower-input-request-actions button'))
      expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(content.getBoundingClientRect().bottom - 8);
    host.style.height = '320px';
    await page.getByText('Describe your own request', { exact: true }).click();
    await editor().fill('Arrange the architecture horizontally.\n'.repeat(20));
    for (const button of output.querySelectorAll('.flower-input-request-actions button')) {
      const rect = button.getBoundingClientRect();
      expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.bottom).toBeLessThanOrEqual(content.getBoundingClientRect().bottom - 8);
    }
    await page.screenshot({ path: '__screenshots__/tessiven-short-question-touch-custom.png' });
  } finally { await touch.emulateTouchInput(false); }
});

it('keeps a long ordinary draft and its send action inside a short window', async () => {
  await page.viewport(800, 320);
  mount();
  host.style.cssText = 'position:absolute;inset:0;width:800px;height:320px';
  await editor().fill('Explain all service relationships.\n'.repeat(40));
  const content = document.querySelector<HTMLElement>('.tessiven-flower-output [data-floe-floating-window-content]')!;
  const textarea = content.querySelector<HTMLTextAreaElement>('textarea')!;
  await expect.poll(() => textarea.scrollHeight).toBeGreaterThan(textarea.clientHeight);
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect.element(send).toBeEnabled();
  for (const [width, height] of [[800, 320], [800, 240], [320, 240]]) {
    await page.viewport(width, height);
    host.style.width = `${width}px`; host.style.height = `${height}px`;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(document.querySelector('.tessiven-flower-output .flower-composer-footer')!.getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(content.getBoundingClientRect().bottom - 8);
    expect(textarea.clientHeight).toBeGreaterThanOrEqual(24);
  }
  await page.screenshot({ path: '__screenshots__/tessiven-short-long-draft.png' });
});

it('keeps a large approval queue scrollable inside a short narrow window', async () => {
  await page.viewport(320, 320);
  const runtime = mount();
  host.style.cssText = 'position:absolute;inset:0;width:320px;height:320px';
  await editor().fill('Inspect the deployment');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: interactionBootstrap(interactionThread({
    thread_id: 'canvas-thread', status: 'waiting_approval', approval_actions: Array.from({ length: 10 }, (_, index) => ({
      action_id: `approval-${index}`, turn_id: 'turn', origin: 'main_tool', run_id: 'run', tool_id: `tool-${index}`, tool_name: 'terminal.exec',
      state: 'requested', status: 'pending', requested_at_ms: 1, can_approve: true, queue_order: index,
      summary: { label: `Inspect deployment service ${index + 1}`, command: 'systemctl status service' },
    })),
  }), 2).current });
  await expect.poll(() => document.querySelector('.tessiven-flower-output .flower-approval-queue-footer')).not.toBeNull();
  const content = document.querySelector<HTMLElement>('.tessiven-flower-output [data-floe-floating-window-content]')!;
  for (const button of content.querySelectorAll('.flower-approval-queue-footer button'))
    expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(content.getBoundingClientRect().bottom - 8);
  const list = content.querySelector<HTMLElement>('.flower-approval-queue-list')!;
  expect(list.clientHeight).toBeGreaterThan(30);
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  list.scrollTop = list.scrollHeight;
  await expect.poll(() => list.scrollTop).toBeGreaterThan(0);
  await page.screenshot({ path: '__screenshots__/tessiven-short-approvals.png' });
});

it('shows only the initial composer on a fresh canvas, then moves it into the reply window after sending', async () => {
  await page.viewport(1200, 800);
  const runtime = mount(false, {}, false, true);
  await expect.element(editor()).toBeVisible();
  expect(host.querySelector('.tessiven-flower-output')).toBeNull();
  const initial = host.querySelector<HTMLElement>('.tessiven-flower-composer')!;
  expect(initial.classList.contains('tessiven-flower-composer--initial')).toBe(true);
  expect(initial.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.getBoundingClientRect().bottom);
  await page.screenshot({ path: '__screenshots__/tessiven-new-canvas-initial-composer.png' });
  await editor().fill('Create a service architecture');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  const output = document.querySelector<HTMLElement>('.tessiven-flower-output')!;
  await expect.poll(() => document.querySelector('.tessiven-flower-output .tessiven-flower-composer textarea')).not.toBeNull();
  expect(output.classList.contains('tessiven-flower-output--entering')).toBe(true);
  expect(getComputedStyle(output).animationDuration).toBe('0.26s');
  await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  expect(getComputedStyle(output).animationName).toBe('none');
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  expect(document.querySelectorAll('.flower-composer textarea')).toHaveLength(1);
  expect(output.querySelector('.tessiven-flower-composer--initial')).toBeNull();
  expect(output.querySelector('[data-floe-floating-window-titlebar]')).not.toBeNull();
  expect(output.getBoundingClientRect().width).toBe(356);
  await page.screenshot({ path: '__screenshots__/tessiven-new-canvas-chat-window.png' });
});
it('keeps a quiet reply titlebar with secondary actions in an accessible menu', async () => {
  await page.viewport(1200, 800);
  const runtime = mount();
  await expect.element(editor()).toBeVisible();
  const titlebar = document.querySelector<HTMLElement>('.tessiven-flower-output [data-floe-floating-window-titlebar]')!;
  expect(titlebar.querySelectorAll('button, [role="button"]').length).toBeGreaterThanOrEqual(3);
  expect(titlebar.querySelector('h2')?.textContent).toBe('Flower');
  expect(titlebar.querySelector('h2 svg')).not.toBeNull();
  expect(titlebar.getBoundingClientRect().height).toBe(43);
  expect(document.querySelector('.tessiven-flower-output')!.getBoundingClientRect().width).toBe(356);
  await expect.element(page.getByRole('button', { name: 'Reply actions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reply actions', exact: true }).click();
  await expect.element(page.getByRole('menuitem', { name: 'New conversation', exact: true })).toBeVisible();
  await expect.element(page.getByRole('menuitem', { name: 'Flower settings', exact: true })).toBeVisible();
  expect(document.querySelector('[role="menu"]')?.closest('[data-floe-surface="floating"]')).not.toBeNull();
  await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('menuitem');
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('[role="menu"]')?.getAttribute('data-floating-presence')).not.toBe('open');
  expect(document.querySelector('.tessiven-flower-output')).not.toBeNull();
  await editor().fill('Open a conversation');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  await expect.poll(() => document.querySelector<HTMLElement>('[data-flower-selected-thread-id]')?.dataset.flowerSelectedThreadId).toBe('canvas-thread');
  await page.getByRole('button', { name: 'Reply actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Open conversation', exact: true }).click();
  expect(runtime.navigate).toHaveBeenCalledWith('canvas-thread');
  await page.getByRole('button', { name: 'Reply actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New conversation', exact: true }).click();
  await editor().fill('A separate conversation');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(2);
  expect(runtime.sent.mock.calls[1][0].thread_id).toBeUndefined();
});
it('keeps the whole canvas implicit in a clean default composer', async () => {
  await page.viewport(1200, 800);
  const runtime = mount();
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 2, object_refs: [] }, labels: {}, nonce: 0 });
  await expect.element(editor()).toBeVisible();
  expect(document.querySelector('.flower-composer-context-references')).toBeNull();
  await editor().fill('Draw the architecture');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  expect(runtime.sent.mock.calls[0][0].context_action).toMatchObject({ context: [
    { kind: 'tessiven_selection', canvas_id: 'commerce', version_id: 2, object_refs: [] },
  ] });
});

it('places small object references side by side and removes their actual context while preserving the draft', async () => {
  await page.viewport(1200, 800);
  const runtime = mount(false, {}, true);
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 2, object_refs: ['orders', 'db'] },
    labels: { orders: 'Orders API', db: 'Orders database' }, nonce: 1 });
  await expect.element(editor()).toBeVisible();
  await editor().fill('Keep this question');
  const chips = [...document.querySelectorAll<HTMLElement>('.flower-composer-context-reference')];
  expect(chips).toHaveLength(2);
  expect(chips[0].getBoundingClientRect().top).toBe(chips[1].getBoundingClientRect().top);
  expect(chips[0].getBoundingClientRect().height).toBeLessThanOrEqual(24);
  expect(parseFloat(getComputedStyle(chips[0].querySelector('.flower-composer-context-label')!).fontSize)).toBeLessThanOrEqual(11);
  await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(1);
  await page.screenshot({ element: host, path: '__screenshots__/tessiven-reference-chips.png' });
  await page.getByRole('button', { name: 'Remove reference Orders API', exact: true }).click();
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Remove reference Orders database');
  await expect.element(editor()).toHaveValue('Keep this question');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  expect(runtime.sent.mock.calls[0][0].context_action).toMatchObject({ context: [
    { kind: 'tessiven_selection', canvas_id: 'commerce', version_id: 2, object_refs: ['db'] },
  ] });
  await page.getByRole('button', { name: 'Remove reference Orders database', exact: true }).click();
  expect(document.querySelector('.flower-composer-context-references')).toBeNull();
  await expect.poll(() => document.activeElement === document.querySelector('.flower-composer textarea')).toBe(true);
});

it('keeps the canonical composer inside the same floating window as conversation output', async () => {
  await page.viewport(1200, 800);
  const runtime = mount();
  await expect.element(editor()).toBeVisible();
  const references = document.querySelector('.flower-composer-context-references');
  expect(references?.textContent).toBe('Orders API');
  expect(references?.querySelector('[title]')?.getAttribute('title')).toContain('Version 2');
  expect(document.querySelector('.flower-composer textarea')?.getAttribute('placeholder')).toBe('');
  await editor().fill('Explain the database connection');
  await expect.element(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  expect(runtime.sent.mock.calls[0][0].context_action).toMatchObject({ context: [{ kind: 'tessiven_selection', canvas_id: 'commerce', version_id: 2, object_refs: ['orders'] }] });
  const reply = liveBootstrap(thread({ thread_id: 'canvas-thread', messages: [{ id: 'reply', turn_id: 'turn', role: 'assistant', content: 'Orders reads from the primary database.', status: 'complete', created_at_ms: 2 }] }), 2);
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: reply.current });
  await expect.element(page.getByText('Orders reads from the primary database.')).toBeVisible();
  expect(runtime.navigate).not.toHaveBeenCalled();
  expect(runtime.connections).toHaveBeenCalledTimes(1);
  const output = document.querySelector('[data-floe-geometry-surface="floating-window"]')!.getBoundingClientRect();
  const input = document.querySelector('.tessiven-flower-composer')!.getBoundingClientRect();
  expect(output.left).toBeLessThan(60);
  expect(output.top).toBeLessThan(70);
  expect(input.top).toBeGreaterThan(output.top);
  expect(input.bottom - output.bottom).toBeLessThanOrEqual(1);
  expect(document.querySelector('.tessiven-flower-output .tessiven-flower-composer')).not.toBeNull();
  expect(document.querySelectorAll('.tessiven-flower-output textarea')).toHaveLength(1);
  expect(document.querySelectorAll('.flower-composer textarea')).toHaveLength(1);
  await page.screenshot({ element: host, path: '__screenshots__/tessiven-floating-conversation.png' });
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await expect.poll(() => document.querySelector('.flower-composer textarea')?.checkVisibility() ?? false).toBe(false);
  expect(document.querySelector('[data-flower-transcript-visible]')?.getAttribute('data-flower-transcript-visible')).toBe('false');
  await page.getByRole('button', { name: 'Show replies', exact: true }).click();
  await expect.element(editor()).toBeVisible();
  await editor().fill('Keep this draft');
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await expect.poll(() => document.querySelector('.flower-composer textarea')?.checkVisibility() ?? false).toBe(false);
  await page.getByRole('button', { name: 'Show replies', exact: true }).click();
  await expect.element(editor()).toHaveValue('Keep this draft');
  await expect.element(page.getByText('Orders reads from the primary database.')).toBeVisible();
});
it('keeps drafts isolated by canvas and a single workspace connection while retargeting objects', async () => {
  await page.viewport(1200, 800);
  const runtime = mount();
  await expect.element(editor()).toBeVisible();
  await editor().fill('Commerce draft');
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, labels: {}, nonce: 1 });
  await expect.element(editor()).toHaveValue('');
  expect(document.querySelector('.flower-composer-context-references')).toBeNull();
  await editor().fill('Analytics draft');
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 1, object_refs: ['db'] }, labels: { db: 'Database' }, nonce: 2 });
  await expect.element(editor()).toHaveValue('Commerce draft');
  expect(document.querySelector('.flower-composer-context-references')?.textContent).toContain('Database');
  expect(document.querySelector('.flower-composer-context-source')?.getAttribute('title')).toContain('Version 1');
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 3, object_refs: ['db'] }, labels: { db: 'Database' }, nonce: 2 });
  await expect.element(editor()).toHaveValue('Commerce draft');
  expect(document.querySelector('.flower-composer-context-source')?.getAttribute('title')).toContain('Version 3');
  expect(runtime.sent).not.toHaveBeenCalled();
  expect(runtime.connections).toHaveBeenCalledTimes(1);
});
it('uses the shared local floating layer inside a projected canvas', async () => {
  await page.viewport(1200, 800);
  mount(true);
  await expect.element(editor()).toBeVisible();
  await expect.poll(() => document.querySelector('[data-floe-geometry-surface="floating-window"]')?.getBoundingClientRect().width).toBeGreaterThan(0);
  const output = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
  expect(output.style.position).not.toBe('fixed');
  expect(output.getAttribute('data-floe-local-interaction-surface')).toBe('true');
  const bounds = host.getBoundingClientRect(), rect = output.getBoundingClientRect();
  await expect.poll(() => output.getBoundingClientRect().left).toBeGreaterThanOrEqual(bounds.left);
  expect(rect.right).toBeLessThanOrEqual(bounds.right);
});

it('opens native subagent and settings surfaces from the projected reply menu', async () => {
  await page.viewport(1200, 800);
  mount(true);
  await expect.element(editor()).toBeVisible();
  await replyMenu().click();
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  expect(menu.closest('[data-floe-local-interaction-surface]')).not.toBeNull();
  expect(menu.style.position).not.toBe('fixed');
  const bounds = host.getBoundingClientRect();
  const rect = menu.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
  expect(rect.right).toBeLessThanOrEqual(bounds.right);
  await page.getByRole('menuitem', { name: 'Open subagents', exact: true }).click();
  await expect.element(page.getByRole('dialog', { name: 'Subagents', exact: true })).toBeVisible();
  const subagents = document.querySelector('.flower-subagents-dropdown')!;
  expect(subagents.closest('[data-floe-local-interaction-surface]')).not.toBeNull();
  await expect.poll(() => document.activeElement === subagents).toBe(true);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.flower-subagents-dropdown')).toBeNull();
  expect(document.querySelector('.tessiven-flower-output')).not.toBeNull();
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('Reply actions');
  await replyMenu().click();
  await page.getByRole('menuitem', { name: 'Flower settings', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Back to chat', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
  await expect.element(editor()).toBeVisible();
});

it('moves and resizes the conversation and composer together without selecting canvas text', async () => {
  await page.viewport(1200, 800);
  mount();
  await expect.element(editor()).toBeVisible();
  const output = () => document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]')!;
  await expect.poll(() => output().getBoundingClientRect().left).toBeGreaterThan(30);
  const initial = output().getBoundingClientRect();
  const composer = document.querySelector('.tessiven-flower-composer')!.getBoundingClientRect();
  expect(composer.left).toBeGreaterThanOrEqual(initial.left);
  expect(composer.right).toBeLessThanOrEqual(initial.right);
  await (commands as unknown as { moveTessivenReplies: (resize: boolean) => Promise<void> }).moveTessivenReplies(false);
  await expect.poll(() => output().getBoundingClientRect().left).toBeGreaterThan(initial.left + 100);
  const moved = output().getBoundingClientRect();
  const movedComposer = document.querySelector('.tessiven-flower-composer')!.getBoundingClientRect();
  expect(movedComposer.left - composer.left).toBeGreaterThan(100);
  await (commands as unknown as { moveTessivenReplies: (resize: boolean) => Promise<void> }).moveTessivenReplies(true);
  await expect.poll(() => output().getBoundingClientRect().width).toBeGreaterThan(moved.width + 60);
  expect(output().getBoundingClientRect().height).toBeLessThan(moved.height);
  expect(window.getSelection()?.toString()).toBe('');
  expect(document.querySelector('.tessiven-flower-composer')!.getBoundingClientRect().width).toBeGreaterThan(movedComposer.width);
});

it('preserves native tool disclosure and live progress in the refined reading surface', async () => {
  await page.viewport(1200, 800);
  const runtime = mount(false, {}, true);
  await expect.element(editor()).toBeVisible();
  await editor().fill('Arrange the service architecture horizontally');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  const input = runtime.sent.mock.calls[0][0];
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: {
    thread_id: 'canvas-thread', view_version: 2, activity: 'active', turn_id: 'turn', run_id: 'run',
    run_progress: { phase: 'tool_execution' }, queue: [], interactions: [], items: [
      { id: `user:${input.client_request_id}`, turn_id: 'turn', run_id: 'run', ordinal: 1, kind: 'user', text: input.prompt },
      { id: 'reply', turn_id: 'turn', run_id: 'run', ordinal: 2, kind: 'assistant', text: 'I will read the selected canvas and its schema first.' },
      { id: 'canvas-read', turn_id: 'turn', run_id: 'run', ordinal: 3, kind: 'tool', activity: {
        item_id: 'canvas-read', tool_id: 'canvas-read', tool_name: 'terminal.exec', kind: 'tool', status: 'success',
        severity: 'normal', needs_attention: false, requires_approval: false,
        presentation: { label: 'tessiven schema', renderer: 'terminal', payload: {
          operation: 'execute', command: 'tessiven schema', output: 'ServiceCanvas schema loaded', exit_code: 0,
        } },
      } },
    ],
  } });
  const row = () => document.querySelector<HTMLElement>('.tessiven-flower-output [data-flower-activity-item-id="canvas-read"]');
  await expect.poll(row).not.toBeNull();
  await expect.poll(() => document.querySelector('.tessiven-flower-output .flower-model-status-indicator')?.textContent).toContain('Using a tool');
  const disclosure = row()!.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  disclosure.click();
  await expect.poll(() => disclosure.getAttribute('aria-expanded')).toBe('true');
  await expect.element(page.getByText('ServiceCanvas schema loaded', { exact: true })).toBeVisible();
  disclosure.click();
  for (const name of ['porcelain-light', 'porcelain-dark']) {
    const preset = builtInShellThemePresets.find(item => item.name === name)!;
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    for (const [token, value] of Object.entries(preset.semanticTokens ?? {}))
      if (value) document.documentElement.style.setProperty(token, value);
    await page.screenshot({ element: host, path: `__screenshots__/tessiven-reply-activity-${name}.png` });
  }
});

it('keeps touch controls usable and the reading surface legible in forced colors', async () => {
  const media = commands as unknown as {
    emulateTouchInput: (enabled: boolean) => Promise<void>;
    emulateMediaPreferences: (preferences: { forcedColors: 'active' | 'none' }) => Promise<void>;
  };
  await page.viewport(1200, 844);
  try {
    await media.emulateTouchInput(true);
    mount();
    host.style.cssText = 'position:absolute;inset:0;width:1100px;height:844px';
    await expect.element(editor()).toBeVisible();
    await expect.poll(() => matchMedia('(pointer: coarse)').matches).toBe(true);
    await expect.element(replyMenu()).toBeVisible();
    const titlebar = document.querySelector<HTMLElement>('.tessiven-flower-output [data-floe-floating-window-titlebar]')!;
    for (const control of titlebar.querySelectorAll('button, [role="button"]')) {
      expect(control.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await replyMenu().click();
    await expect.element(page.getByRole('menuitem', { name: 'New conversation', exact: true })).toBeVisible();
    await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('menuitem');
    await userEvent.keyboard('{Escape}');
    await page.screenshot({ element: host, path: '__screenshots__/tessiven-reply-touch.png' });
    await media.emulateMediaPreferences({ forcedColors: 'active' });
    await expect.element(replyMenu()).toBeVisible();
    const output = document.querySelector<HTMLElement>('.tessiven-flower-output')!;
    expect(getComputedStyle(output).color).not.toBe(getComputedStyle(output).backgroundColor);
    await page.screenshot({ element: host, path: '__screenshots__/tessiven-reply-forced-colors.png' });
  } finally {
    await media.emulateTouchInput(false);
    await media.emulateMediaPreferences({ forcedColors: 'none' });
  }
});

it('keeps late acceptance bound to its original canvas and resumes the accepted conversation', async () => {
  await page.viewport(1200, 800);
  let accept!: (value: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  const runtime = mount(false, { launchTurn: () => new Promise(resolve => { accept = resolve; }) });
  await expect.element(editor()).toBeVisible();
  await editor().fill('Inspect commerce');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, labels: {}, nonce: 1 });
  await editor().fill('Unsaved analytics draft');
  accept(await canvasFlowerAdapter().launchTurn(runtime.sent.mock.calls[0][0]));
  await expect.element(editor()).toHaveValue('Unsaved analytics draft');
  await expectConversationAction(false);
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 2, object_refs: [] }, labels: {}, nonce: 2 });
  await expectConversationAction(true);
  await expect.element(editor()).toHaveValue('');
  await editor().fill('Continue commerce');
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, labels: {}, nonce: 3 });
  await expect.element(editor()).toHaveValue('Unsaved analytics draft');
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 2, object_refs: [] }, labels: {}, nonce: 4 });
  await expect.element(editor()).toHaveValue('Continue commerce');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(2);
  expect(runtime.sent.mock.calls[1][0].thread_id).toBe('canvas-thread');
  expect(runtime.connections).toHaveBeenCalledTimes(1);
});

it('reopens replies on send and does not reopen an older conversation after starting a new one', async () => {
  await page.viewport(1200, 800);
  let accept!: (value: Awaited<ReturnType<FlowerSurfaceAdapter['launchTurn']>>) => void;
  const runtime = mount(false, { launchTurn: () => new Promise(resolve => { accept = resolve; }) });
  await expect.element(editor()).toBeVisible();
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await expect.poll(() => document.querySelector('.flower-composer textarea')?.checkVisibility() ?? false).toBe(false);
  await page.getByRole('button', { name: 'Show replies', exact: true }).click();
  await expect.element(editor()).toBeVisible();
  await editor().fill('Inspect commerce');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  await expect.element(page.getByRole('button', { name: 'Hide replies', exact: true })).toBeVisible();
  await replyMenu().click();
  await page.getByRole('menuitem', { name: 'New conversation', exact: true }).click();
  await editor().fill('A separate question');
  accept(await canvasFlowerAdapter().launchTurn(runtime.sent.mock.calls[0][0]));
  await expect.element(editor()).toHaveValue('A separate question');
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 1, object_refs: [] }, labels: {}, nonce: 1 });
  runtime.setRequest({ selection: { canvas_id: 'commerce', version_id: 2, object_refs: [] }, labels: {}, nonce: 2 });
  await expect.element(editor()).toHaveValue('A separate question');
  await expectConversationAction(false);
});

it('retries an uncertain send with its original canvas identity after the selection changes', async () => {
  await page.viewport(1200, 800);
  let attempts = 0;
  let fail!: (cause: Error) => void;
  const runtime = mount(false, { launchTurn: async input => {
    if (++attempts === 1) await new Promise<never>((_resolve, reject) => { fail = reject; });
    return canvasFlowerAdapter().launchTurn(input);
  } });
  await expect.element(editor()).toBeVisible();
  await editor().fill('Explain Orders');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  runtime.setRequest({ selection: { canvas_id: 'analytics', version_id: 7, object_refs: ['cache'] }, labels: { cache: 'Analytics cache' }, nonce: 1 });
  await editor().fill('Separate draft');
  fail(flowerTurnAdmissionError('unknown', new Error('Test response lost')));
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(2);
  expect(runtime.sent.mock.calls[1][0]).toEqual(runtime.sent.mock.calls[0][0]);
  await expect.element(editor()).toHaveValue('Separate draft');
});

it('keeps reply text, context and controls legible across every theme and clamps narrow layouts', async () => {
  await page.viewport(1440, 920);
  const runtime = mount(false, {}, true);
  host.style.width = '1380px'; host.style.height = '850px';
  await expect.element(editor()).toBeVisible();
  await editor().fill('Explain the service distribution');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  const reply = liveBootstrap(thread({ thread_id: 'canvas-thread', messages: [{ id: 'reply', turn_id: 'turn', role: 'assistant',
    content: 'Storefront and Orders API run on **production-01**.\n\nOrders API reads from the external **Orders database**. Content delivery forwards requests to Storefront.\n\nThe canvas preserves this distinction: the dashed area is a logical group; the solid card is the host node.', status: 'complete', created_at_ms: 2 }] }), 2);
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: reply.current });
  await expect.element(page.getByText('Storefront and Orders API run on', { exact: false })).toBeVisible();
  expect(host.querySelector('.tessiven-flower-context')).toBeNull();
  const luminance = (color: string) => {
    const ctx = document.createElement('canvas').getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
    const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const output = document.querySelector<HTMLElement>('.tessiven-flower-output')!;
  const paintedSurface = (element: Element): string => {
    for (let current: Element | null = element; current; current = current.parentElement) {
      const background = getComputedStyle(current).backgroundColor;
      if (background !== 'rgba(0, 0, 0, 0)') return background;
    }
    throw new Error('Conversation surface has no opaque background');
  };
  for (const preset of builtInShellThemePresets) {
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(name, value);
    const surface = paintedSurface(output);
    for (const selector of ['[data-floe-floating-window-titlebar]', '.flower-chat-transcript', '.flower-chat-bottom-dock'])
      expect(paintedSurface(output.querySelector(selector)!), `${preset.name}: continuous ${selector} background`).toBe(surface);
    expect(paintedSurface(output.querySelector('.flower-composer')!), `${preset.name}: distinct input fill`).not.toBe(surface);
    for (const [selector, background, minimum] of [
      ['.tessiven-flower-output h2', '.tessiven-flower-output', 4.5],
      ['.tessiven-flower-output .flower-chat-transcript', '.tessiven-flower-output', 4.5],
      ['.tessiven-flower-output .tessiven-icon-button', '.tessiven-flower-output', 3],
    ] as const) {
      const a = luminance(getComputedStyle(document.querySelector(selector)!).color);
      const b = luminance(getComputedStyle(document.querySelector(background)!).backgroundColor);
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${preset.name}: ${selector}`).toBeGreaterThanOrEqual(minimum);
    }
    await page.screenshot({ element: output, path: `__screenshots__/tessiven-floating-${preset.name}.png` });
    await page.viewport(320, 240); host.style.cssText = 'position:absolute;inset:0;width:320px;height:240px';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const content = output.querySelector('[data-floe-floating-window-content]')!;
    const transcript = output.querySelector<HTMLElement>('.flower-chat-transcript')!;
    expect(transcript.scrollHeight).toBeGreaterThan(transcript.clientHeight);
    expect(output.querySelector('.flower-composer-footer')!.getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(content.getBoundingClientRect().bottom - 8);
    await page.screenshot({ element: output, path: `__screenshots__/tessiven-floating-short-${preset.name}.png` });
    await page.viewport(1440, 920); host.style.cssText = 'position:absolute;left:30px;top:30px;width:1380px;height:850px';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  await page.viewport(390, 844); host.style.cssText = 'position:absolute;inset:0;width:390px;height:844px';
  await expect.poll(() => document.querySelector('.tessiven-flower-output')!.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  await expect.poll(() => document.querySelector('.tessiven-flower-output')!.getBoundingClientRect().bottom - document.querySelector('.tessiven-flower-composer')!.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(0);
  const input = document.querySelector('.tessiven-flower-composer')!.getBoundingClientRect();
  expect(input.right).toBeLessThanOrEqual(390);
  expect(input.bottom).toBeLessThanOrEqual(844);
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await expect.poll(() => document.querySelector('.flower-composer textarea')?.checkVisibility() ?? false).toBe(false);
});

it('sends native file references alongside the exact canvas selection', async () => {
  await page.viewport(1200, 800);
  const runtime = mount(false, {
    getWorkingDirectoryPathContext: async () => ({ agentHomePathAbs: '/workspace', homePathAbs: '/workspace', defaultRootId: 'workspace', roots: [
      { id: 'workspace', label: 'Workspace', pathAbs: '/workspace', kind: 'workspace', permissions: { read: true, write: true } },
    ] }),
    listWorkingDirectoryEntries: async () => [{ name: 'orders.ts', path: '/workspace/orders.ts', isDirectory: false, modifiedAt: 1 }],
  });
  await expect.element(editor()).toBeVisible();
  await editor().click(); await userEvent.keyboard('@');
  await page.getByRole('option', { name: /orders.ts/ }).click();
  await editor().fill('Use this code to explain Orders');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => runtime.sent.mock.calls.length).toBe(1);
  const context = parseAskFlowerContextActionEnvelope(runtime.sent.mock.calls[0][0].context_action);
  expect(context?.context).toEqual([
    { kind: 'tessiven_selection', canvas_id: 'commerce', version_id: 2, object_refs: ['orders'] },
    { kind: 'file_path', path: '/workspace/orders.ts', is_directory: false },
  ]);
});

it('keeps native approval controls inside the same conversation window', async () => {
  await page.viewport(1200, 800);
  const submitApproval = vi.fn(async () => ({ ok: true, current: liveBootstrap(thread({ thread_id: 'canvas-thread' }), 4).current }));
  const runtime = mount(false, { submitApproval });
  await expect.element(editor()).toBeVisible();
  await editor().fill('Inspect Orders');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expectConversationAction(true);
  runtime.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'canvas-thread', current: {
    thread_id: 'canvas-thread', view_version: 3, activity: 'active', turn_id: 'turn', run_id: 'run', queue: [], items: [],
    interactions: [{ id: 'approval-1', turn_id: 'turn', run_id: 'run', kind: 'approval', tool_call_id: 'tool-1',
      approval: { label: 'Inspect service configuration', command: 'cat /workspace/orders.yaml', tool_name: 'terminal.exec', tool_call_id: 'tool-1' } }],
  } });
  await expect.element(page.getByRole('button', { name: 'Approve Inspect service configuration', exact: true })).toBeVisible();
  const composer = document.querySelector('.tessiven-flower-output .tessiven-flower-composer')!;
  expect(composer.textContent).toContain('Inspect service configuration');
  expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(document.querySelector('.tessiven-flower-output')!.getBoundingClientRect().bottom);
  await page.getByRole('button', { name: 'Approve Inspect service configuration', exact: true }).click();
  expect(submitApproval).toHaveBeenCalledWith({ thread_id: 'canvas-thread', interaction_id: 'approval-1', approved: true });
});
