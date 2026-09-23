import '../../index.css';
import { Suspense, createResource } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { afterEach, expect, it, vi } from 'vitest';
import { redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';

const gate = vi.hoisted(() => ({ pending: Promise.resolve('ready') }));
function ColdBody() {
  const [value] = createResource(() => gate.pending);
  return <div data-loaded-widget>{value()}</div>;
}
vi.mock('../pages/EnvCodespacesPage', () => ({ EnvCodespacesPage: ColdBody }));
vi.mock('../pages/EnvContainersPage', () => ({ EnvContainersPage: ColdBody }));
vi.mock('../pages/EnvHostApplicationsPage', () => ({ EnvHostApplicationsPage: ColdBody }));
vi.mock('../pages/EnvPortForwardsPage', () => ({ EnvPortForwardsPage: ColdBody }));
vi.mock('../widgets/RemoteFileBrowser', () => ({ RemoteFileBrowser: ColdBody }));
vi.mock('../widgets/RuntimeMonitorPanel', () => ({ RuntimeMonitorPanel: ColdBody }));
vi.mock('../widgets/TerminalPanel', () => ({ TerminalPanel: ColdBody }));
vi.mock('../pages/EnvContext', async importOriginal => ({
  ...await importOriginal<typeof import('../pages/EnvContext')>(),
  useEnvContext: () => ({ env_id: () => 'continuity-environment' }),
}));
vi.mock('./EnvWorkbenchInstancesContext', () => ({
  useEnvWorkbenchInstancesContext: () => ({}),
}));
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); document.body.replaceChildren(); });

it.each(['files', 'terminal', 'monitor', 'codespaces', 'ports', 'applications', 'containers'])(
  'keeps a cold %s widget inside its own loading boundary without replacing the surrounding canvas', async page => {
    let finish!: (value: string) => void;
    gate.pending = new Promise(resolve => { finish = resolve; });
    const host = document.createElement('div');
    document.body.append(host);
    const body = redevenWorkbenchWidgets.find(widget => widget.type === `redeven.${page}`)!.body;
    cleanups.push(render(() => <FloeConfigProvider><LayoutProvider>
      <Suspense fallback={<div data-canvas-replaced />}>
        <input data-warm-draft value="Keep this draft" />
        <div style={{ width: '900px', height: '600px' }}>
          <Dynamic component={body} widgetId="cold-widget" title="Cold widget" type={`redeven.${page}`} selected lifecycle="warm" />
        </div>
      </Suspense>
    </LayoutProvider></FloeConfigProvider>, host));
    await vi.waitFor(() => expect(host.querySelector('[aria-busy="true"]')).not.toBeNull());
    const draft = host.querySelector<HTMLInputElement>('[data-warm-draft]')!;
    expect(draft).not.toBeNull();
    expect(host.querySelector('[data-canvas-replaced]')).toBeNull();
    expect(host.querySelector('.redeven-loading-curtain')).toBeNull();
    finish('ready');
    await vi.waitFor(() => expect(host.querySelector('[data-loaded-widget]')?.textContent).toBe('ready'));
    expect(host.querySelector('[data-warm-draft]')).toBe(draft);
    expect(draft.value).toBe('Keep this draft');
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
  },
);
