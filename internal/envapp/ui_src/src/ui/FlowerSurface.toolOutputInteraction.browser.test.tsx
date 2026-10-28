import '../index.css';
import './flower-feature.css';
import { expect, it, onTestFinished } from 'vitest';
import { commands, page } from 'vitest/browser';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { PersistentFloatingWindow } from './widgets/PersistentFloatingWindow';
import { streamingFixture } from '../../../../flower_ui/testing/streamingFixture';
import { renderSurfaceWithAdapter, waitFor } from './FlowerSurface.navigation.testHarness';

it.each(['release', 'cancel', 'blur'] as const)('defers terminal output layout during native drag and converges after %s', async ending => {
  await page.viewport(1280, 900);
  const fixture = streamingFixture(72, 20);
  const source = fixture.current();
  fixture.replace({ ...source, run_progress: { phase: 'tool_execution' }, items: source.items?.map(item => item.id !== 'tool-0' ? item : {
    ...item, activity: { ...item.activity, status: 'running', presentation: { renderer: 'terminal', label: 'Build workspace',
      payload: { operation: 'exec', command: 'build workspace', process_id: 'build-process', output: 'Build started\n', first_seq: 1, last_seq: 1 } } },
  }) });
  let reads = 0;
  let output = 'Build started\n';
  const runtime = renderSurfaceWithAdapter({ ...fixture.adapter, readTerminalProcess: async () => {
    reads++;
    const chunk = `Build batch ${reads}\n${'Compiler diagnostic output\n'.repeat(4000)}`;
    output += chunk;
    return { process_id: 'build-process', status: 'running', output: chunk, first_seq: reads + 1, last_seq: reads + 1, latest_seq: reads + 1, has_more: false };
  } });
  runtime.style.height = '780px';
  await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${fixture.thread.thread_id}"] button`)));
  runtime.querySelector<HTMLButtonElement>(`[data-thread-id="${fixture.thread.thread_id}"] button`)!.click();
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-0"]')));
  const row = runtime.querySelector('[data-flower-activity-item-id="tool-0"]')!;
  const toggle = row.querySelector<HTMLButtonElement>('.flower-activity-inline-button')!;
  if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
  await waitFor(() => Boolean(row.querySelector('pre')?.textContent?.includes('Build batch 1')));
  const pre = row.querySelector('pre')!;
  const textNode = pre.firstChild;
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <PersistentFloatingWindow open onOpenChange={() => undefined} title="Build preview"
      persistenceKey={`tool-output-${ending}`} defaultPosition={{ x: 100, y: 120 }} defaultSize={{ width: 420, height: 300 }}>
      <div data-test-streaming-preview><textarea aria-label="Build preview draft" value="Preserved build edit" /></div>
    </PersistentFloatingWindow>
  </LayoutProvider></FloeConfigProvider>, host);
  onTestFinished(dispose);
  await waitFor(() => Boolean(document.querySelector('[aria-label="Build preview draft"]')));
  const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="Build preview draft"]')!;
  editor.value = 'Preserved build edit'; editor.setSelectionRange(2, 8);
  let outputPaints = 0;
  const observer = new MutationObserver(records => {
    if (document.documentElement.getAttribute('data-floe-hot-interaction') === 'drag') outputPaints += records.length;
  });
  observer.observe(pre, { subtree: true, characterData: true, childList: true });
  onTestFinished(() => observer.disconnect());
  const initialReads = reads;
  const result = await (commands as unknown as { dragStreamingPreview(ending: string): Promise<{ positions: number[] }> }).dragStreamingPreview(ending);
  observer.disconnect();
  expect(reads).toBeGreaterThan(initialReads);
  expect(outputPaints).toBe(0);
  expect(new Set(result.positions).size).toBeGreaterThanOrEqual(20);
  await waitFor(() => pre.textContent === output);
  expect(pre.firstChild).toBe(textNode);
  expect(pre.textContent).toContain(`Build batch ${reads}`);
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Build preview draft"]')?.value).toBe('Preserved build edit');
  expect(editor.selectionStart).toBe(2); expect(editor.selectionEnd).toBe(8);
  expect(fixture.calls.connections).toBe(1);
  console.info('tool-output-preview', { ending, readsDuringDrag: reads - initialReads, outputPaints, outputCharacters: output.length });
});


it.each(['release', 'cancel', 'blur'] as const)('keeps streaming progress live while shimmer yields to native drag (%s)', async ending => {
  await page.viewport(1280, 900);
  const fixture = streamingFixture(72, 20);
  const base = fixture.current();
  fixture.replace({ ...base, view_version: 2, sampled_at_ms: Date.now(), run_progress: { phase: 'streaming', request: {
    logical_request_id: 'drag-progress', attempt_id: 'drag-attempt', attempt_epoch: 1,
    started_at: new Date().toISOString(), first_output_at: new Date().toISOString(), estimated_output_tokens: 128,
  } } });
  const runtime = renderSurfaceWithAdapter(fixture.adapter);
  runtime.style.height = '780px';
  await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="' + fixture.thread.thread_id + '"] button')));
  runtime.querySelector<HTMLButtonElement>('[data-thread-id="' + fixture.thread.thread_id + '"] button')!.click();
  await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-text[data-floe-progress-shimmer]')));
  const status = runtime.querySelector<HTMLElement>('.flower-model-status-text')!;
  const animation = status.getAnimations().find(value => (value as CSSAnimation).animationName === 'floe-progress-shimmer')!;
  expect(animation.playState).toBe('running');
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <PersistentFloatingWindow open onOpenChange={() => undefined} title="Live progress preview"
      persistenceKey={'progress-drag-' + ending} defaultPosition={{ x: 100, y: 120 }} defaultSize={{ width: 420, height: 300 }}>
      <div data-test-streaming-preview><textarea aria-label="Live progress draft" value="Keep this edit" /></div>
    </PersistentFloatingWindow>
  </LayoutProvider></FloeConfigProvider>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="Live progress draft"]')!;
  editor.setSelectionRange(2, 6);
  let additions = 0;
  const update = setInterval(() => { fixture.append(' live' + (++additions)); }, 16);
  onTestFinished(() => clearInterval(update));
  const samples: { paused: boolean; same: boolean; tokens: string }[] = [];
  let frame = 0;
  const observe = () => {
    if (document.documentElement.getAttribute('data-floe-hot-interaction') === 'drag') {
      samples.push({ paused: animation.playState === 'paused', same: status.getAnimations().includes(animation),
        tokens: runtime.querySelector('.flower-model-status-metric')!.textContent! });
    }
    frame = requestAnimationFrame(observe);
  };
  frame = requestAnimationFrame(observe);
  onTestFinished(() => cancelAnimationFrame(frame));
  const result = await (commands as unknown as { dragStreamingPreview(ending: string): Promise<{ positions: number[] }> }).dragStreamingPreview(ending);
  clearInterval(update); cancelAnimationFrame(frame);
  expect(samples.length).toBeGreaterThan(10);
  expect(samples.every(sample => sample.paused && sample.same)).toBe(true);
  expect(new Set(samples.map(sample => sample.tokens)).size).toBeGreaterThan(1);
  expect(new Set(result.positions).size).toBeGreaterThanOrEqual(20);
  await waitFor(() => runtime.querySelector('[data-flower-message-id="streaming-tail"]')!.textContent!.includes('live' + additions));
  await waitFor(() => animation.playState === 'running');
  expect(runtime.querySelector('.flower-model-status-text')).toBe(status);
  expect(status.getAnimations()).toContain(animation);
  expect(editor.value).toBe('Keep this edit');
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 6]);
  expect(fixture.calls.connections).toBe(1);
});
