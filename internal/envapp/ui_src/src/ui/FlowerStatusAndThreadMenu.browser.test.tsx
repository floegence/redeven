import '../index.css';
import './flower-feature.css';

import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  FlowerModelIOStatus,
  FlowerThreadListItem,
  FlowerThreadReadStatus,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { FlowerModelStatusIndicator } from '../../../../flower_ui/src/chat/FlowerModelStatusIndicator';
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
    const [status, setStatus] = createSignal<FlowerModelIOStatus>({
      phase: 'waiting_response',
      run_id: 'run-1',
      updated_at_ms: 1,
    });
    const [label, setLabel] = createSignal('Thinking...');
    disposers.push(render(() => (
      <FlowerModelStatusIndicator
        status={status()}
        label={label()}
        threadID="thread-1"
        activeRunID="run-1"
        running
      />
    ), host));
    await nextFrame();

    const indicator = host.querySelector('.flower-model-status-indicator') as HTMLElement;
    const flower = indicator.querySelector('.flower-model-status-flower') as HTMLElement;
    const dots = Array.from(indicator.querySelectorAll<HTMLElement>('.flower-model-status-dot'));
    expect(getComputedStyle(flower).animationName).toBe('flower-model-status-flower-twirl');
    expect(getComputedStyle(flower).animationPlayState).toBe('running');
    expect(dots).toHaveLength(3);
    expect(dots.every((dot) => getComputedStyle(dot).animationName === 'flower-model-status-dot-bounce')).toBe(true);
    const firstTransform = getComputedStyle(flower).transform;
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(getComputedStyle(flower).transform).not.toBe(firstTransform);

    batch(() => {
      setStatus({ phase: 'streaming', run_id: 'run-1', updated_at_ms: 2 });
      setLabel('Replying...');
    });
    await nextFrame();
    expect(host.querySelector('.flower-model-status-indicator')).toBe(indicator);

    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    await nextFrame();
    expect(getComputedStyle(flower).animationName).toBe('none');
    expect(dots.every((dot) => getComputedStyle(dot).animationName === 'none')).toBe(true);
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
});
