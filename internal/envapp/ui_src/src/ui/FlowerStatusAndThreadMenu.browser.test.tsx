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
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
  emulateTouchInput: (enabled: boolean) => Promise<void>;
}>;
const disposers: Array<() => void> = [];

afterEach(async () => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
  await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  await mediaCommands.emulateTouchInput(false);
});

async function nextFrame(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function readStatus(): FlowerThreadReadStatus {
  return {
    is_unread: false,
    snapshot: { activity_revision: 1 },
    read_state: { last_seen_activity_revision: 1 },
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

  it('keeps the real floating menu open across live metadata updates and row replacement', async () => {
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

    const originalCard = host.querySelector('[data-flower-thread-card]');
    setItems([thread({ title: 'Updated live task', status: 'waiting_approval', pinned: true, updated_at_ms: 2 })]);
    await nextFrame();

    expect(document.querySelector('[role="menu"]')).toBe(menu);
    expect(menu?.getAttribute('aria-label')).toContain('Updated live task');
    expect(host.querySelector('[data-flower-thread-card]')).toBe(originalCard);
    expect(originalCard?.isConnected).toBe(true);
  });

  it('uses one stable menu contract for pointer, button, and keyboard entry', async () => {
    await page.viewport(800, 600);
    const host = document.createElement('div');
    document.body.appendChild(host);
    disposers.push(render(() => (
      <FlowerThreadList
        items={[thread()]}
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
    const selectButton = card.querySelector('.flower-thread-card-select-button') as HTMLButtonElement;
    const menuButton = card.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;
    const listScroll = host.querySelector('.flower-scroll') as HTMLElement;

    for (let iteration = 0; iteration < 3; iteration += 1) {
      card.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120 + iteration,
        clientY: 120 + iteration,
      }));
      await nextFrame();
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
      window.dispatchEvent(new Event('scroll'));
      await nextFrame();
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await nextFrame();
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(selectButton);
    }

    menuButton.click();
    await nextFrame();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await nextFrame();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(menuButton);

    menuButton.click();
    await nextFrame();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    listScroll.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    listScroll.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 20 }));
    await nextFrame();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(menuButton);

    selectButton.focus();
    selectButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await nextFrame();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(selectButton);
  });

  it.each(['waiting_user', 'waiting_approval'] as const)('shows the %s label and yields its space to hovered or focused actions', async (status) => {
    await page.viewport(800, 600);
    const host = document.createElement('div');
    document.body.appendChild(host);
    disposers.push(render(() => (
      <FlowerThreadList
        items={[thread({ status })]}
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
    const indicator = card.querySelector('.flower-thread-card-action-indicator') as HTMLElement;
    const menuButton = card.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;
    const time = card.querySelector('.flower-thread-card-time') as HTMLElement;
    await userEvent.unhover(card);
    await nextFrame();
    expect(select.getAttribute('aria-label')).toContain(DEFAULT_FLOWER_SURFACE_COPY.threadList.statuses[status]);
    expect(getComputedStyle(indicator).visibility).toBe('visible');
    expect(getComputedStyle(time).visibility).toBe('hidden');

    await userEvent.hover(card);
    expect(getComputedStyle(indicator).visibility).toBe('hidden');
    await userEvent.unhover(card);
    expect(getComputedStyle(indicator).visibility).toBe('visible');

    menuButton.focus();
    await nextFrame();
    await new Promise((resolve) => window.setTimeout(resolve, 180));

    expect(getComputedStyle(indicator).visibility).toBe('hidden');
    expect(getComputedStyle(menuButton).opacity).toBe('1');
    expect(Number(getComputedStyle(menuButton).zIndex)).toBeGreaterThan(Number(getComputedStyle(indicator).zIndex));

    menuButton.blur();
    await nextFrame();
    expect(getComputedStyle(indicator).visibility).toBe('visible');
  });

  it.each([false, true])('fits long titles and localized action labels with touch=%s', async (touch) => {
    await page.viewport(800, 600);
    await mediaCommands.emulateTouchInput(touch);
    expect(matchMedia('(pointer: coarse)').matches).toBe(touch);
    const host = document.createElement('div');
    host.style.width = '240px';
    document.body.appendChild(host);
    const title = 'A long conversation title that must leave room for the action label';
    const label = 'En attente de votre réponse à la question';
    const copy = DEFAULT_FLOWER_SURFACE_COPY.threadList;
    disposers.push(render(() => <FlowerThreadList
      items={[thread({ title, status: 'waiting_user' })]}
      copy={{ ...copy, statuses: { ...copy.statuses, waiting_user: label } }}
      query="" onQueryChange={() => undefined} onSelect={() => undefined} onRefresh={() => undefined}
      onMenuAction={() => undefined} canPin
    />, host));
    await nextFrame();
    const card = host.querySelector<HTMLElement>('[data-flower-thread-card]')!;
    await userEvent.unhover(card);
    const badge = card.querySelector<HTMLElement>('.flower-thread-card-action-badge')!;
    const titleElement = card.querySelector<HTMLElement>('.flower-thread-list-title')!;
    const button = card.querySelector<HTMLElement>('.flower-thread-card-select-button')!;
    const menu = card.querySelector<HTMLElement>('.flower-thread-card-menu-button')!;
    expect(button.getAttribute('aria-label')).toBe(`${title}, ${label}`);
    expect(getComputedStyle(badge).textOverflow).toBe('ellipsis');
    expect(titleElement.scrollWidth).toBeGreaterThan(titleElement.clientWidth);
    expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(card.getBoundingClientRect().right);
    if (touch) {
      expect(getComputedStyle(menu).opacity).toBe('1');
      expect(badge.getBoundingClientRect().right).toBeLessThanOrEqual(menu.getBoundingClientRect().left);
    }
  });
});
