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
  const [running, setRunning] = createSignal(true);
  const host = document.createElement('div');
  host.className = 'flower-activity-inline';
  host.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px 24px;padding:24px;background:var(--background);color:var(--foreground);font:12px sans-serif';
  document.body.append(host);
  const dispose = render(() => <For each={Object.keys(flowerToolMotion)}>{name => <div style="display:flex;align-items:center;gap:12px;height:28px">
    <FlowerToolIcon toolName={name} running={running()} /><code>{name}</code>
    <span style="margin-left:auto;color:var(--flower-activity-tool-row-ok)"><FlowerToolIcon toolName={name} running={false} /></span>
    <span style="color:var(--flower-activity-tool-row-error)"><FlowerToolIcon toolName={name} running={false} /></span>
  </div>}</For>, host);
  try {
    await waitFor(() => host.getAnimations({ subtree: true }).length > 58);
    const svgs = [...host.querySelectorAll('svg')];
    expect(svgs).toHaveLength(172);
    expect(host.querySelectorAll('.flower-activity-inline-loader')).toHaveLength(2);
    expect(host.querySelectorAll('.flower-activity-inline-loader-square')).toHaveLength(8);
    const animations = host.getAnimations({ subtree: true });
    const start = animations.map(animation => animation.effect?.getComputedTiming().duration as number);
    for (const phase of [0, 0.35, 0.7, 0.999]) {
      animations.forEach((animation, index) => { animation.pause(); animation.currentTime = start[index] * phase; });
      for (const svg of svgs) expect(svg.getBoundingClientRect().width).toBe(16);
      if (phase === 0.35) await page.screenshot({ element: host, path: '__screenshots__/flower-tool-icons-58.png' });
    }
    setRunning(false);
    expect(host.getAnimations({ subtree: true })).toHaveLength(0);
    expect(host.querySelectorAll('svg')).toHaveLength(174);
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
  await waitFor(()=>Boolean(surface.querySelector('[data-thread-id="tool-presentation"] button')));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="tool-presentation"] button')!.click();
  await waitFor(()=>surface.querySelectorAll('[data-flower-disclosure-trigger]').length===2);
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
