import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerLiveStreamEnvelope, FlowerSubagentDetail } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, subagentDetail, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  document.documentElement.classList.remove('dark', 'light');
});

describe('Subagent identity and reading surfaces', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`keeps avatars consistent and a clear transcript in ${theme} mode`, async () => {
      await page.viewport(1440, 1000);
      document.documentElement.classList.add(theme);
      const names = ['Source Quality Review', 'Agent Research Blogs', 'Agent Product Updates', 'Agent Projects', 'Agent Changelog'];
      const descriptions = ['Check the original sources, release dates, and scope of each claim.', 'Collect recent engineering posts about AI agents and developer tools.', 'Review product releases and highlight verified changes.', 'Research open source agent projects and compare their recent progress.', 'Summarize the verified changes.'];
      const summaries = names.map((name, index) => subagentSummary({
        parent_thread_id: 'thread-avatar-parent',
        thread_id: `thread-avatar-child-${index}`,
        task_name: name,
        title: name,
        task_description: descriptions[index],
        status: index === 0 ? 'running' : index === 1 ? 'waiting_input' : index === 3 ? 'failed' : 'completed',
        created_at_ms: Date.now() - 176_000,
        updated_at_ms: Date.now(),
      }));
      const snapshot = thread({ thread_id: 'thread-avatar-parent', title: 'Agent research', status: 'running', subagents: summaries, messages: [] });
      const base = subagentDetail({ summary: summaries[0]! });
      const detail: FlowerSubagentDetail = { ...base, current: { ...base.current, run_progress: { phase: 'streaming' }, items: [
        { id: 'mission', turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: 1, kind: 'user', created_at: new Date().toISOString(), text: '## Delegated mission\nCheck source quality and scope for the latest AI agent report.\n\n### Research approach\nRead original sources, distinguish release notes from plans, and link the evidence.' },
        { id: 'findings', turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: 2, kind: 'assistant', created_at: new Date().toISOString(), text: '## Source review\nThe release notes and original repositories agree on the current feature set.\n\n- Verified dates against the original changelogs.\n- Checked the documented API boundaries.\n- Kept uncertain rollout claims separate from confirmed releases.\n\n### Next step\nReview the remaining engineering posts and return a concise evidence summary.' },
      ] } };
      let presented = false;
      const runtime = renderSurfaceWithAdapterProps({
        ...adapter(true),
        listThreads: vi.fn(async () => [snapshot]),
        loadThread: vi.fn(async () => liveBootstrap(snapshot, 1)),
        loadSubagentDetail: vi.fn(async () => detail),
      }, { onThreadSelectionEvent: (event) => { if (event.phase === 'content_presented') presented = true; } });
      runtime.style.height = '900px';
      await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-avatar-parent"] button')));
      (runtime.querySelector('[data-thread-id="thread-avatar-parent"] button') as HTMLButtonElement).click();
      await waitFor(() => presented && runtime.querySelector('.flower-header-icon-badge')?.textContent === '5');
      const trigger = runtime.querySelector('button[aria-controls="flower-subagents-dropdown"]') as HTMLButtonElement;
      trigger.click();
      await waitFor(() => document.querySelectorAll('[data-flower-subagent-row]').length === 2);
      const disclosure = document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]')!;
      expect(disclosure.getAttribute('aria-expanded')).toBe('false');
      const previews = [...disclosure.querySelectorAll<HTMLElement>('[data-flower-subagent-avatar]')];
      expect(previews).toHaveLength(2);
      expect(previews.every((avatar) => getComputedStyle(avatar).borderRadius === '50%')).toBe(true);
      expect(disclosure.querySelector('.flower-subagents-dropdown-overflow')?.textContent).toBe('+1');
      expect(disclosure.querySelector('.flower-subagents-dropdown-failed-count')?.textContent).toContain('Failed');
      await page.screenshot({ element: document.querySelector('.flower-subagents-dropdown')!, path: '__screenshots__/subagent-appearance/collapsed-' + theme + '.png' });
      await page.viewport(320, 750);
      const dropdown = document.querySelector<HTMLElement>('.flower-subagents-dropdown')!;
      await waitFor(() => dropdown.getBoundingClientRect().right <= 320);
      expect(dropdown.scrollWidth).toBeLessThanOrEqual(dropdown.clientWidth + 1);
      expect(disclosure.scrollWidth).toBeLessThanOrEqual(disclosure.clientWidth + 1);
      await page.screenshot({ element: dropdown, path: '__screenshots__/subagent-appearance/collapsed-narrow-' + theme + '.png' });
      await page.viewport(1440, 1000);
      disclosure.click();
      await waitFor(() => document.querySelectorAll('[data-flower-subagent-row]').length === 5);
      expect(disclosure.querySelector('.flower-subagents-dropdown-avatar-summary')).toBeNull();
      for (const preview of previews) {
        const expandedAvatar = document.querySelector('[data-flower-subagent-group="completed"] [data-flower-subagent-avatar="' + preview.dataset.flowerSubagentAvatar + '"]');
        expect(expandedAvatar?.innerHTML).toBe(preview.innerHTML);
      }
      const rows = [...document.querySelectorAll<HTMLButtonElement>('[data-flower-subagent-row]')];
      expect(rows.every((row) => row.querySelector('svg') && !row.querySelector('canvas'))).toBe(true);
      expect(rows.every((row) => getComputedStyle(row.querySelector<HTMLElement>('[data-flower-subagent-avatar]')!).borderRadius === '28%')).toBe(true);
      const first = rows.find((row) => row.dataset.flowerSubagentStatus === 'running')!;
      const identity = first.querySelector<HTMLElement>('[data-flower-subagent-avatar]')!;
      expect(identity.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 100 100');
      await page.screenshot({ element: document.querySelector('.flower-subagents-dropdown')!, path: `__screenshots__/subagent-appearance/list-${theme}.png` });
      first.click();
      await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript')));
      const windowSurface = document.querySelector<HTMLElement>('.flower-subagent-detail-window')!;
      const avatar = windowSurface.querySelector<HTMLElement>('[data-flower-subagent-avatar]')!;
      expect(avatar.dataset.flowerSubagentAvatar).toBe(identity.dataset.flowerSubagentAvatar);
      expect(avatar.querySelector('svg')?.innerHTML).toBe(identity.querySelector('svg')?.innerHTML);
      expect(getComputedStyle(avatar).borderRadius).toBe('28%');
      expect(windowSurface.querySelector('canvas[data-thinking-orb-state]')).toBeNull();
      const ledger = windowSurface.querySelector<HTMLElement>('.flower-subagent-ledger')!;
      expect(getComputedStyle(ledger, '::before').content).toBe('none');
      expect(windowSurface.scrollWidth).toBeLessThanOrEqual(windowSurface.clientWidth + 1);
      await page.screenshot({ element: windowSurface, path: `__screenshots__/subagent-appearance/detail-${theme}.png` });

      await page.viewport(540, 800);
      await waitFor(() => windowSurface.getBoundingClientRect().width < 540);
      expect(windowSurface.scrollWidth).toBeLessThanOrEqual(windowSurface.clientWidth + 1);
      expect(avatar.getBoundingClientRect().width).toBeGreaterThanOrEqual(36);
      await page.screenshot({ element: windowSurface, path: `__screenshots__/subagent-appearance/detail-narrow-${theme}.png` });
    });
  }
});

it('preserves disclosure choice during live updates and keeps keyboard focus on visible controls', async () => {
  await page.viewport(1100, 850);
  const children = [0, 1, 2, 3].map((index) => subagentSummary({
    parent_thread_id: 'disclosure-parent', thread_id: 'disclosure-child-' + index,
    task_name: 'Task ' + index, status: 'completed', updated_at_ms: 500 + index,
  }));
  const parent = thread({ thread_id: 'disclosure-parent', subagents: [children[0]!] });
  let emit: ((value: FlowerLiveStreamEnvelope | null) => void) | undefined;
  const runtime = renderSurfaceWithAdapterProps({
    ...adapter(true), listThreads: vi.fn(async () => [parent]), loadThread: vi.fn(async () => liveBootstrap(parent)),
    async *connectLiveStream({ signal }) {
      yield { schema_version: 1, kind: 'ready', summaries: [parent] };
      while (!signal.aborted) {
        const event = await new Promise<FlowerLiveStreamEnvelope | null>((resolve) => {
          emit = resolve;
          signal.addEventListener('abort', () => resolve(null), { once: true });
        });
        if (!event) return;
        emit = undefined;
        yield event;
      }
    },
  }, { focusThreadRequest: { request_id: 'focus-disclosure', thread_id: parent.thread_id } });
  runtime.style.height = '800px';
  const push = async (subagents: typeof children) => {
    await waitFor(() => emit !== undefined);
    emit!({ schema_version: 1, kind: 'thread.batch', thread_id: parent.thread_id, subagents });
    await waitFor(() => Number(runtime.querySelector('.flower-header-icon-badge')?.textContent ?? 0) === subagents.length);
  };
  await waitFor(() => runtime.querySelector('.flower-header-icon-badge')?.textContent === '1');
  const trigger = runtime.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!;
  trigger.click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-disclosure]')));
  let disclosure = document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]')!;
  await waitFor(() => document.activeElement === disclosure);
  expect(document.querySelectorAll('[data-flower-subagent-row]')).toHaveLength(0);
  expect(disclosure.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(1);
  expect(disclosure.querySelector('.flower-subagents-dropdown-overflow')).toBeNull();
  expect(document.getElementById(disclosure.getAttribute('aria-controls')!)?.hidden).toBe(true);
  await push(children.slice(0, 2));
  expect(disclosure.querySelectorAll('[data-flower-subagent-avatar]')).toHaveLength(2);
  expect(disclosure.querySelector('.flower-subagents-dropdown-overflow')).toBeNull();
  await userEvent.keyboard('{Enter}');
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(disclosure);
  expect(document.querySelectorAll('[data-flower-subagent-row]')).toHaveLength(2);
  await push(children.slice(0, 3));
  expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelectorAll('[data-flower-subagent-row]')).toHaveLength(3);
  await userEvent.keyboard('{ArrowDown}');
  const first = document.querySelector<HTMLButtonElement>('[data-flower-subagent-row]')!;
  expect(document.activeElement).toBe(first);
  await userEvent.keyboard('{End}');
  expect(document.activeElement).toBe([...document.querySelectorAll('[data-flower-subagent-row]')].at(-1));
  await userEvent.keyboard('{Home}');
  expect(document.activeElement).toBe(disclosure);
  await userEvent.keyboard(' ');
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelectorAll('[data-flower-subagent-row]')).toHaveLength(0);
  expect(disclosure.querySelector('.flower-subagents-dropdown-overflow')?.textContent).toBe('+1');
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(disclosure);
  await push(children);
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  expect(disclosure.querySelector('.flower-subagents-dropdown-overflow')?.textContent).toBe('+2');
  await userEvent.keyboard('{Enter}');
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[data-flower-subagent-disclosure]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  trigger.click();
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-disclosure]')));
  disclosure = document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]')!;
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  await push([{ ...children[0]!, status: 'running' }]);
  await waitFor(() => document.querySelectorAll('[data-flower-subagent-row]').length === 1);
  expect(document.querySelector('[data-flower-subagent-disclosure]')).toBeNull();
  const activeRow = document.querySelector<HTMLButtonElement>('[data-flower-subagent-row]')!;
  activeRow.focus();
  const avatar = activeRow.querySelector('[data-flower-subagent-avatar]')!.innerHTML;
  await push([children[0]!]);
  await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-disclosure]')));
  disclosure = document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]')!;
  await waitFor(() => document.activeElement === disclosure);
  expect(disclosure.querySelector('[data-flower-subagent-avatar]')?.innerHTML).toBe(avatar);
  expect(disclosure.getAttribute('aria-expanded')).toBe('false');
  await push([]);
  await waitFor(() => Boolean(document.querySelector('.flower-subagents-dropdown-empty')));
  expect(document.querySelector('[data-flower-subagent-disclosure]')).toBeNull();
});
