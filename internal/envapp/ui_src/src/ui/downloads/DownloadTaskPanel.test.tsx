// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadManager, DownloadTask } from './types';
import { DownloadTaskPanel } from './DownloadTaskPanel';

function task(overrides: Partial<DownloadTask>): DownloadTask {
  return {
    id: 'download-1',
    command: {
      entryKind: 'file',
      origin: 'file_browser_context_menu',
      preferredName: 'app.log',
      source: {
        kind: 'runtime_file',
        path: '/workspace/app.log',
        name: 'app.log',
        size: 10,
      },
    },
    platform: 'desktop_file_system',
    status: 'streaming',
    createdAt: 1,
    startedAt: 1,
    bytesRead: 5,
    totalBytes: 10,
    progressRatio: 0.5,
    bytesPerSecond: 2048,
    destination: {
      label: 'app.log',
      detail: '/tmp/app.log',
      canReveal: false,
      canOpen: false,
    },
    cancelable: true,
    ...overrides,
  };
}

function createManager(tasks: () => readonly DownloadTask[]): DownloadManager {
  return {
    tasks,
    activeCount: () => tasks().filter((item) => item.status === 'streaming').length,
    latestTask: () => tasks()[0] ?? null,
    getTask: (id) => tasks().find((item) => item.id === id),
    enqueue: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    reveal: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    clearFinished: vi.fn(),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

function clickAction(host: HTMLElement, title: string) {
  const button = Array.from(host.querySelectorAll('button')).find((candidate) => candidate.getAttribute('title') === title) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Action not found: ${title}`);
  button.click();
}

describe('DownloadTaskPanel', () => {
  it('shows active progress and exposes cancel', () => {
    const [tasks] = createSignal([task({})]);
    const manager = createManager(tasks);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <DownloadTaskPanel manager={manager} />, host);

    expect(host.textContent).toContain('Downloads');
    expect(host.textContent).toContain('1 active');
    expect(host.textContent).toContain('50%');
    expect(host.textContent).toContain('2 KB/s');

    clickAction(host, 'Cancel');
    expect(manager.cancel).toHaveBeenCalledWith('download-1');
  });

  it('shows completed Reveal and Open actions only when the destination supports them', () => {
    const completed = task({
      status: 'completed',
      progressRatio: 1,
      bytesRead: 10,
      cancelable: false,
      destination: {
        label: 'app.log',
        detail: '/tmp/app.log',
        canReveal: true,
        canOpen: true,
      },
    });
    const [tasks] = createSignal([completed]);
    const manager = createManager(tasks);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <DownloadTaskPanel manager={manager} />, host);

    expect(host.textContent).toContain('Completed');
    clickAction(host, 'Reveal');
    clickAction(host, 'Open');

    expect(manager.reveal).toHaveBeenCalledWith('download-1');
    expect(manager.open).toHaveBeenCalledWith('download-1');
  });
});
