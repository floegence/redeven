// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShellBlock } from './ShellBlock';

const writeTextToClipboardMock = vi.hoisted(() => vi.fn());
const renderDisposers: Array<() => void> = [];

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div data-testid="dialog">
        <div>{props.title}</div>
        {props.children}
      </div>
    </Show>
  ),
}));

vi.mock('../../services/gatewayApi', () => ({
  prepareGatewayRequestInit: vi.fn(async (init?: RequestInit) => init ?? {}),
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
}

afterEach(() => {
  while (renderDisposers.length > 0) {
    const dispose = renderDisposers.pop();
    dispose?.();
  }
  writeTextToClipboardMock.mockReset();
  document.body.innerHTML = '';
});

describe('ShellBlock', () => {
  it('collapses multiline commands into a stable single-line preview and exposes the full command in details', async () => {
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
    expect(host.textContent).toContain('2 lines');

    const detailButton = host.querySelector('.chat-shell-detail-link') as HTMLButtonElement | null;
    expect(detailButton?.textContent).toBe('Command');

    detailButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(document.body.textContent).toContain('Command details');
    expect(document.body.querySelector('.chat-shell-detail-command')?.textContent).toContain(command);

    const copyButton = document.body.querySelector('.chat-shell-detail-copy') as HTMLButtonElement | null;
    copyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(writeTextToClipboardMock).toHaveBeenCalledWith(command);
    expect(copyButton?.textContent).toBe('Copied');
  });

  it('keeps simple single-line commands compact while toggling output on demand', async () => {
    const { host } = renderShellBlock({
      command: 'npm test',
      output: 'line 1\nline 2',
      status: 'success',
      exitCode: 0,
    });

    expect(host.querySelector('.chat-shell-detail-link')).toBeNull();
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

  it('shows a command details affordance when a single-line command is truncated', () => {
    const { host } = renderShellBlock({
      command: `node -e "${'console.log(42); '.repeat(20).trim()}"`,
      status: 'running',
    });

    expect(host.querySelector('.chat-shell-detail-link')?.textContent).toBe('Command');
    expect(host.querySelector('.chat-shell-command-highlight')?.textContent).toContain('…');
    expect(host.textContent).not.toContain('2 lines');
  });
});
