import '../index.css';
import './flower-feature.css';

import { expect, it, onTestFinished, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import {
  adapter,
  mutableSettingsAdapter,
  renderSurfaceWithAdapterProps,
  settingsSnapshot,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

const companionCopy = {
  label: 'Switch Flower conversation', searchPlaceholder: 'Search conversations...',
  newConversation: 'New conversation', empty: 'No matching conversations', queued: 'Queued',
  threadList: DEFAULT_FLOWER_SURFACE_COPY.threadList,
};
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

it.each([['light', 544], ['dark', 544], ['dark', 360]] as const)('keeps the companion footer empty and stable during Desktop model failure in %s at %ipx', async (theme, width) => {
  await page.viewport(1280, 900);
  const previousClass = document.documentElement.className;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  onTestFinished(() => { document.documentElement.className = previousClass; });
  const source = adapter(false);
  const snapshot = { ...settingsSnapshot(false), model_profile: { schema_version: 1 as const, current_model_id: '', providers: [] },
    model_source: { kind: 'desktop_model_source' as const, state: 'error' as const, label: 'Desktop' as const } };
  const runtime = renderSurfaceWithAdapterProps({ ...source, loadSettings: vi.fn(async () => snapshot),
    modelSourceRecovery: { ...source.modelSourceRecovery!, describe: () => 'Desktop 模型桥接绑定失败，请检查连接。' },
  }, { presentation: 'companion', companionOpen: true, engaged: true, transcriptVisible: true, companionCopy,
    copy: { ...DEFAULT_FLOWER_SURFACE_COPY, chat: { ...DEFAULT_FLOWER_SURFACE_COPY.chat,
      configureProviderBeforeChat: '先设置模型提供商，就可以开始对话。' } },
  });
  runtime.className = 'flower-activity-companion floe-bottom-bar-companion';
  runtime.dataset.companionPhase = 'expanded';
  Object.assign(runtime.style, { position: 'relative', width: `${width}px`, height: '620px' });
  await waitFor(() => Boolean(runtime.querySelector('.flower-model-source-status-footer')));
  await document.fonts.ready;
  const states = new Set<string>();
  for (let index = 0; index < 90; index += 1) {
    await frame();
    if (index < 18) continue;
    const composer = runtime.querySelector<HTMLElement>('.flower-composer')!;
    states.add(JSON.stringify({ width: composer.clientWidth, height: composer.clientHeight,
      inline: [...runtime.querySelectorAll('[data-flower-composer-inline-item]')].map(node => node.getAttribute('data-flower-composer-inline-item')),
      more: Boolean(runtime.querySelector('.flower-composer-more-button')) }));
  }
  expect.soft([...states], 'the footer must settle instead of cycling between layouts').toHaveLength(1);
  const footer = runtime.querySelector<HTMLElement>('.flower-composer-footer')!;
  expect.soft(footer.querySelectorAll('[data-flower-composer-inline-item]')).toHaveLength(0);
  expect.soft(footer.innerText.trim()).toBe('');
  expect.soft(runtime.querySelector('.flower-chat-header .flower-working-directory-browse')).toBeNull();
  expect.soft(runtime.querySelector('.flower-new-working-directory')).toBeNull();
  expect.soft(runtime.querySelector('.flower-model-source-status-footer')?.closest('.flower-composer')).toBeNull();
  await page.screenshot({ element: runtime, path: `__screenshots__/companion-composer-${theme}-${width}.png` });
  const more = runtime.querySelector<HTMLButtonElement>('.flower-composer-more-button')!;
  expect(more).not.toBeNull();
  await userEvent.click(more);
  await waitFor(() => Boolean(document.querySelector('[data-flower-composer-more-panel]')));
  expect(document.querySelector('[data-flower-composer-more-item="permission"]')).not.toBeNull();
  expect(document.querySelector('[data-flower-composer-more-item="model_reasoning"]')).not.toBeNull();
});

it('keeps permission changes accessible through More without exposing a directory or replacing the draft', async () => {
  await page.viewport(1280, 900);
  const source = { ...mutableSettingsAdapter(true),
    getWorkingDirectoryPathContext: vi.fn(async () => ({ agentHomePathAbs: '/workspace', homePathAbs: '/workspace', defaultRootId: 'workspace',
      roots: [{ id: 'workspace', label: 'Workspace', pathAbs: '/workspace', kind: 'home', permissions: { read: true, write: true } }] })),
    listWorkingDirectoryEntries: vi.fn(async () => []),
  };
  const runtime = renderSurfaceWithAdapterProps(source, {
    presentation: 'companion', companionOpen: true, engaged: true, transcriptVisible: true, companionCopy,
  });
  Object.assign(runtime.style, { width: '544px', height: '620px' });
  await waitFor(() => Boolean(runtime.querySelector('.flower-composer-more-button')));
  const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  await userEvent.fill(editor, 'Retained draft 中文');
  expect(runtime.querySelectorAll('[data-flower-composer-inline-item]')).toHaveLength(0);
  expect(runtime.querySelector('.flower-working-directory-control')).toBeNull();
  await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-composer-more-button')!);
  await waitFor(() => Boolean(document.querySelector('[data-flower-composer-more-item="permission"] .flower-permission-trigger')));
  await userEvent.click(document.querySelector<HTMLButtonElement>('[data-flower-composer-more-item="permission"] .flower-permission-trigger')!);
  await waitFor(() => Boolean(document.querySelector('.flower-permission-menu-item[data-permission-type="full_access"]')));
  await userEvent.click(document.querySelector<HTMLButtonElement>('.flower-permission-menu-item[data-permission-type="full_access"]')!);
  await waitFor(() => document.querySelector('[data-flower-composer-more-item="permission"] .flower-permission-selector')?.getAttribute('data-permission-type') === 'full_access');
  expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
  expect(editor.value).toBe('Retained draft 中文');
  expect(runtime.querySelectorAll('[data-flower-composer-inline-item]')).toHaveLength(0);
  await userEvent.fill(editor, 'Retained draft 中文');
  await userEvent.keyboard('{Enter}');
  await waitFor(() => vi.mocked(source.launchTurn).mock.calls.length > 0);
  expect(source.launchTurn).toHaveBeenCalledWith(expect.objectContaining({ working_dir: '/workspace', permission_type: 'full_access' }));
});

it('treats a measured zero-width control viewport as no space rather than restoring every control', async () => {
  await page.viewport(1280, 900);
  const runtime = renderSurfaceWithAdapterProps(adapter(true), {});
  Object.assign(runtime.style, { width: '800px', height: '620px' });
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-inline-item]')));
  const controls = runtime.querySelector<HTMLElement>('.flower-composer-controls-viewport')!;
  controls.style.flex = '0 0 0px';
  controls.style.width = '0px';
  await waitFor(() => controls.getBoundingClientRect().width === 0);
  await frame(); await frame(); await frame();
  expect(runtime.querySelectorAll('[data-flower-composer-inline-item]')).toHaveLength(0);
  expect(runtime.querySelector('.flower-composer-more-button')).not.toBeNull();
});
