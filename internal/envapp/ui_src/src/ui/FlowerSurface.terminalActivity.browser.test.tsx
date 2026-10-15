import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowerActivityItem, FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapter, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';

// Keep the thread rail visible while exercising the conversation contract.
beforeEach(() => page.viewport(1280, 900));
afterEach(() => {
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-floe-shell-theme');
});

function fixture(items: readonly FlowerActivityItem[]) {
  return thread({ thread_id: 'terminal-activity', title: 'SSH GPU diagnostics', status: 'running', active_run_id: 'run-terminal', messages: [{
    id: 'terminal-message', turn_id: 'turn-terminal', run_id: 'run-terminal', role: 'assistant', content: '', status: 'streaming', created_at_ms: 10,
    blocks: [activityTimeline({ thread_id: 'terminal-activity', run_id: 'run-terminal', turn_id: 'turn-terminal', status: 'running', items: [...items] })],
  }] });
}
function currentFor(items: readonly FlowerActivityItem[], version: number) {
  const current = runtimeCurrentView(fixture(items), version);
  return { ...current, items: current.items?.map((item) => {
    if (!item.activity) return item;
    const { label, description, renderer, payload, chips, target_refs, ...facts } = item.activity;
    return { ...item, activity: { ...facts, presentation: { label, description, renderer, payload, chips, target_refs } } };
  }) };
}

const write = () => activityItem({ item_id: 'write', tool_id: 'write', tool_name: 'terminal.write', renderer: 'terminal', label: '向 SSH 登录会话提交密码', status: 'success', payload: { operation: 'write', command: 'ssh udesk26', process_id: 'process-1', input_bytes: 12 } });
const read = () => activityItem({ item_id: 'read', tool_id: 'read', tool_name: 'terminal.read', renderer: 'terminal', label: '检查 GPU/LM Studio 诊断输出', status: 'success', payload: { operation: 'read', command: 'ssh udesk26 nvidia-smi', process_id: 'process-1', output: '', last_seq: 2, latest_seq: 2 } });

function stream() {
  const queue: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  return {
    push(value: FlowerLiveStreamEnvelope) { queue.push(value); wake?.(); },
    async *connect({ signal }: { signal: AbortSignal }): AsyncIterable<FlowerLiveStreamEnvelope> {
      while (!signal.aborted) {
        const value = queue.shift();
        if (value) { yield value; continue; }
        await new Promise<void>((resolve) => { wake = resolve; signal.addEventListener('abort', () => resolve(), { once: true }); });
      }
    },
  };
}

async function mount(items: readonly FlowerActivityItem[]) {
  const current = fixture(items);
  const peer = thread({ thread_id: 'peer', title: 'Another task' });
  const live = stream();
  const base = adapter(true);
  const runtime = renderSurfaceWithAdapter({ ...base, listThreads: vi.fn(async () => [current, peer]), loadThread: vi.fn(async (id) => liveBootstrap(id === peer.thread_id ? peer : current, 1)), connectLiveStream: live.connect });
  runtime.style.height = '780px';
  await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="terminal-activity"] button')));
  (runtime.querySelector('[data-thread-id="terminal-activity"] button') as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="write"]')));
  await waitFor(() => runtime.querySelector('.flower-chat-transcript')?.getAttribute('data-flower-tail-preparing') !== 'true');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { runtime, live, base };
}
const rowFor = (runtime: HTMLElement, id: string) => runtime.querySelector(`[data-flower-activity-item-id="${id}"]`)!;
const toggleFor = (runtime: HTMLElement, id: string) => rowFor(runtime, id).querySelector<HTMLButtonElement>('.flower-activity-inline-button')!;

describe('SSH terminal activity', () => {
  it.each(['classic-light', 'classic-dark'])('highlights crisp borderless commands with open output in %s', async theme => {
    document.documentElement.classList.toggle('dark', theme === 'classic-dark');
    document.documentElement.dataset.floeShellTheme = theme;
    const command = 'date +%s; sleep 10; date +%s; echo "no files changed"';
    const output = Array.from({ length: 12 }, (_, index) => `Diagnostic line ${index + 1}`).join('\n');
    const result = activityItem({ ...read(), payload: { operation: 'read', command, output } });
    const { runtime } = await mount([write(), result]);
    toggleFor(runtime, 'read').click();
    await waitFor(() => rowFor(runtime, 'read').querySelector('.flower-activity-terminal-output') !== null);
    await waitFor(() => rowFor(runtime, 'read').querySelector('.flower-activity-inline-details')?.getAttribute('data-state') === 'open');
    const panel = rowFor(runtime, 'read').querySelector<HTMLElement>('[data-flower-activity-terminal-panel]')!;
    const panelStyle = getComputedStyle(panel);
    expect(panelStyle.borderWidth).toBe('0px');
    expect(panelStyle.boxShadow).toBe('none');
    expect(panelStyle.backgroundImage).toBe('none');
    expect(panelStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    const header = panel.querySelector<HTMLElement>('.flower-activity-terminal-header')!;
    expect(getComputedStyle(header).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(header).borderWidth).toBe('0px');
    const highlight = panel.querySelector<HTMLElement>('.flower-activity-terminal-command-token-command')!;
    expect(getComputedStyle(highlight).color).not.toBe(getComputedStyle(header).color);
    const buttons = panel.querySelectorAll<HTMLButtonElement>('.flower-activity-terminal-actions button');
    expect(getComputedStyle(buttons[0]).opacity).toBe('1');
    expect(getComputedStyle(buttons[1]).opacity).toBe('1');
    for (const button of buttons) {
      expect(getComputedStyle(button).visibility).toBe('visible');
      expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(28);
      expect(button.querySelector('svg')).not.toBeNull();
    }
    buttons[0].focus();
    expect(getComputedStyle(buttons[0]).opacity).toBe('1');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => buttons[0].getAttribute('aria-expanded') === 'true');
    expect(panel.querySelector('.flower-activity-terminal-command-expanded')?.textContent).toBe(command);
    expect(panel.querySelectorAll('.flower-activity-terminal-command-code')).toHaveLength(1);
    expect(panel.querySelector('.flower-activity-terminal-output-heading')?.textContent).toBe('Output');
    for (const node of panel.querySelectorAll('.flower-activity-terminal-header, .flower-activity-terminal-command, .flower-activity-terminal-output')) {
      const style = getComputedStyle(node);
      expect(style.borderBottomWidth).toBe('0px');
      expect(style.opacity).toBe('1');
      expect(style.maskImage).toBe('none');
      expect(style.filter).toBe('none');
    }
    expect(getComputedStyle(panel.querySelector('.flower-activity-terminal-output')!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(panel.querySelector('.flower-activity-terminal-command')?.textContent).toBe(command);
    buttons[0].blur();
    await page.screenshot({ element: runtime, path: `__screenshots__/flower-terminal-surface-${theme}.png` });
    await page.viewport(390, 844);
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    await page.screenshot({ element: runtime, path: `__screenshots__/flower-terminal-surface-mobile-${theme}.png` });
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    buttons[1].click();
    await expect.poll(() => clipboard.mock.calls[0]?.[0]).toBe(command);
    await waitFor(() => buttons[1].getAttribute('data-copied') === 'true');
    expect(buttons[1].querySelector('svg')).not.toBeNull();
    clipboard.mockRestore();
    const viewport = panel.querySelector<HTMLElement>('.flower-activity-terminal-output')!;
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    expect(viewport.clientHeight).toBeLessThanOrEqual(107);
    viewport.scrollTop = viewport.scrollHeight;
    expect(viewport.scrollTop).toBeGreaterThan(0);
  });

  it('expands a long command in place without disturbing selection or the output viewport', async () => {
    const command = Array.from({ length: 14 }, (_, index) => `printf "Diagnostic line ${index + 1}"`).join(' && ');
    const result = activityItem({ ...read(), payload: { operation: 'read', command, output: 'GPU ready' } });
    const { runtime } = await mount([write(), result]);
    await page.viewport(390, 844);
    toggleFor(runtime, 'read').click();
    await waitFor(() => rowFor(runtime, 'read').querySelector('.flower-activity-inline-details')?.getAttribute('data-state') === 'open');
    const panel = rowFor(runtime, 'read').querySelector<HTMLElement>('[data-flower-activity-terminal-panel]')!;
    const commandNode = panel.querySelector<HTMLElement>('.flower-activity-terminal-command')!;
    const output = panel.querySelector('.flower-activity-terminal-output');
    const button = panel.querySelector<HTMLButtonElement>('.flower-activity-terminal-actions button')!;
    const collapsedHeight = commandNode.getBoundingClientRect().height;
    await userEvent.click(commandNode);
    const range = document.createRange();
    range.selectNodeContents(commandNode);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      button.click();
      await waitFor(() => button.getAttribute('aria-expanded') === 'true');
      expect(document.getElementById(button.getAttribute('aria-controls')!)).toBe(commandNode);
      expect(panel.querySelector('.flower-activity-terminal-command')).toBe(commandNode);
      expect(selection.toString()).toBe(command);
      expect(commandNode.getBoundingClientRect().height).toBeGreaterThan(collapsedHeight);
      expect(panel.querySelectorAll('.flower-activity-terminal-command-code')).toHaveLength(1);
      expect(panel.querySelector('.flower-activity-terminal-output')).toBe(output);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      button.click();
      await waitFor(() => button.getAttribute('aria-expanded') === 'false');
      expect(commandNode.getBoundingClientRect().height).toBe(collapsedHeight);
    } finally {
      selection.removeAllRanges();
    }
  });

  it.each([
    { name: 'confirmed exit', operation: 'exec', status: 'success', facts: { exit_code: 0 }, visible: true },
    { name: 'read without exit', operation: 'read', status: 'success', facts: {}, visible: false },
    { name: 'running process', operation: 'exec', status: 'running', facts: { exit_code: 0 }, visible: false },
    { name: 'failed process', operation: 'exec', status: 'error', facts: { exit_code: 2 }, visible: false },
    { name: 'timed out process', operation: 'exec', status: 'success', facts: { exit_code: 0, timed_out: true }, visible: false },
    { name: 'stopped process', operation: 'terminate', status: 'success', facts: { exit_code: 0, terminated: true }, visible: false },
  ] as const)('shows a success exit label only for $name', async ({ operation, status, facts, visible }) => {
    const result = activityItem({ ...read(), status, payload: { operation, command: 'date +%s', output: '1792042868', ...facts } });
    const { runtime } = await mount([write(), result]);
    toggleFor(runtime, 'read').click();
    await waitFor(() => rowFor(runtime, 'read').querySelector('.flower-activity-terminal-output') !== null);
    const exit = rowFor(runtime, 'read').querySelector('.flower-activity-terminal-exit');
    expect(Boolean(exit)).toBe(visible);
    if (visible) expect(exit?.textContent).toBe('Exit code 0');
  });

  it('puts returned output directly below the command without repeating intent or exposing transport metadata', async () => {
    const purpose = 'Check the interactive diagnostic output';
    const output = 'demo\n输入已收到\n';
    const result = activityItem({ ...read(), label: purpose, description: purpose, payload: {
      operation: 'read', command: 'python3 -c "run_diagnostic()"', process_id: 'private-process-id',
      output, first_seq: 1, last_seq: 2, latest_seq: 2, total_bytes: 23, execution_location: 'local_runtime',
    } });
    const { runtime } = await mount([write(), result]);
    toggleFor(runtime, 'read').click();
    await waitFor(() => rowFor(runtime, 'read').querySelector('.flower-activity-terminal-output') !== null);
    const panel = rowFor(runtime, 'read').querySelector<HTMLElement>('[data-flower-activity-terminal-panel]')!;
    expect(panel.querySelector('.flower-activity-terminal-output pre')?.textContent).toBe(output);
    expect(panel.textContent).not.toContain(purpose);
    for (const hidden of ['Purpose', 'Status', 'Done', 'Output sequence', 'Output bytes', 'Execution location', 'local_runtime', 'private-process-id']) {
      expect(panel.textContent).not.toContain(hidden);
    }
    expect(panel.querySelector('.flower-activity-terminal-header')?.nextElementSibling?.classList.contains('flower-activity-terminal-output-heading')).toBe(true);
    expect(panel.querySelector('.flower-activity-terminal-output-heading')?.nextElementSibling?.classList.contains('flower-activity-terminal-output')).toBe(true);
  });

  it.each([
    { name: 'started command', operation: 'exec', status: 'success', payload: {}, result: 'Command started. No output returned yet.' },
    { name: 'finished command', operation: 'exec', status: 'success', payload: { exit_code: 0 }, result: 'Command finished without output.' },
    { name: 'failed command', operation: 'exec', status: 'error', payload: { exit_code: 2, output: 'Invalid option' }, result: 'Command exited with code 2.' },
    { name: 'timed out command', operation: 'exec', status: 'error', payload: { timed_out: true, output: 'Starting' }, result: 'Command timed out.' },
    { name: 'input sent', operation: 'write', status: 'success', payload: { stdin: 'secret', output: 'secret', input_bytes: 6 }, result: 'Input sent.' },
    { name: 'failed input', operation: 'write', status: 'error', payload: {}, result: 'Input could not be sent.' },
    { name: 'waiting input', operation: 'write', status: 'waiting', payload: {}, result: 'Waiting to send input…' },
    { name: 'stopped command', operation: 'terminate', status: 'success', payload: { terminated: true, output: 'Final diagnostic output' }, result: 'Command stopped.' },
    { name: 'partial read', operation: 'read', status: 'success', payload: { output: 'GPU ready', has_more: true }, result: 'Only part of the output is shown.' },
  ] as const)('shows the result for $name without inventing completion or displaying input', async ({ operation, status, payload, result }) => {
    const tool = activityItem({ ...read(), item_id: 'result', tool_id: 'result', status, payload: { operation, ...payload } });
    const { runtime, base } = await mount([write(), tool]);
    const button = toggleFor(runtime, 'result');
    if (button.getAttribute('aria-expanded') !== 'true') button.click();
    await waitFor(() => rowFor(runtime, 'result').querySelector('[data-flower-activity-terminal-panel]') !== null);
    const panel = rowFor(runtime, 'result').querySelector<HTMLElement>('[data-flower-activity-terminal-panel]')!;
    expect(panel.textContent).toContain(result);
    expect(panel.textContent).not.toContain('Done');
    expect(panel.textContent).not.toContain('secret');
    if ('output' in payload && operation !== 'write') expect(panel.querySelector('pre')?.textContent).toBe(payload.output);
    expect(base.readTerminalProcess).not.toHaveBeenCalled();
  });

  it('supports keyboard disclosure, input results, empty reads, updates, and reopening a task', async () => {
    const { runtime, live, base } = await mount([write(), read()]);
    const button = toggleFor(runtime, 'write');
    expect(button.textContent).toContain('向 SSH 登录会话提交密码');
    expect(button.querySelector('.flower-activity-inline-chevron')).not.toBeNull();
    expect(getComputedStyle(button).cursor).toBe('pointer');
    button.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => button.getAttribute('aria-expanded') === 'true');
    const writeRow = rowFor(runtime, 'write');
    expect(writeRow.textContent).toContain('Input sent.');
    expect(writeRow.textContent).not.toContain('Bytes sent');
    expect(writeRow.textContent).toContain('ssh udesk26');
    expect(writeRow.querySelector('.flower-activity-terminal-output')).toBeNull();
    expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();
    toggleFor(runtime, 'read').click();
    await waitFor(() => rowFor(runtime, 'read').textContent?.includes('No new output.') === true);
    expect(rowFor(runtime, 'read').textContent).not.toContain('2 / 2');
    expect(rowFor(runtime, 'read').textContent).not.toContain('0–2');
    const nextRead = { ...read(), payload: { ...read().payload, output: 'GPU ready', first_seq: 3, last_seq: 4, latest_seq: 4, has_more: false } };
    live.push({ schema_version: 1, kind: 'thread.batch', thread_id: 'terminal-activity', current: currentFor([write(), nextRead], 2) });
    await waitFor(() => rowFor(runtime, 'read').textContent?.includes('GPU ready') === true);
    expect(toggleFor(runtime, 'write').getAttribute('aria-expanded')).toBe('true');
    expect(toggleFor(runtime, 'read').getAttribute('aria-expanded')).toBe('true');
    expect(base.readTerminalProcess).not.toHaveBeenCalled();
    (runtime.querySelector('[data-thread-id="peer"] button') as HTMLButtonElement).click();
    await waitFor(() => !runtime.querySelector('[data-flower-activity-item-id="write"]'));
    (runtime.querySelector('[data-thread-id="terminal-activity"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="write"]')));
    expect(toggleFor(runtime, 'write').getAttribute('aria-expanded')).toBe('true');
    expect(toggleFor(runtime, 'read').getAttribute('aria-expanded')).toBe('true');
    await page.viewport(390, 844);
    await waitFor(() => rowFor(runtime, 'write').clientWidth > 0);
    for (const id of ['write', 'read']) {
      const row = rowFor(runtime, id);
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
    }
    await waitFor(() => Array.from(runtime.querySelectorAll('.flower-activity-inline-details')).every((panel) => panel.getAttribute('data-state') === 'open'));
    await page.viewport(1280, 900);
  });

  it('keeps failures in manually expanded details and returns focus when closing', async () => {
    const failure = activityItem({ ...read(), item_id: 'failed', tool_id: 'failed', label: '检查失败的诊断', status: 'error', payload: { operation: 'read', error: { message: 'Session closed' } } });
    const waiting = activityItem({ ...write(), item_id: 'waiting', tool_id: 'waiting', label: '等待 SSH 输入授权', status: 'waiting', requires_approval: true, approval_state: 'requested' });
    const stopped = activityItem({ ...read(), item_id: 'stopped', tool_id: 'stopped', label: '停止诊断任务', payload: { operation: 'terminate', command: 'ssh udesk26', output: 'Stopped', terminated: true } });
    const { runtime } = await mount([write(), failure, waiting, stopped]);
    expect(toggleFor(runtime, 'failed').getAttribute('aria-expanded')).toBe('false');
    expect(toggleFor(runtime, 'waiting').getAttribute('aria-expanded')).toBe('false');
    expect(toggleFor(runtime, 'failed').textContent).not.toContain('Session closed');
    expect(rowFor(runtime, 'failed').getAttribute('data-flower-activity-status')).toBe('error');
    toggleFor(runtime, 'failed').click();
    await waitFor(() => rowFor(runtime, 'failed').querySelector('.flower-activity-error-message')?.textContent === 'Session closed');
    expect(rowFor(runtime, 'failed').querySelectorAll('.flower-activity-terminal-notice')).toHaveLength(0);
    toggleFor(runtime, 'stopped').click();
    await waitFor(() => rowFor(runtime, 'stopped').textContent?.includes('Stopped') === true);
    const commandAction = rowFor(runtime, 'stopped').querySelector<HTMLButtonElement>('.flower-activity-terminal-actions button')!;
    commandAction.focus();
    expect(document.activeElement).toBe(commandAction);
    toggleFor(runtime, 'stopped').click();
    await waitFor(() => document.activeElement === toggleFor(runtime, 'stopped'));
    expect(toggleFor(runtime, 'stopped').getAttribute('aria-expanded')).toBe('false');
  });

  it.each(['classic-light', 'classic-dark'])('shows an SSH failure once below the command in %s', async theme => {
    document.documentElement.classList.toggle('dark', theme === 'classic-dark');
    document.documentElement.dataset.floeShellTheme = theme;
    const failed = activityItem({ item_id: 'ssh-failed', tool_id: 'ssh-failed', tool_name: 'terminal.exec', renderer: 'terminal',
      label: 'Inspect remote runtime', status: 'error', payload: { operation: 'exec', command: 'ssh -o BatchMode=yes udesk26 hostname',
        output: 'Permission denied (publickey,password).', exit_code: 255,
        error: { code: 'COMMAND_FAILED', message: 'Terminal process exited with code 255' } } });
    const { runtime } = await mount([write(), failed]);
    const row = rowFor(runtime, 'ssh-failed');
    expect(toggleFor(runtime, 'ssh-failed').textContent).not.toContain('Terminal process exited');
    toggleFor(runtime, 'ssh-failed').click();
    await waitFor(() => row.querySelector('.flower-activity-terminal-output') !== null);
    await waitFor(() => row.querySelector('.flower-activity-inline-details')?.getAttribute('data-state') === 'open');
    expect(row.querySelector('.flower-activity-error-panel')).toBeNull();
    expect(row.textContent).not.toContain('Terminal process exited');
    expect(row.querySelector('.flower-activity-terminal-output')?.textContent).toBe('Permission denied (publickey,password).');
    expect(row.querySelectorAll('.flower-activity-terminal-notice')).toHaveLength(1);
    expect(row.querySelector('.flower-activity-terminal-notice')?.textContent).toBe('Command exited with code 255.');
    const panel = row.querySelector<HTMLElement>('[data-flower-activity-terminal-panel]')!;
    expect(panel.firstElementChild?.classList.contains('flower-activity-terminal-header')).toBe(true);
    for (const width of [1280, 390]) {
      await page.viewport(width, 900);
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      await page.screenshot({ element: runtime, path: `__screenshots__/flower-terminal-failure-${theme}-${width}.png` });
    }
  });

  it('keeps a specific input failure once after the command', async () => {
    const failed = activityItem({ ...write(), status: 'error', payload: { operation: 'write', command: 'ssh udesk26',
      stdin: 'secret', output: 'secret', error: { message: 'Session closed' } } });
    const { runtime } = await mount([failed]);
    toggleFor(runtime, 'write').click();
    const row = rowFor(runtime, 'write');
    await waitFor(() => row.querySelector('.flower-activity-error-message')?.textContent === 'Session closed');
    expect(row.querySelectorAll('.flower-activity-terminal-notice')).toHaveLength(0);
    expect(row.textContent).not.toContain('secret');
    expect(row.textContent).not.toContain('Input could not be sent');
    const details = row.querySelector('.flower-activity-inline-details-content')!;
    expect(details.querySelectorAll('.flower-activity-error-panel')).toHaveLength(1);
    expect(details.lastElementChild?.contains(details.querySelector('.flower-activity-error-panel'))).toBe(true);
    expect(details.querySelector('[data-flower-activity-terminal-panel]')).not.toBeNull();
  });
});
