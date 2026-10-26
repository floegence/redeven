import '../index.css';
import './flower-feature.css';
import { For, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { FlowerToolIcon } from '../../../../flower_ui/src/FlowerToolIcon';
import { flowerToolMotion } from '../../../../flower_ui/src/flowerToolMotion';
import { FlowerActivityPreview } from '../../../../flower_ui/src/FlowerActivityPreview';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it('animates every tool type and restores static glyphs at settlement', async () => {
  await page.viewport(1100, 1000);
  const toolNames = Object.keys(flowerToolMotion);
  const [running, setRunning] = createSignal(true);
  const host = document.createElement('div');
  host.className = 'flower-activity-inline';
  host.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px 24px;padding:24px;background:var(--background);color:var(--foreground);font:12px sans-serif';
  document.body.append(host);
  const dispose = render(() => <For each={toolNames}>{name => <div style="display:flex;align-items:center;gap:12px;height:28px">
    <FlowerToolIcon toolName={name} running={running()} /><code>{name}</code>
    <span style="margin-left:auto;color:var(--flower-activity-tool-row-quiet)"><FlowerToolIcon toolName={name} running={false} /></span>
    <span style="color:var(--flower-activity-tool-row-quiet)"><FlowerToolIcon toolName={name} running={false} /></span>
  </div>}</For>, host);
  try {
    await waitFor(() => host.getAnimations({ subtree: true }).length > toolNames.length);
    const svgs = [...host.querySelectorAll('svg')];
    expect(svgs).toHaveLength(toolNames.length * 3 - 2);
    expect(host.querySelectorAll('.flower-activity-inline-loader')).toHaveLength(2);
    expect(host.querySelectorAll('.flower-activity-inline-loader-square')).toHaveLength(8);
    const animations = host.getAnimations({ subtree: true });
    const start = animations.map(animation => animation.effect?.getComputedTiming().duration as number);
    for (const phase of [0, 0.35, 0.7, 0.999]) {
      animations.forEach((animation, index) => { animation.pause(); animation.currentTime = start[index] * phase; });
      for (const svg of svgs) expect(svg.getBoundingClientRect().width).toBe(16);
      if (phase === 0.35) await page.screenshot({ element: host, path: '__screenshots__/flower-tool-icons.png' });
    }
    setRunning(false);
    expect(host.getAnimations({ subtree: true })).toHaveLength(0);
    expect(host.querySelectorAll('svg')).toHaveLength(toolNames.length * 3);
    expect(host.querySelector('.flower-activity-inline-loader')).toBeNull();
    expect(svgs.every(svg => svg.isConnected)).toBe(true);
    expect([...host.querySelectorAll('g')].every(group => !group.style.strokeDasharray && !group.style.opacity)).toBe(true);
  } finally { dispose(); host.remove(); }
});

it('uses the original staggered four-square command motion and honors reduced motion changes', async () => {
  const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  const host = document.createElement('div');
  document.body.append(host);
  const [running, setRunning] = createSignal(true);
  const dispose = render(() => <><FlowerToolIcon toolName="terminal.exec" running={running()} /><FlowerToolIcon toolName="terminal.read" running={running()} /></>, host);
  try {
    await waitFor(() => host.getAnimations({ subtree: true }).length === 8);
    const squares = [...host.querySelectorAll<HTMLElement>('.flower-activity-inline-loader-square')];
    expect(squares.slice(0, 4).map(square => getComputedStyle(square).animationDelay)).toEqual(['0s', '0.135s', '0.405s', '0.27s']);
    expect(squares.every(square => getComputedStyle(square).animationName === 'flower-activity-loader-square')).toBe(true);
    const animation = squares[0].getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const initial = getComputedStyle(squares[0]).transform;
    animation.currentTime = 675;
    expect(getComputedStyle(squares[0]).transform).not.toBe(initial);
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    await waitFor(() => host.getAnimations({ subtree: true }).length === 0);
    expect(squares.every(square => getComputedStyle(square).transform === 'none')).toBe(true);
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    await waitFor(() => host.getAnimations({ subtree: true }).length === 8);
    setRunning(false);
    expect(host.getAnimations({ subtree: true })).toHaveLength(0);
    const [exec, read] = host.querySelectorAll('svg');
    expect(exec.outerHTML).toBe(read.outerHTML);
  } finally { dispose(); host.remove(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference' }); }
});

it('keeps wrapped previews expandable even when the supplied text is short', async () => {
  const host = document.createElement('div');
  host.style.width = '160px';
  document.body.append(host);
  const dispose = render(() => <FlowerActivityPreview copy={DEFAULT_FLOWER_SURFACE_COPY.chat} block={{
    kind: 'structured_rows', section: 'results', rows: [{ title: 'Release', meta: '', format: 'text', content: 'Release is ready for review. The build and validation checks have passed. Additional details remain available when the preview is expanded.' }],
  }} />, host);
  try {
    await waitFor(() => Boolean(host.querySelector('.flower-activity-detail-expand')));
    const text = host.querySelector<HTMLElement>('.flower-activity-preview-text')!;
    expect(text.scrollHeight).toBeGreaterThan(text.clientHeight);
    host.querySelector<HTMLButtonElement>('.flower-activity-detail-expand')!.click();
    expect(text.scrollHeight).toBe(text.clientHeight);
  } finally { dispose(); host.remove(); }
});

it('shows skill inputs and expandable instructions without a repeated result heading', async () => {
  await page.viewport(1280, 900);
  const name = 'redeven-environment';
  const reason = 'Inspect the selected environment';
  const content = '# Redeven Environment\n\n' + Array.from({ length: 12 }, (_, index) => `Environment instruction ${index + 1}.`).join('\n\n');
  const seed = thread({ thread_id: 'skill-presentation', title: 'Skill presentation', messages: [{
    id: 'skill-message', turn_id: 'skill-turn', role: 'assistant', status: 'complete', content: '', created_at_ms: 2,
    blocks: [activityTimeline({ thread_id: 'skill-presentation', turn_id: 'skill-turn', run_id: 'skill-run', status: 'success', items: [
      activityItem({ item_id: 'skill', tool_id: 'skill', tool_name: 'use_skill', renderer: 'structured', label: name, payload: {
        inputs: [{ title: 'name', content: name, format: 'text' }, { title: 'reason', content: reason, format: 'text' }],
        rows_provided: true, rows: [{ title: name, meta: reason, content, format: 'markdown' }],
      } }),
    ] })],
  }] });
  const surface = renderSurfaceWithAdapter({ ...adapter(), listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed, 1) });
  surface.style.height = '100dvh';
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="skill-presentation"] button')));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="skill-presentation"] button')!.click();
  await waitFor(() => Boolean(surface.querySelector('[data-flower-disclosure-trigger]')));
  surface.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!.click();
  await waitFor(() => Boolean(surface.querySelector('[data-activity-section="results"] h1')));
  for (const width of [1280, 390]) {
    await page.viewport(width, 900);
    const inputs = surface.querySelector<HTMLElement>('[data-activity-section="inputs"]')!;
    const results = surface.querySelector<HTMLElement>('[data-activity-section="results"]')!;
    expect(inputs.textContent).toContain(name);
    expect(inputs.textContent).toContain(reason);
    expect(results.querySelector('.flower-activity-structured-row-heading')).toBeNull();
    expect(results.querySelector('h1')?.textContent).toBe('Redeven Environment');
    expect(results.textContent).toContain('Environment instruction 12.');
    const more = results.querySelector<HTMLButtonElement>('.flower-activity-detail-expand')!;
    more.click();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(results.querySelector('.flower-activity-detail-content')?.getAttribute('data-expanded')).toBe('true');
    const details = surface.querySelector<HTMLElement>('.flower-activity-inline-details-content')!;
    expect(details.scrollWidth).toBeLessThanOrEqual(details.clientWidth + 1);
    await page.screenshot({ element: surface, path: `__screenshots__/flower-skill-details-${width}.png` });
    more.click();
  }
  await page.viewport(1280, 900);
});

it('keeps production rows compact and reveals concise facts on desktop and mobile', async () => {
  const seed = thread({thread_id:'tool-presentation', title:'Tool presentation', messages:[{
    id:'tool-message',turn_id:'tool-turn',role:'assistant',status:'complete',content:'',created_at_ms:2,
    blocks:[activityTimeline({thread_id:'tool-presentation',turn_id:'tool-turn',run_id:'tool-run',status:'success',items:[
      activityItem({item_id:'query',tool_id:'query',tool_name:'threads.query',renderer:'structured',label:'Search conversations',started_at_unix_ms:1000,ended_at_unix_ms:3500,payload:{
        inputs:[{title:'query',content:'release',format:'text'},{title:'limit',content:'50',format:'text'}],
        rows_provided:true,rows:Array.from({length:8},(_,index)=>({title:`Release note ${index+1}`,meta:'assistant',content:'Release is ready for review.\nThe build and validation checks have passed.\nAdditional release details stay behind the preview.',format:'text'})),
      }}),
      activityItem({item_id:'edit',tool_id:'edit',tool_name:'tessiven.edit',renderer:'structured',label:'API service',started_at_unix_ms:5000,ended_at_unix_ms:6400,payload:{
        inputs:[{content:'-replicas: 1\n+replicas: 2',format:'code',language:'diff'}],
        rows_provided:true,rows:[{title:'API service',meta:'v3',content:'Updated replica count.',format:'text'}],
      }}),
    ]})],
  }]});
  const surface=renderSurfaceWithAdapter({...adapter(),listThreads:async()=>[seed],loadThread:async()=>liveBootstrap(seed,1)});
  surface.style.height = '100dvh';
  await waitFor(()=>Boolean(surface.querySelector('[data-thread-id="tool-presentation"] button')));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="tool-presentation"] button')!.click();
  await waitFor(()=>surface.querySelectorAll('[data-flower-activity-item-id] [data-flower-disclosure-trigger]').length===2);
  expect(surface.querySelector('.flower-activity-tool-identity')).toBeNull();
  expect(surface.querySelectorAll('.flower-activity-inline-duration')).toHaveLength(2);
  for (const width of [1280,390]) {
    await page.viewport(width,900);
    for (const trigger of surface.querySelectorAll<HTMLButtonElement>('[data-flower-disclosure-trigger]')) if(trigger.getAttribute('aria-expanded')!=='true') trigger.click();
    await waitFor(()=>surface.querySelectorAll('.flower-activity-inline-details-content').length===2);
    expect(surface.querySelector('.flower-activity-tool-identity')).toBeNull();
    expect(surface.textContent).toContain('Release is ready for review.');
    expect(surface.querySelectorAll('[data-flower-activity-item-id="edit"] .flower-activity-script-toggle')).toHaveLength(1);
    expect(surface.querySelectorAll('.flower-activity-section-label')).toHaveLength(0);
    const results=surface.querySelector<HTMLElement>('[data-flower-activity-item-id="query"] [data-activity-section="results"]')!;
    expect(results.querySelectorAll('.flower-activity-preview-row')).toHaveLength(3);
    expect(results.textContent).not.toContain('Release note 4');
    const preview=results.querySelector<HTMLElement>('.flower-activity-preview-text')!;
    expect(getComputedStyle(preview).webkitLineClamp).toBe('2');
    for(const panel of surface.querySelectorAll<HTMLElement>('.flower-activity-inline-details-content')) expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth+1);
    await page.screenshot({ element:surface,path:`__screenshots__/flower-tool-details-${width}.png` });
    const more=results.querySelector<HTMLButtonElement>('.flower-activity-detail-expand')!;
    more.click();
    expect(results.querySelectorAll('.flower-activity-preview-row')).toHaveLength(8);
    expect(results.getAttribute('data-expanded')).toBe('true');
    more.click();
  }
});

it('loads saved thread tool details only on expansion and keeps the preview compact', async () => {
  await page.viewport(1280, 1000);
  const calls: unknown[] = [];
  let resolveQuery!: (value: import('../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerToolPreview) => void;
  const seed = thread({ thread_id: 'saved-query', title: 'Saved query', messages: [{
    id: 'saved-message', turn_id: 'saved-turn', role: 'assistant', status: 'complete', content: '', created_at_ms: 2,
    blocks: [activityTimeline({ thread_id: 'saved-query', turn_id: 'saved-turn', run_id: 'saved-run', status: 'success', items: [
      activityItem({ item_id: 'query', tool_id: 'saved-call', tool_name: 'threads.query', renderer: 'structured', label: 'Find recent release discussions', payload: {}, started_at_unix_ms: 1000, ended_at_unix_ms: 3500 }),
      activityItem({ item_id: 'read', tool_id: 'read-call', tool_name: 'threads.read', renderer: 'structured', label: 'Read the release plan', payload: {} }),
      activityItem({ item_id: 'count', tool_id: 'count-call', tool_name: 'threads.aggregate', renderer: 'structured', label: 'threads.aggregate', payload: {} }),
    ] })],
  }] });
  const surface = renderSurfaceWithAdapter({ ...adapter(), listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed, 1),
    loadToolPreview: async (request) => {
      calls.push(request);
      if (request.tool_call_id === 'saved-call') return new Promise(resolve => { resolveQuery = resolve; });
      if (request.tool_call_id === 'read-call') return { tool_name: 'threads.read', inputs: [{ title: 'name', content: 'Release plan', format: 'text' }], rows: [{ title: 'body', content: 'The release is ready.\nValidation has passed.\nMore saved content remains available.', format: 'text' }], has_more: true };
      return { tool_name: 'threads.aggregate', inputs: [{ title: 'object', content: 'messages', format: 'text' }], rows: [], total: 0, has_more: false };
    },
  });
  surface.style.height = '100dvh';
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="saved-query"] button')));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="saved-query"] button')!.click();
  await waitFor(() => surface.querySelectorAll('[data-flower-disclosure-trigger]').length === 3);
  expect(calls).toHaveLength(0);
  const query = surface.querySelector('[data-flower-activity-item-id="query"]')!;
  const trigger = query.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!;
  trigger.click();
  await waitFor(() => query.textContent!.includes('Loading details'));
  expect(calls).toEqual([{ thread_id: 'saved-query', turn_id: 'saved-turn', run_id: 'saved-run', tool_call_id: 'saved-call' }]);
  resolveQuery({ tool_name: 'threads.query', inputs: [{ title: 'query', content: 'release', format: 'text' }, { title: 'object', content: 'messages', format: 'text' }], total: 18, has_more: true,
    rows: Array.from({ length: 8 }, (_, index) => ({ title: `Release ${index + 1}`, content: 'Ready for review.\nValidation has passed.\nThe full saved snippet remains behind the preview.', format: 'text' as const })),
  });
  await waitFor(() => query.textContent!.includes('Matches: 18'));
  expect(query.textContent).toContain('Thread Query: Find recent release discussions');
  expect(query.querySelector('dt')?.textContent).toBe('Search terms');
  expect(query.querySelector('dd')?.textContent).toBe('release');
  expect(query.textContent).toContain('TypeMessages');
  expect(query.querySelectorAll('[data-activity-section="results"] .flower-activity-preview-row')).toHaveLength(3);
  expect(query.textContent).not.toContain('Release 4');
  query.querySelector<HTMLButtonElement>('[data-activity-section="results"] .flower-activity-detail-expand')!.click();
  expect(query.textContent).toContain('Release 8');
  trigger.click();
  await waitFor(() => query.getAttribute('data-state') === 'closed');
  trigger.click();
  await waitFor(() => query.textContent!.includes('Release 1'));
  expect(calls).toHaveLength(1);
  surface.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="read"] [data-flower-disclosure-trigger]')!.click();
  surface.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="count"] [data-flower-disclosure-trigger]')!.click();
  await waitFor(() => surface.textContent!.includes('The release is ready.') && surface.textContent!.includes('Matches: 0'));
  expect(surface.textContent).not.toContain('This tool did not provide');
  expect(surface.textContent).toContain('Thread Read: Read the release plan');
  expect(query.querySelector('.flower-activity-inline-duration')?.textContent).toBe('3s');
  for (const width of [1280, 390]) {
    await page.viewport(width, 1000);
    await page.screenshot({ element: surface, path: `__screenshots__/flower-thread-preview-${width}.png` });
    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
  }
});

it('lets the user retry a failed saved preview without replacing canonical tool status', async () => {
  await page.viewport(1280, 1000);
  let attempts = 0;
  const seed = thread({ thread_id: 'preview-retry', messages: [{ id: 'm', role: 'assistant', status: 'complete', content: '', created_at_ms: 2,
    blocks: [activityTimeline({ thread_id: 'preview-retry', turn_id: 'turn', run_id: 'run', items: [activityItem({ item_id: 'query', tool_id: 'call', tool_name: 'threads.query', renderer: 'structured', payload: {}, status: 'success' })] })],
  }] });
  const surface = renderSurfaceWithAdapter({ ...adapter(), listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed, 1), loadToolPreview: async () => {
    if (++attempts === 1) throw new Error('unavailable');
    return { tool_name: 'threads.query', inputs: [], rows: [], total: 0, has_more: false };
  } });
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="preview-retry"] button')));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="preview-retry"] button')!.click();
  await waitFor(() => Boolean(surface.querySelector('[data-flower-disclosure-trigger]')));
  surface.querySelector<HTMLButtonElement>('[data-flower-disclosure-trigger]')!.click();
  await waitFor(() => surface.textContent!.includes('Could not load details.'));
  const row = surface.querySelector('[data-flower-activity-item-id="query"]')!;
  expect(row.getAttribute('data-flower-activity-status')).toBe('success');
  row.querySelector<HTMLButtonElement>('.flower-activity-detail-expand')!.click();
  await waitFor(() => row.textContent!.includes('Matches: 0'));
  expect(attempts).toBe(2);
});
