import '../index.css';
import './flower-feature.css';

import { commands, page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FlowerChatMessage } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  activityItem,
  activityTimeline,
  adapter,
  liveBootstrap,
  renderSurfaceWithAdapter,
  subagentSummary,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
}>;

function textMessage(index: number): FlowerChatMessage {
  return {
    id: `text-${index}`,
    turn_id: `turn-${index}`,
    role: 'assistant',
    content: `Context line ${index}: ${'stable transcript content '.repeat(5)}`,
    status: 'complete',
    created_at_ms: index + 1,
  };
}

function subagentMessage(
  itemID: string,
  targets: readonly Readonly<{ thread_id: string; task_name: string; task_description: string; status: string }>[],
  createdAt: number,
): FlowerChatMessage {
  const turnID = `turn-${itemID}`;
  return {
    id: `message-${itemID}`,
    turn_id: turnID,
    role: 'assistant',
    content: '',
    status: 'complete',
    created_at_ms: createdAt,
    blocks: [activityTimeline({
      thread_id: 'thread-subagent-disclosure',
      run_id: turnID,
      turn_id: turnID,
      status: 'running',
      items: [activityItem({
        item_id: itemID,
        tool_id: itemID,
        tool_name: 'subagents',
        renderer: 'subagent_operation',
        status: 'running',
        label: 'subagents',
        payload: {
          action: 'wait',
          targets,
          requested_count: targets.length,
          completed_count: 0,
        },
      })],
    })],
  };
}

function fixtureThread() {
  const targets = [
    { thread_id: 'thread-big-tech', task_name: 'Big Tech AI News', task_description: 'Research company news.', status: 'running' },
    { thread_id: 'thread-models', task_name: 'AI Models and Products', task_description: 'Research model releases.', status: 'running' },
    { thread_id: 'thread-policy', task_name: 'AI Policy and Business', task_description: 'Research policy news.', status: 'running' },
  ] as const;
  return thread({
    thread_id: 'thread-subagent-disclosure',
    title: 'Subagent disclosure motion',
    status: 'running',
    messages: [
      ...Array.from({ length: 10 }, (_, index) => textMessage(index)),
      subagentMessage('wait-one', targets.slice(0, 1), 20),
      ...Array.from({ length: 8 }, (_, index) => textMessage(index + 20)),
      subagentMessage('wait-three', targets, 40),
    ],
    subagents: targets.map((target, index) => subagentSummary({
      parent_thread_id: 'thread-subagent-disclosure',
      ...target,
      created_at_ms: 100 + index,
      updated_at_ms: 200 + index,
    })),
  });
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function mountFixture() {
  const snapshot = fixtureThread();
  const runtime = renderSurfaceWithAdapter({
    ...adapter(true),
    listThreads: vi.fn(async () => [snapshot]),
    loadThread: vi.fn(async () => liveBootstrap(snapshot, 1)),
  });
  await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${snapshot.thread_id}"] button`)));
  (runtime.querySelector(`[data-thread-id="${snapshot.thread_id}"] button`) as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="wait-three"]')));
  return {
    runtime,
    transcript: runtime.querySelector('.flower-chat-transcript') as HTMLDivElement,
  };
}

async function sampleDisclosure(
  runtime: HTMLElement,
  transcript: HTMLDivElement,
  itemID: string,
): Promise<Readonly<{ titleOffsets: readonly number[]; heights: readonly number[]; scrollTops: readonly number[] }>> {
  const row = runtime.querySelector(`[data-flower-activity-item-id="${itemID}"]`) as HTMLDivElement;
  const button = row.querySelector('.flower-activity-inline-button') as HTMLButtonElement;
  const titleTop = button.getBoundingClientRect().top;
  button.click();
  await waitFor(() => Boolean(row.querySelector('.flower-activity-inline-details')));
  const titleOffsets: number[] = [];
  const heights: number[] = [];
  const scrollTops: number[] = [];
  for (let index = 0; index < 32; index += 1) {
    await nextFrame();
    titleOffsets.push(button.getBoundingClientRect().top - titleTop);
    heights.push((row.querySelector('.flower-activity-inline-details') as HTMLDivElement).getBoundingClientRect().height);
    scrollTops.push(transcript.scrollTop);
  }
  return { titleOffsets, heights, scrollTops };
}

function maximumStep(values: readonly number[]): number {
  return values.reduce((maximum, value, index) => (
    index === 0 ? maximum : Math.max(maximum, Math.abs(value - values[index - 1]!))
  ), 0);
}

afterEach(async () => {
  document.documentElement.classList.remove('dark');
  await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
});

describe('Flower Subagent disclosure motion', () => {
  it('uses one disclosure guide without adding a rail to every subagent', async () => {
    await page.viewport(1100, 720);
    const { runtime } = await mountFixture();
    const row = runtime.querySelector('[data-flower-activity-item-id="wait-three"]') as HTMLDivElement;
    const button = row.querySelector('.flower-activity-inline-button') as HTMLButtonElement;
    button.click();
    await waitFor(() => Boolean(row.querySelector('.flower-activity-inline-details-content')));

    const content = row.querySelector('.flower-activity-inline-details-content') as HTMLDivElement;
    const items = [...row.querySelectorAll<HTMLElement>('.flower-activity-subagents-item')];
    expect(getComputedStyle(content).borderLeftWidth).toBe('1px');
    expect(items).toHaveLength(3);
    expect(items.every((item) => getComputedStyle(item).borderLeftWidth === '0px')).toBe(true);
    expect(items.every((item) => getComputedStyle(item).paddingLeft === '0px')).toBe(true);
  });

  it('keeps one and three-target titles anchored through continuous open and close motion', async () => {
    await page.viewport(1100, 720);
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    const { runtime, transcript } = await mountFixture();
    const transcriptBounds = transcript.getBoundingClientRect();

    const oneButton = runtime.querySelector('[data-flower-activity-item-id="wait-one"] .flower-activity-inline-button') as HTMLButtonElement;
    transcript.scrollTop += oneButton.getBoundingClientRect().top - (transcriptBounds.top + transcript.clientHeight / 2);
    await nextFrame();
    const one = await sampleDisclosure(runtime, transcript, 'wait-one');
    expect(Math.max(...one.titleOffsets.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(one.heights[0]).toBeLessThan(one.heights.at(-1)!);
    expect(one.heights.every((height, index) => index === 0 || height + 0.5 >= one.heights[index - 1]!)).toBe(true);
    expect(maximumStep(one.heights)).toBeLessThan(32);

    const oneRow = runtime.querySelector('[data-flower-activity-item-id="wait-one"]') as HTMLDivElement;
    const oneTop = oneButton.getBoundingClientRect().top;
    oneButton.click();
    for (let index = 0; index < 28; index += 1) {
      await nextFrame();
      expect(Math.abs(oneButton.getBoundingClientRect().top - oneTop)).toBeLessThanOrEqual(1);
    }
    await waitFor(() => oneRow.querySelector('.flower-activity-inline-details') === null);

    transcript.scrollTop = transcript.scrollHeight;
    await nextFrame();
    const three = await sampleDisclosure(runtime, transcript, 'wait-three');
    expect(Math.max(...three.titleOffsets.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(three.heights[0]).toBeLessThan(three.heights.at(-1)!);
    expect(three.heights.every((height, index) => index === 0 || height + 0.5 >= three.heights[index - 1]!)).toBe(true);
    expect(maximumStep(three.heights)).toBeLessThan(32);
    expect(maximumStep(three.scrollTops)).toBeLessThan(32);
  });

  it('yields the viewport anchor to manual scrolling and uses an immediate stable height for reduced motion', async () => {
    await page.viewport(1100, 720);
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    const { runtime, transcript } = await mountFixture();
    transcript.scrollTop = transcript.scrollHeight;
    await nextFrame();

    const row = runtime.querySelector('[data-flower-activity-item-id="wait-three"]') as HTMLDivElement;
    const button = row.querySelector('.flower-activity-inline-button') as HTMLButtonElement;
    button.click();
    await waitFor(() => Boolean(row.querySelector('.flower-activity-inline-details')));
    for (let index = 0; index < 4; index += 1) await nextFrame();
    transcript.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    transcript.scrollTop = Math.max(0, transcript.scrollTop - 80);
    const manualScrollTop = transcript.scrollTop;
    for (let index = 0; index < 28; index += 1) await nextFrame();
    expect(Math.abs(transcript.scrollTop - manualScrollTop)).toBeLessThanOrEqual(1);

    button.click();
    await waitFor(() => row.querySelector('.flower-activity-inline-details') === null);
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    const titleTop = button.getBoundingClientRect().top;
    button.click();
    await waitFor(() => row.getAttribute('data-state') === 'open');
    const panel = row.querySelector('.flower-activity-inline-details') as HTMLDivElement;
    const content = row.querySelector('.flower-activity-inline-details-content') as HTMLDivElement;
    expect(Math.abs(button.getBoundingClientRect().top - titleTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(panel.getBoundingClientRect().height - content.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    expect(panel.getAnimations()).toHaveLength(0);
  });
});
