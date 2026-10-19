import '../index.css';
import './flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { afterEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapterProps, subagentDetail, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const media = commands as unknown as {
  emulateMediaPreferences: (input: { forcedColors: 'active' | 'none' }) => Promise<void>;
  emulateTouchInput: (enabled: boolean) => Promise<void>;
};
const tick = String.fromCharCode(96);
const report = '已核对原始来源、发布时间与 API 边界。\n完整回报保留原文内容。\n' + '每一项结论都应保留完整证据。\n'.repeat(8);
const markdown = '## 调研结果\n\n正文保持原有阅读尺度，**保留原始强调**与 [原始链接](https://example.com/source)。\n\n' +
  '| 类型 | 状态 | 说明 |\n| --- | --- | --- |\n| Agent | 已完成 | 完整核对资料与发布日期 |\n| Tool | 等待输入 | ' + tick + 'wake_on_agent_messages' + tick + ' |';
afterEach(async () => {
  await media.emulateMediaPreferences({ forcedColors: 'none' });
  await media.emulateTouchInput(false);
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.classList.remove('light', 'dark');
});
function theme(name: string, material = 'standard') {
  const preset = builtInShellThemePresets.find(item => item.name === name)!;
  const root = document.documentElement;
  root.classList.toggle('light', preset.mode === 'light'); root.classList.toggle('dark', preset.mode === 'dark');
  root.dataset.floeShellTheme = name; root.dataset.floeSurfaceStyle = material;
}
function element(host: ParentNode, selector: string): HTMLElement {
  const value = host.querySelector<HTMLElement>(selector); expect(value, selector).not.toBeNull(); return value!;
}
async function mount() {
  const child = subagentSummary({ parent_thread_id: 'type-parent', thread_id: 'type-child', task_name: 'Source quality review', status: 'completed' });
  const baseDetail = subagentDetail({ summary: child });
  const detail = { ...baseDetail, current: { ...baseDetail.current, activity: 'idle' as const, last_outcome: 'completed' as const, items: baseDetail.current.items!.map(item => item.kind === 'assistant' ? { ...item, text: markdown, live: false } : item.kind === 'tool' ? (() => {
    const { label, description, renderer, payload, chips, target_refs, ...facts } = item.activity!;
    return { ...item, activity: { ...facts, status: 'success', presentation: { label, description, renderer, payload, chips, target_refs } } };
  })() : item) } };
  const source = thread({ thread_id: 'type-parent', title: 'Flower reading hierarchy', subagents: [child], parent_events: {
    thread_id: 'type-parent', first_event_id: 'report', last_event_id: 'input_required', events: ['report', 'completed', 'failed', 'input_required'].map(kind => ({
      id: kind, parent_thread_id: 'type-parent', source_thread_id: child.thread_id, source_turn_id: 'child-turn-1', source_run_id: 'child-run-1',
      source_entry_id: 'entry-' + kind, kind: kind as 'report' | 'completed' | 'failed' | 'input_required', received_at: '2026-10-18T10:18:00Z', admitted: false,
      ...(kind === 'report' ? { message: report } : {}),
    })),
  }, messages: [{ id: 'type-answer', turn_id: 'type-turn', run_id: 'type-run', role: 'assistant', status: 'complete', content: markdown, created_at_ms: 1,
    blocks: [{ type: 'markdown', content: markdown }, activityTimeline({ thread_id: 'type-parent', turn_id: 'type-turn', run_id: 'type-run', items: [
      activityItem({ item_id: 'query', tool_id: 'query', tool_name: 'threads.query', renderer: 'structured', label: 'Search conversations', started_at_unix_ms: 1000, ended_at_unix_ms: 3500,
        payload: { inputs: [{ title: 'query', content: 'release', format: 'text' }], rows_provided: true,
          rows: [{ title: 'Original release notes', meta: 'assistant', content: '已核对版本、时间和完整上下文。', format: 'text' }] } }),
      ...(['error', 'pending', 'running', 'canceled'] as const).map(status => activityItem({ item_id: status, tool_id: status, tool_name: 'threads.query', renderer: 'structured', label: status + ' search', status, ...(status === 'error' ? { payload: { error: { message: 'The requested source is unavailable.', code: 'source_unavailable' } } } : {}) })),
    ] })] }] });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [source], loadThread: async () => liveBootstrap(source), loadSubagentDetail: async () => detail },
    { focusThreadRequest: { request_id: 'typography', thread_id: source.thread_id } });
  runtime.style.height = '950px';
  await waitFor(() => Boolean(runtime.querySelector('[data-parent-event-body]')) && Boolean(runtime.querySelector('[data-flower-activity-item-id="query"]')));
  element(runtime, '[data-flower-activity-item-id="query"] [data-flower-disclosure-trigger]').click();
  element(runtime, '.flower-parent-event-disclosure').click();
  element(runtime, '[data-flower-activity-item-id="error"] [data-flower-disclosure-trigger]').click();
  await waitFor(() => Boolean(runtime.querySelector('.flower-activity-preview-text')) && runtime.querySelector('[data-flower-activity-item-id="query"] .flower-activity-inline-details')?.getAttribute('data-state') === 'open');
  return runtime;
}
function contrast(first: string, second: string) {
  const context = document.createElement('canvas').getContext('2d')!;
  const luminance = (color: string) => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
      const n = channel / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const a = luminance(first), b = luminance(second); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function background(node: HTMLElement): string {
  const context = document.createElement('canvas').getContext('2d')!;
  const layers: number[][] = [];
  for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(ancestor).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    layers.push([...context.getImageData(0, 0, 1, 1).data]);
  }
  const rgb = layers.reverse().reduce((under, layer) => under.map((channel, index) => channel * (1 - layer[3] / 255) + layer[index] * layer[3] / 255), [255, 255, 255]);
  return 'rgb(' + rgb.join(',') + ')';
}
const roles = [
  ['.flower-chat-md-block p', 14, 24.5], ['.flower-chat-md-block table', 13, 20],
  ['.flower-activity-inline-title', 13, 20], ['.flower-activity-inline-duration', 12, 18],
  ['.flower-activity-error-message', 13, 21], ['.flower-activity-inline-details', 12, 20], ['.flower-activity-preview-text', 12, 20],
  ['.flower-parent-event-heading', 12, 18], ['.flower-parent-event-body', 13, 21], ['.flower-parent-event-action', 12, 18],
] as const;
it('keeps prose at 14px with smaller tables and consistent tool/report roles in the real surface', async () => {
  await page.viewport(1280, 1000); theme('porcelain-light'); const runtime = await mount();
  for (const [selector, size, line] of roles) {
    const style = getComputedStyle(element(runtime, selector)); expect(style.fontSize, selector).toBe(size + 'px');
    expect(parseFloat(style.lineHeight), selector).toBeCloseTo(line);
  }
  expect(getComputedStyle(element(runtime, '.flower-activity-error-message')).fontWeight).toBe('400');
  expect(getComputedStyle(element(runtime, 'table code')).fontSize).toBe('12.48px');
  expect(getComputedStyle(element(runtime, 'td')).paddingTop).toBe('8px');
  expect(getComputedStyle(element(runtime, 'td + td')).paddingLeft).toBe('12px');
  expect(element(runtime, '[data-parent-event-body]').textContent).toBe(report);
  const source = element(runtime, '.flower-parent-event-source');
  expect(source.title).toBe(source.textContent);
  const trigger = element(runtime, '[data-flower-activity-item-id="query"] button');
  trigger.focus(); await userEvent.keyboard('{Tab}{Shift>}{Tab}{/Shift}');
  expect(document.activeElement).toBe(trigger); expect(getComputedStyle(trigger).outlineStyle).toBe('solid');
  expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
  await media.emulateTouchInput(true); expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
});
it.each(['standard', 'soft-neumorphic'])('keeps actual tools and parent events readable across every theme with %s material', async material => {
  await page.viewport(1100, 1000); const runtime = await mount();
  const selectors = [...roles.map(([selector]) => selector), '.flower-activity-preview-meta', '.flower-parent-event-source',
    '.flower-parent-event-heading time', '.flower-parent-event-status', ...['success', 'error', 'pending', 'running', 'canceled'].map(state => '.flower-activity-inline-row-' + state + ' .flower-activity-inline-icon')];
  for (const preset of builtInShellThemePresets) {
    theme(preset.name, material);
    for (const selector of selectors) for (const node of runtime.querySelectorAll<HTMLElement>(selector)) {
      if (node.matches('.flower-activity-inline-details') && node.dataset.state !== 'open') continue;
      expect.soft(contrast(getComputedStyle(node).color, background(node)), preset.name + '/' + material + ': ' + selector).toBeGreaterThanOrEqual(4.5);
      expect.soft(getComputedStyle(node).opacity, selector).toBe('1');
    }
  }
});
it.each(['porcelain-light', 'classic-dark', 'solarized-light'])('renders the complete design with real components in %s', async name => {
  await page.viewport(1100, 1000); theme(name); const runtime = await mount();
  await page.screenshot({ element: runtime, path: '__screenshots__/flower-typography/production-' + name + '.png' });
  element(runtime, '.flower-parent-event-source').click(); await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript .flower-chat-md-block p')));
  await waitFor(() => document.querySelector<HTMLElement>('.flower-subagent-detail-window')?.dataset.floatingPresence === 'open');
  const ledger = element(document, '.flower-subagent-detail-window');
  expect(getComputedStyle(element(ledger, '.flower-subagent-detail-overview-meta')).fontSize).toBe('12px');
  expect(getComputedStyle(element(ledger, '.flower-activity-inline-title')).fontSize).toBe('13px');
  expect(getComputedStyle(element(ledger, '.flower-activity-inline-title')).fontFamily).toBe(getComputedStyle(element(runtime, '.flower-activity-inline-title')).fontFamily);
  expect(getComputedStyle(element(ledger, '.flower-chat-md-block p')).fontSize).toBe('14px');
  for (const preset of builtInShellThemePresets) {
    theme(preset.name);
    for (const selector of ['.flower-subagent-detail-overview-meta', '.flower-subagent-status-label', '.flower-activity-inline-title', '.flower-chat-md-block p']) {
      for (const node of ledger.querySelectorAll<HTMLElement>(selector)) expect.soft(contrast(getComputedStyle(node).color, background(node)), preset.name + ': ' + selector).toBeGreaterThanOrEqual(4.5);
    }
  }
  theme(name); await Promise.all(ledger.getAnimations().map(animation => animation.finished));
  await page.screenshot({ element: ledger, path: '__screenshots__/flower-typography/subagent-' + name + '.png' });
});
it.each([320, 390])('keeps the actual surface within %i px at normal and doubled text sizes', async width => {
  await page.viewport(width, 1000); theme('porcelain-light'); const runtime = await mount();
  for (const scale of [1, 2]) {
    document.documentElement.style.fontSize = 16 * scale + 'px'; expect(runtime.scrollWidth).toBeLessThanOrEqual(width);
    for (const selector of ['.flower-chat-md-block', '.flower-parent-event', '.flower-activity-inline-details-content']) {
      for (const node of runtime.querySelectorAll<HTMLElement>(selector)) {
        expect(node.scrollWidth, selector).toBeLessThanOrEqual(node.clientWidth + 1);
      }
    }
  }
});
it('uses native forced-color text and visible keyboard focus for activity controls', async () => {
  await page.viewport(1100, 1000); const runtime = await mount(); await media.emulateMediaPreferences({ forcedColors: 'active' });
  const probe = document.createElement('span'); probe.style.color = 'CanvasText'; runtime.append(probe);
  for (const selector of ['.flower-parent-event-body', '.flower-parent-event-status', '.flower-activity-inline-title']) expect(getComputedStyle(element(runtime, selector)).color).toBe(getComputedStyle(probe).color);
  const trigger = element(runtime, '[data-flower-activity-item-id="query"] button');
  trigger.focus(); await userEvent.keyboard('{Tab}{Shift>}{Tab}{/Shift}'); expect(getComputedStyle(trigger).outlineStyle).toBe('solid');
});
