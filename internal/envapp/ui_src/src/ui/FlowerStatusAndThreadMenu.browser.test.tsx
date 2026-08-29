import '../index.css';
import './flower-feature.css';

import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  FlowerThreadListItem,
  FlowerThreadReadStatus,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { FlowerProgressIndicator, type FlowerProgressIndicatorState } from '../../../../flower_ui/src/chat/FlowerProgressIndicator';
import { FlowerThreadList } from '../../../../flower_ui/src/threads/FlowerThreadList';

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
}>;
const disposers: Array<() => void> = [];

afterEach(async () => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
  await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
});

async function nextFrame(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function readStatus(): FlowerThreadReadStatus {
  return {
    is_unread: false,
    snapshot: {
      activity_revision: 1,
      last_message_at_unix_ms: 1,
      activity_signature: 'status:running',
    },
    read_state: {
      last_seen_activity_revision: 1,
      last_read_message_at_unix_ms: 1,
      last_seen_activity_signature: 'status:running',
    },
  };
}

function thread(overrides: Partial<FlowerThreadListItem> = {}): FlowerThreadListItem {
  return {
    thread_id: 'thread-menu',
    title: 'Live task',
    title_status: 'ready',
    model_id: 'default/model',
    working_dir: '/workspace/redeven',
    pinned: false,
    created_at_ms: 1,
    updated_at_ms: 1,
    preview: '',
    status: 'running',
    source_label: 'this host',
    target_labels: [],
    read_status: readStatus(),
    ...overrides,
  };
}

describe('Flower status motion and thread menu', () => {
  it('runs continuously for one run and honors reduced motion', async () => {
    await page.viewport(640, 360);
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [progress, setProgress] = createSignal<FlowerProgressIndicatorState>({
      kind: 'waiting_response',
      runID: 'run-1',
    });
    const [label, setLabel] = createSignal('Thinking...');
    disposers.push(render(() => (
      <FlowerProgressIndicator
        progress={progress()}
        label={label()}
      />
    ), host));
    await nextFrame();

    const indicator = host.querySelector('.flower-model-status-indicator') as HTMLElement;
    const flower = indicator.querySelector('.flower-model-status-flower') as HTMLElement;
    const dots = indicator.querySelector<HTMLElement>('.flower-model-status-dots');
    expect(getComputedStyle(flower).animationName).toBe('flower-model-status-flower-twirl');
    expect(getComputedStyle(flower).animationPlayState).toBe('running');
    expect(dots).not.toBeNull();
    expect(dots?.textContent).toBe('...');
    expect(getComputedStyle(dots!).animationName).toBe('flower-model-status-dots-reveal');
    const flowerAnimation = flower.getAnimations()[0];
    const dotsAnimation = dots!.getAnimations()[0];
    const firstTransform = getComputedStyle(flower).transform;
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(getComputedStyle(flower).transform).not.toBe(firstTransform);
    const flowerTimeBeforePhase = Number(flowerAnimation?.currentTime ?? 0);
    const dotsTimeBeforePhase = Number(dotsAnimation?.currentTime ?? 0);

    batch(() => {
      setProgress({ kind: 'streaming', runID: 'run-1' });
      setLabel('Replying...');
    });
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(host.querySelector('.flower-model-status-indicator')).toBe(indicator);
    expect(flower.getAnimations()[0]).toBe(flowerAnimation);
    expect(dots!.getAnimations()[0]).toBe(dotsAnimation);
    expect(Number(flowerAnimation?.currentTime ?? 0)).toBeGreaterThan(flowerTimeBeforePhase);
    expect(Number(dotsAnimation?.currentTime ?? 0)).toBeGreaterThan(dotsTimeBeforePhase);

    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    await nextFrame();
    expect(getComputedStyle(flower).animationName).toBe('none');
    expect(getComputedStyle(dots!).animationName).toBe('none');
  });

  it('keeps the real floating menu open across live thread metadata updates', async () => {
    await page.viewport(800, 600);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [items, setItems] = createSignal<readonly FlowerThreadListItem[]>([thread()]);
    disposers.push(render(() => (
      <FlowerThreadList
        items={items()}
        activeThreadID="thread-menu"
        query=""
        onQueryChange={() => undefined}
        onSelect={() => undefined}
        onRefresh={() => undefined}
        onMenuAction={() => undefined}
        canFork
        canRename
        canPin
      />
    ), host));
    await nextFrame();

    (host.querySelector('[data-flower-thread-card]') as HTMLElement).dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 120,
    }));
    await nextFrame();
    const menu = document.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();

    setItems([thread({ title: 'Updated live task', status: 'waiting_approval', updated_at_ms: 2 })]);
    await nextFrame();

    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(menu?.getAttribute('aria-label')).toContain('Updated live task');
  });

  it('hides the pending label while thread actions are focused', async () => {
    await page.viewport(800, 600);
    const host = document.createElement('div');
    document.body.appendChild(host);
    disposers.push(render(() => (
      <FlowerThreadList
        items={[thread({ status: 'waiting_approval' })]}
        activeThreadID="thread-menu"
        query=""
        onQueryChange={() => undefined}
        onSelect={() => undefined}
        onRefresh={() => undefined}
        onMenuAction={() => undefined}
        canFork
        canRename
        canPin
      />
    ), host));
    await nextFrame();

    const card = host.querySelector('[data-flower-thread-card]') as HTMLElement;
    const select = card.querySelector('.flower-thread-card-select-button') as HTMLButtonElement;
    const indicator = card.querySelector('.flower-thread-card-approval-indicator') as HTMLElement;
    const menuButton = card.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;
    await userEvent.unhover(card);
    await nextFrame();
    expect(select.getAttribute('aria-label')).toContain('Waiting for approval');
    expect(getComputedStyle(indicator).visibility).toBe('visible');

    menuButton.focus();
    await nextFrame();
    await new Promise((resolve) => window.setTimeout(resolve, 180));

    expect(getComputedStyle(indicator).visibility).toBe('hidden');
    expect(getComputedStyle(menuButton).opacity).toBe('1');
    expect(Number(getComputedStyle(menuButton).zIndex)).toBeGreaterThan(Number(getComputedStyle(indicator).zIndex));
  });
});
