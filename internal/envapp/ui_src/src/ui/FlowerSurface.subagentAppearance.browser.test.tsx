import '../index.css';
import './flower-feature.css';

import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowerSubagentDetail } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, subagentDetail, subagentSummary, thread, waitFor } from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  document.documentElement.classList.remove('dark', 'light');
});

describe('Subagent identity and reading surfaces', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`keeps avatars consistent and a clear transcript in ${theme} mode`, async () => {
      await page.viewport(1440, 1000);
      document.documentElement.classList.add(theme);
      const names = ['Source Quality Review', 'Agent Research Blogs', 'Agent Product Updates', 'Agent Projects'];
      const descriptions = ['Check the original sources, release dates, and scope of each claim.', 'Collect recent engineering posts about AI agents and developer tools.', 'Review product releases and highlight verified changes.', 'Research open source agent projects and compare their recent progress.'];
      const summaries = names.map((name, index) => subagentSummary({
        parent_thread_id: 'thread-avatar-parent',
        thread_id: `thread-avatar-child-${index}`,
        task_name: name,
        title: name,
        task_description: descriptions[index],
        status: index === 0 ? 'running' : index === 1 ? 'waiting_input' : index === 2 ? 'completed' : 'failed',
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
      await waitFor(() => presented && runtime.querySelector('.flower-header-icon-badge')?.textContent === '4');
      const trigger = runtime.querySelector('button[aria-controls="flower-subagents-dropdown"]') as HTMLButtonElement;
      trigger.click();
      await waitFor(() => document.querySelectorAll('[data-flower-subagent-row]').length === 4);
      const rows = [...document.querySelectorAll<HTMLButtonElement>('[data-flower-subagent-row]')];
      expect(rows.every((row) => row.querySelector('svg') && !row.querySelector('canvas'))).toBe(true);
      expect(rows.every((row) => getComputedStyle(row.querySelector<HTMLElement>('[data-flower-subagent-avatar]')!).borderRadius === '50%')).toBe(true);
      const first = rows.find((row) => row.dataset.flowerSubagentStatus === 'running')!;
      const identity = first.querySelector<HTMLElement>('[data-flower-subagent-avatar]')!;
      expect(identity.querySelector('svg')?.innerHTML).toContain('<circle cx="32" cy="32" r="32"');
      expect(identity.querySelector('svg')?.innerHTML).not.toContain('<rect width="64" height="64" rx="20"');
      await page.screenshot({ element: document.querySelector('.flower-subagents-dropdown')!, path: `__screenshots__/subagent-appearance/list-${theme}.png` });
      first.click();
      await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-transcript')));
      const windowSurface = document.querySelector<HTMLElement>('.flower-subagent-detail-window')!;
      const avatar = windowSurface.querySelector<HTMLElement>('[data-flower-subagent-avatar]')!;
      expect(avatar.dataset.flowerSubagentAvatar).toBe(identity.dataset.flowerSubagentAvatar);
      expect(avatar.dataset.flowerSubagentAvatarPalette).toBe(identity.dataset.flowerSubagentAvatarPalette);
      expect(getComputedStyle(avatar).borderRadius).toBe('50%');
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
