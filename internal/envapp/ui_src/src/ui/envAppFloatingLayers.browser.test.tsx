import '../index.css';

import { page, userEvent } from 'vitest/browser';
import { Show, createSignal, type JSX } from 'solid-js';
import { Portal, render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';

import { EnvAppFloatingWindowStackProvider } from './context/EnvAppFloatingWindowStackContext';
import { ENV_APP_FLOATING_LAYER } from './utils/envAppLayers';
import { PersistentFloatingWindow } from './widgets/PersistentFloatingWindow';

function Providers(props: Readonly<{ children: JSX.Element }>) {
  return (
    <FloeConfigProvider>
      <LayoutProvider>
        <EnvAppFloatingWindowStackProvider>{props.children}</EnvAppFloatingWindowStackProvider>
      </LayoutProvider>
    </FloeConfigProvider>
  );
}

function LayerSurface(props: Readonly<{
  testId: string;
  zIndex: number;
  visible: boolean;
}>) {
  return (
    <Show when={props.visible}>
      <Portal>
      <div
        data-testid={props.testId}
        style={{
          position: 'fixed',
          left: '160px',
          top: '160px',
          width: '260px',
          height: '180px',
          'z-index': props.zIndex,
        }}
      />
      </Portal>
    </Show>
  );
}

function FloatingLayerHarness() {
  const [flowerVisible, setFlowerVisible] = createSignal(false);
  const [panelVisible, setPanelVisible] = createSignal(false);
  const [modalVisible, setModalVisible] = createSignal(false);
  const [commandVisible, setCommandVisible] = createSignal(false);

  return (
    <Providers>
      <div style={{ position: 'fixed', left: '16px', top: '16px', display: 'flex', gap: '8px' }}>
        <button type="button" onClick={() => setFlowerVisible(true)}>Show Flower</button>
        <button type="button" onClick={() => setPanelVisible(true)}>Show plugin Panel</button>
        <button type="button" onClick={() => setModalVisible(true)}>Show product modal</button>
        <button type="button" onClick={() => setCommandVisible(true)}>Show command palette</button>
      </div>

      <PersistentFloatingWindow
        open
        onOpenChange={() => undefined}
        title="First window"
        stackId="browser-layer-first"
        defaultPosition={{ x: 100, y: 100 }}
        defaultSize={{ width: 280, height: 220 }}
      >
        <div data-testid="first-window-content">First</div>
      </PersistentFloatingWindow>
      <PersistentFloatingWindow
        open
        onOpenChange={() => undefined}
        title="Second window"
        stackId="browser-layer-second"
        defaultPosition={{ x: 140, y: 140 }}
        defaultSize={{ width: 280, height: 220 }}
      >
        <div data-testid="second-window-content">Second</div>
      </PersistentFloatingWindow>

      <LayerSurface
        testId="flower-layer"
        zIndex={ENV_APP_FLOATING_LAYER.flowerCompanion}
        visible={flowerVisible()}
      />
      <LayerSurface
        testId="plugin-panel-layer"
        zIndex={ENV_APP_FLOATING_LAYER.pluginPanel}
        visible={panelVisible()}
      />
      <LayerSurface
        testId="product-modal-layer"
        zIndex={ENV_APP_FLOATING_LAYER.productModal}
        visible={modalVisible()}
      />
      <LayerSurface
        testId="command-palette-layer"
        zIndex={ENV_APP_FLOATING_LAYER.commandPalette}
        visible={commandVisible()}
      />
    </Providers>
  );
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function hitTestId(x: number, y: number): string | undefined {
  const target = document.elementFromPoint(x, y) as HTMLElement | null;
  const directTestId = target?.closest<HTMLElement>('[data-testid]')?.dataset.testid;
  if (directTestId) return directTestId;
  return target
    ?.closest<HTMLElement>('[data-floe-geometry-surface="floating-window"]')
    ?.querySelector<HTMLElement>('[data-testid]')
    ?.dataset.testid;
}

afterEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

beforeEach(async () => {
  await page.viewport(1280, 800);
});

describe('Env App global floating layer contract', () => {
  it('uses click-ordered windows below Flower, plugin Panel, product modals, and command palette', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);
    render(() => <FloatingLayerHarness />, host);
    await settle();

    expect(hitTestId(200, 200)).toBe('second-window-content');

    const firstWindow = document.querySelector('[data-testid="first-window-content"]')
      ?.closest('[data-floe-geometry-surface="floating-window"]');
    if (!(firstWindow instanceof HTMLElement)) throw new Error('First floating window did not render.');
    const firstRect = firstWindow.getBoundingClientRect();
    await userEvent.click(document.elementFromPoint(firstRect.left + 12, firstRect.top + 12) as HTMLElement);
    await settle();
    expect(hitTestId(200, 200)).toBe('first-window-content');

    await page.getByRole('button', { name: 'Show Flower' }).click();
    await settle();
    expect(hitTestId(200, 200)).toBe('flower-layer');

    await page.getByRole('button', { name: 'Show plugin Panel' }).click();
    await settle();
    expect(hitTestId(200, 200)).toBe('plugin-panel-layer');

    await page.getByRole('button', { name: 'Show product modal' }).click();
    await settle();
    expect(hitTestId(200, 200)).toBe('product-modal-layer');

    await page.getByRole('button', { name: 'Show command palette' }).click();
    await settle();
    expect(hitTestId(200, 200)).toBe('command-palette-layer');
  });
});
