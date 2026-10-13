import { afterEach, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { RuntimeComponentTransferProgress } from './RuntimeComponentTransferProgress';
import type { DesktopComponentTaskProgress } from '../shared/desktopComponentTaskProgress';
import { createDesktopI18n } from '../shared/i18n';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
const initial: DesktopComponentTaskProgress = { id: 'runtime', status: 'running', phase: 'transferring', strategy: 'desktop_upload', transfer_kind: 'upload', completed_bytes: 1048576, total_bytes: 4194304 };

it('shows actual upload bytes and updates the accessible meter without marking the Runtime ready', () => {
  const root = document.createElement('div'); document.body.append(root);
  const [task, setTask] = createSignal(initial);
  dispose = render(() => <RuntimeComponentTransferProgress task={task()} i18n={createDesktopI18n('zh-CN')} />, root);
  expect(root.textContent).toContain('1 MiB / 4 MiB');
  expect(root.textContent).toContain('25%');
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25');
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toContain('上传中');
  setTask({ ...initial, completed_bytes: 4194304 });
  expect(root.textContent).toContain('100%');
  expect(root.textContent).not.toContain('就绪');
  setTask({ ...initial, status: 'canceled', completed_bytes: 2097152 });
  expect(root.querySelector('[data-active]')?.getAttribute('data-active')).toBe('false');
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('50');
});

it('keeps unknown-length downloads indeterminate and uses observed percentages when available', () => {
  const root = document.createElement('div'); document.body.append(root);
  const [task, setTask] = createSignal<DesktopComponentTaskProgress>({ ...initial, strategy: 'remote_install', transfer_kind: 'download', completed_bytes: undefined, total_bytes: undefined });
  dispose = render(() => <RuntimeComponentTransferProgress task={task()} i18n={createDesktopI18n('en-US')} active={false} />, root);
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toContain('Downloading');
  expect(root.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
  expect(root.querySelector('[data-active]')?.getAttribute('data-active')).toBe('false');
  setTask({ ...task(), transfer_percent: 63.7 });
  expect(root.textContent).toContain('63%');
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('63.7');
});
