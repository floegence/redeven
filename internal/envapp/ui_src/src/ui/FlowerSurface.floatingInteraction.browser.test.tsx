import '../index.css';
import './flower-feature.css';
import { expect, it, onTestFinished } from 'vitest';
import { commands, page } from 'vitest/browser';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { PersistentFloatingWindow } from './widgets/PersistentFloatingWindow';
import { streamingFixture } from '../../../../flower_ui/testing/streamingFixture';
import { renderSurfaceWithAdapter, waitFor } from './FlowerSurface.navigation.testHarness';

it.each(['release', 'cancel', 'blur'] as const)('keeps a preview responsive during text streaming and converges after %s', async ending => {
  await page.viewport(1280, 900);
  const fixture = streamingFixture(72, 20);
  const runtime = renderSurfaceWithAdapter(fixture.adapter);
  runtime.style.height = '780px';
  await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${fixture.thread.thread_id}"] button`)));
  runtime.querySelector<HTMLButtonElement>(`[data-thread-id="${fixture.thread.thread_id}"] button`)!.click();
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="streaming-tail"]')));
  fixture.append('Initial text.');
  await waitFor(() => runtime.textContent?.includes('Initial text.') === true);
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <PersistentFloatingWindow open onOpenChange={() => undefined} title="Streaming preview"
      persistenceKey={`streaming-preview-${ending}`} defaultPosition={{ x: 100, y: 120 }} defaultSize={{ width: 420, height: 300 }}>
      <div data-test-streaming-preview><textarea aria-label="Preview draft" value="Preserved preview edit" />
        <div data-test-preview-scroll style={{ height: '100px', overflow: 'auto' }}>
          <div style={{ height: '1000px' }}>Scrollable preview content</div>
        </div>
      </div>
    </PersistentFloatingWindow>
  </LayoutProvider></FloeConfigProvider>, host);
  onTestFinished(dispose);
  await waitFor(() => Boolean(document.querySelector('[data-floe-floating-window-titlebar] h2')));
  const scroll = document.querySelector<HTMLElement>('[data-test-preview-scroll]')!; scroll.scrollTop = 120;
  const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="Preview draft"]')!;
  editor.value = 'User edit stays intact'; editor.setSelectionRange(2, 8);
  const tail = runtime.querySelector('[data-flower-message-id="streaming-tail"]')!;
  const painted = new Set<string>();
  const observer = new MutationObserver(() => painted.add(tail.textContent ?? ''));
  observer.observe(tail, { childList: true, characterData: true, subtree: true });
  let inputs = 0;
  const timer = setInterval(() => { fixture.append(` chunk-${++inputs}`); }, 8);
  onTestFinished(() => { clearInterval(timer); observer.disconnect(); });
  const result = await (commands as unknown as { dragStreamingPreview(ending: string): Promise<{ activeDuring: string; activeBeforeRelease: string | null; activeAfter: string | null; positions: number[] }> }).dragStreamingPreview(ending);
  clearInterval(timer); observer.disconnect();
  expect(result.activeDuring).toBe('drag');
  expect(result.activeBeforeRelease).toBe(ending === 'release' ? 'drag' : null);
  expect(result.activeAfter).toBeNull();
  expect(new Set(result.positions).size).toBeGreaterThanOrEqual(20);
  expect(inputs).toBeGreaterThan(24);
  expect(painted.size).toBeLessThan(inputs / 2);
  fixture.append(' Final release text.');
  await waitFor(() => tail.textContent?.includes('Final release text.') === true);
  expect(tail.textContent).toContain(`chunk-${inputs}`);
  expect(document.querySelector('[aria-label="Preview draft"]')).toBe(editor);
  expect(editor.value).toBe('User edit stays intact');
  expect(editor.selectionStart).toBe(2); expect(editor.selectionEnd).toBe(8);
  expect(scroll.scrollTop).toBe(120);
  expect(fixture.calls.connections).toBe(1);
  console.info('streaming-preview', { ending, inputs, textPaints: painted.size, movedFrames: new Set(result.positions).size });
});
