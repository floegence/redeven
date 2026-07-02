// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShellBlock } from './ShellBlock';

const writeTextToClipboardMock = vi.hoisted(() => vi.fn());
const renderDisposers: Array<() => void> = [];

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Check: (props: { class?: string }) => <span class={props.class} data-icon="check" />,
  ChevronDown: (props: { class?: string }) => <span class={props.class} data-icon="chevron-down" />,
  ChevronRight: (props: { class?: string }) => <span class={props.class} data-icon="chevron-right" />,
  Copy: (props: { class?: string }) => <span class={props.class} data-icon="copy" />,
}));

vi.mock('../../services/localApi', () => ({
  prepareLocalApiRequestInit: vi.fn(async (init?: RequestInit) => init ?? {}),
}));

vi.mock('../../utils/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => writeTextToClipboardMock(...args),
}));

function renderShellBlock(props: Parameters<typeof ShellBlock>[0]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <ShellBlock {...props} />, host);
  renderDisposers.push(dispose);
  return { host, dispose };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForCondition(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 1000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    }
  }
  if (lastError) throw lastError;
  assertion();
}

afterEach(() => {
  while (renderDisposers.length > 0) {
    const dispose = renderDisposers.pop();
    dispose?.();
  }
  vi.useRealTimers();
  writeTextToClipboardMock.mockReset();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ShellBlock', () => {
  it('collapses multiline commands into a stable single-line preview and exposes the full command inline', async () => {
    vi.useFakeTimers();
    writeTextToClipboardMock.mockResolvedValue(undefined);
    const command = "printf 'alpha'\nprintf 'beta'";
    const { host } = renderShellBlock({
      command,
      output: 'done',
      status: 'success',
    });

    const preview = host.querySelector('.chat-shell-command-highlight');
    expect(preview?.textContent).toContain("printf 'alpha' printf 'beta'");
    expect(preview?.textContent).not.toContain('\n');
    expect(host.textContent).not.toContain('2 lines');
    expect(host.querySelector('.chat-shell-inline-chip')).toBeNull();
    expect(host.querySelector('.chat-shell-detail-meta-grid')).toBeNull();

    const detailButton = host.querySelector('button[aria-label="Show full command"]') as HTMLButtonElement | null;
    expect(detailButton?.textContent?.trim()).toBe('');

    detailButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(document.body.querySelector('.chat-shell-detail-panel')).toBeTruthy();
    expect(document.body.querySelector('.chat-shell-detail-command')?.textContent).toContain(command);
    expect(document.body.querySelector('.chat-shell-detail-meta-grid')).toBeNull();
    expect(document.body.textContent).not.toContain('Status');
    expect(document.body.textContent).not.toContain('Exit code');
    expect(detailButton?.getAttribute('aria-expanded')).toBe('true');

    const copyButton = host.querySelector('button[aria-label="Copy command"]') as HTMLButtonElement | null;
    expect(copyButton?.textContent?.trim()).toBe('');
    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(writeTextToClipboardMock).toHaveBeenCalledWith(command);
    expect(copyButton?.getAttribute('data-copied')).toBe('true');
    expect(copyButton?.getAttribute('aria-label')).toBe('Command copied');
    vi.advanceTimersByTime(1800);
    await flushAsync();
    expect(copyButton?.getAttribute('data-copied')).toBe('false');
    expect(copyButton?.getAttribute('aria-label')).toBe('Copy command');
  });

  it('keeps simple single-line commands compact while toggling output on demand', async () => {
    const { host } = renderShellBlock({
      command: 'npm test',
      output: 'line 1\nline 2',
      status: 'success',
      exitCode: 0,
    });

    expect(host.querySelector('button[aria-label="Show full command"]')).toBeTruthy();
    expect(host.querySelector('.chat-shell-inline-chip')).toBeNull();
    expect(host.textContent).not.toContain('exit 0');
    expect(host.querySelector('.chat-shell-output-panel')).toBeNull();

    const toggleButton = host.querySelector('button[aria-label="Show output for command output"]') as HTMLButtonElement | null;
    expect(toggleButton).toBeTruthy();

    toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.querySelector('.chat-shell-output-panel')?.textContent).toContain('line 1');
    expect(host.querySelector('.chat-shell-output-panel')?.textContent).toContain('line 2');

    toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.querySelector('.chat-shell-output-panel')).toBeNull();
  });

  it('shows an icon-only command details affordance for long commands', () => {
    const { host } = renderShellBlock({
      command: `node -e "${'console.log(42); '.repeat(20).trim()}"`,
      status: 'running',
    });

    const detailButton = host.querySelector('button[aria-label="Show full command"]') as HTMLButtonElement | null;
    expect(detailButton).toBeTruthy();
    expect(detailButton?.textContent?.trim()).toBe('');
    expect(host.querySelector('.chat-shell-command-highlight')?.textContent).toContain('…');
    expect(host.textContent).not.toContain('2 lines');
    expect(host.textContent).not.toContain('Command');
  });

  it('does not render raw terminal result data when deferred output lacks streams', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        ok: true,
        data: {
          status: 'success',
          raw_result: '{"api_key":"sk-secret"}',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { host, dispose } = renderShellBlock({
      command: 'redeven run',
      outputRef: { runId: 'run_1', toolId: 'tool_1' },
      status: 'success',
    });

    const toggleButton = host.querySelector('button[aria-label="Show output for command output"]') as HTMLButtonElement | null;
    toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await waitForCondition(() => {
      expect(host.textContent).toContain('No output captured.');
    });
    expect(host.textContent).not.toContain('sk-secret');
    expect(host.textContent).not.toContain('"api_key"');
    dispose();
  });

  it('keeps fetched output visible when a running poll returns empty output', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          ok: true,
          data: {
            status: 'running',
            process_id: 'tp_live',
            output: 'tick 1\n',
            last_seq: 1,
            total_bytes: 7,
          },
        }),
      })
      .mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          ok: true,
          data: {
            status: 'running',
            process_id: 'tp_live',
            output: '',
            stdout: '',
            last_seq: 1,
            total_bytes: 7,
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { host, dispose } = renderShellBlock({
      command: 'npm test',
      outputRef: { runId: 'run_live', toolId: 'tool_live' },
      processId: 'tp_live',
      status: 'running',
    });

    const toggleButton = host.querySelector('button[aria-label="Show output for command output"]') as HTMLButtonElement | null;
    toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await waitForCondition(() => {
      expect(host.textContent).toContain('tick 1');
    });
    await waitForCondition(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    });

    expect(host.textContent).toContain('tick 1');
    expect(host.textContent).not.toContain('Listening for output');
    expect(host.textContent).not.toContain('No output captured');
    dispose();
  });
});
