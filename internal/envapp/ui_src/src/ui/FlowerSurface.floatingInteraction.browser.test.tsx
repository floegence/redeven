import '../index.css';
import './flower-feature.css';
import { expect, it, onTestFinished } from 'vitest';
import { commands, page } from 'vitest/browser';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { PersistentFloatingWindow } from './widgets/PersistentFloatingWindow';
import { streamingFixture } from '../../../../flower_ui/testing/streamingFixture';
import { renderSurfaceWithAdapter, waitFor } from './FlowerSurface.navigation.testHarness';

it.each((['release', 'cancel', 'blur'] as const).flatMap(ending =>
  (['text', 'tool-preview'] as const).map(source => ({ ending, source }))))('keeps a preview responsive during $source streaming and converges after $ending', async ({ ending, source }) => {
  await page.viewport(1280, 900);
  const fixture = streamingFixture(72, 20);
  if (source === 'tool-preview') {
    const current = fixture.current();
    fixture.replace({ ...current, view_version: 2, sampled_at_ms: Date.now(),
      run_progress: { phase: 'streaming', request: { logical_request_id: 'request', attempt_id: 'attempt', attempt_epoch: 1,
        started_at: new Date().toISOString(), first_output_at: new Date().toISOString(), estimated_output_tokens: 1 } },
      tool_call_previews: [{ thread_id: current.thread_id, turn_id: current.turn_id!, run_id: current.run_id!, logical_request_id: 'request',
        attempt_id: 'attempt', attempt_epoch: 1, call_id: 'preview', name: 'apply_patch', arguments_complete: false,
        preview: { display_name: 'build.ts', additions: 1 } }],
    });
  }
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
      persistenceKey={`streaming-preview-${source}-${ending}`} defaultPosition={{ x: 100, y: 120 }} defaultSize={{ width: 420, height: 300 }}>
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
  if (source === 'tool-preview') {
    expect(runtime.querySelector('[data-flower-argument-generation]')?.textContent).toContain(`+${fixture.current().tool_call_previews![0]!.preview!.additions}`);
  }
  expect(document.querySelector('[aria-label="Preview draft"]')).toBe(editor);
  expect(editor.value).toBe('User edit stays intact');
  expect(editor.selectionStart).toBe(2); expect(editor.selectionEnd).toBe(8);
  expect(scroll.scrollTop).toBe(120);
  expect(fixture.calls.connections).toBe(1);
  console.info('streaming-preview', { ending, source, inputs, textPaints: painted.size, movedFrames: new Set(result.positions).size });
});
