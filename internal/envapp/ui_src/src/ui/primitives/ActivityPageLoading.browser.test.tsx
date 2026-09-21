import '../../index.css';
import { createSignal, lazy } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { ActivityAppsMain } from '@floegence/floe-webapp-core/app';
import { afterEach, expect, it, vi } from 'vitest';
import { ActivityPageLoading } from './ActivityPageLoading';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); });

it('keeps cold page loading inside the selected Activity view and ignores late completion after leaving', async () => {
  let finish!: (value: { default: () => ReturnType<typeof Document> }) => void;
  const Document = () => <input aria-label="Retained document draft" />;
  const ColdPage = lazy(() => new Promise<{ default: typeof Document }>((resolve) => { finish = resolve; }));
  const [selected, setSelected] = createSignal('warm');
  const host = document.createElement('div');
  document.body.append(host);
  cleanups.push(render(() => <FloeConfigProvider><LayoutProvider>
    <button onClick={() => setSelected('warm')}>Warm page</button>
    <button onClick={() => setSelected('cold')}>Cold page</button>
    <ActivityAppsMain activeId={selected} activationMode="after-paint"
      renderFallback={() => <ActivityPageLoading />} views={[
        { id: 'warm', render: () => <input aria-label="Warm page draft" /> },
        { id: 'cold', render: () => <ColdPage /> },
      ]} />
  </LayoutProvider></FloeConfigProvider>, host));
  const warmInput = host.querySelector<HTMLInputElement>('[aria-label="Warm page draft"]')!;
  warmInput.value = 'Keep this draft';
  host.querySelectorAll('button')[1]!.click();
  await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading page…'));
  const cold = host.querySelector<HTMLElement>('[data-floe-keep-alive-view="cold"]')!;
  expect(cold.querySelector('[role="status"]')).not.toBeNull();
  host.querySelectorAll('button')[0]!.click();
  finish({ default: Document });
  await vi.waitFor(() => expect(cold.querySelector('input')).not.toBeNull());
  expect(cold.inert).toBe(true);
  expect(cold.style.display).toBe('none');
  expect(host.querySelector('[aria-label="Warm page draft"]')).toBe(warmInput);
  expect(warmInput.value).toBe('Keep this draft');
  expect(host.querySelector('[role="status"]')).toBeNull();
});
