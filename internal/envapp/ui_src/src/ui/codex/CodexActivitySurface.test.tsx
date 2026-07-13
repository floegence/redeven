// @vitest-environment jsdom

import { createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleState = vi.hoisted(() => ({
  providerMounts: 0,
  providerCleanups: 0,
  pageMounts: 0,
  pageCleanups: 0,
  sidebarMounts: 0,
  sidebarCleanups: 0,
}));

vi.mock('./CodexFeatureProvider', () => ({
  CodexFeatureProvider: (props: Readonly<{ children: JSX.Element }>) => {
    onMount(() => {
      lifecycleState.providerMounts += 1;
    });
    onCleanup(() => {
      lifecycleState.providerCleanups += 1;
    });
    return <section data-testid="codex-provider">{props.children}</section>;
  },
}));

vi.mock('./CodexPage', () => ({
  CodexPage: () => {
    onMount(() => {
      lifecycleState.pageMounts += 1;
    });
    onCleanup(() => {
      lifecycleState.pageCleanups += 1;
    });
    return <main data-testid="codex-page" />;
  },
}));

vi.mock('./CodexSidebar', () => ({
  CodexSidebar: () => {
    onMount(() => {
      lifecycleState.sidebarMounts += 1;
    });
    onCleanup(() => {
      lifecycleState.sidebarCleanups += 1;
    });
    return <aside data-testid="codex-sidebar" />;
  },
}));

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  lifecycleState.providerMounts = 0;
  lifecycleState.providerCleanups = 0;
  lifecycleState.pageMounts = 0;
  lifecycleState.pageCleanups = 0;
  lifecycleState.sidebarMounts = 0;
  lifecycleState.sidebarCleanups = 0;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CodexActivitySurface', () => {
  it('moves one mounted sidebar between recreated shell hosts without remounting the provider or page', async () => {
    const appHost = document.createElement('div');
    const firstSidebarHost = document.createElement('div');
    const secondSidebarHost = document.createElement('div');
    document.body.append(appHost, firstSidebarHost, secondSidebarHost);

    const [sidebarHost, setSidebarHost] = createSignal<HTMLElement | null>(null);
    const { CodexActivitySurface } = await import('./CodexActivitySurface');
    const dispose = render(() => <CodexActivitySurface sidebarHost={sidebarHost} />, appHost);

    try {
      await flushEffects();

      const page = appHost.querySelector('[data-testid="codex-page"]');
      expect(page).toBeTruthy();
      expect(document.body.querySelector('[data-testid="codex-sidebar"]')).toBeNull();
      expect(lifecycleState.providerMounts).toBe(1);
      expect(lifecycleState.pageMounts).toBe(1);
      expect(lifecycleState.sidebarMounts).toBe(1);

      setSidebarHost(firstSidebarHost);
      await flushEffects();

      const sidebar = firstSidebarHost.querySelector('[data-testid="codex-sidebar"]');
      expect(sidebar).toBeTruthy();

      setSidebarHost(null);
      await flushEffects();

      expect(firstSidebarHost.querySelector('[data-testid="codex-sidebar"]')).toBeNull();
      expect(document.body.contains(sidebar)).toBe(false);
      expect(appHost.querySelector('[data-testid="codex-page"]')).toBe(page);
      expect(lifecycleState.providerCleanups).toBe(0);
      expect(lifecycleState.pageCleanups).toBe(0);
      expect(lifecycleState.sidebarCleanups).toBe(0);

      setSidebarHost(secondSidebarHost);
      await flushEffects();

      expect(secondSidebarHost.querySelector('[data-testid="codex-sidebar"]')).toBe(sidebar);
      expect(appHost.querySelector('[data-testid="codex-page"]')).toBe(page);
      expect(lifecycleState.providerMounts).toBe(1);
      expect(lifecycleState.pageMounts).toBe(1);
      expect(lifecycleState.sidebarMounts).toBe(1);
    } finally {
      dispose();
    }

    expect(lifecycleState.providerCleanups).toBe(1);
    expect(lifecycleState.pageCleanups).toBe(1);
    expect(lifecycleState.sidebarCleanups).toBe(1);
  });
});
