import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { sharedHostsVersion } from './tessiven-shared-hosts.fixture';
import type { Version } from '../../../../tessiven_ui/src/types';

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
function mount(transformed = false, version: Version = sharedHostsVersion(), locate?: string) {
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = `width:1250px;height:740px;position:relative;${transformed ? 'transform:scale(.8);transform-origin:top left' : ''}`;
  document.body.append(host);
  if (transformed) {
    host.setAttribute('data-floe-surface-portal-layer','true');
    host.setAttribute('data-floe-dialog-surface-host','true');
  }
  const ask = vi.fn(), inspect = vi.fn();
  dispose = render(() => <TessivenGraph version={version} historical={false} t={tessivenText('en-US')} onAsk={ask} onInspect={inspect} locate={locate} />, host);
  return { ask, inspect };
}
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.removeAttribute('style'); document.documentElement.classList.remove('dark'); });
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const media = commands as unknown as { emulateMediaPreferences: (preferences: { forcedColors?: 'active' | 'none'; reducedMotion?: 'reduce' | 'no-preference' }) => Promise<void> };
function applyTheme(preset: (typeof builtInShellThemePresets)[number]) {
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.toggle('dark',preset.mode === 'dark');
  for (const [name,value] of Object.entries(preset.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(name,value);
}

describe('shared host canvas interactions', () => {
  it('shows full inventories and highlights every appearance without a hover popup', async () => {
    await page.viewport(1300,800);
    mount();
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    const group = host.querySelector<HTMLElement>('[data-graph-object="hdfs"]')!;
    expect(parseFloat(group.style.width)).toBeGreaterThan(550);
    const copies = [...host.querySelectorAll<HTMLElement>('.tessiven-node[data-node-id="node-1"]')];
    expect(copies).toHaveLength(2);
    for (const copy of copies) expect([...copy.querySelectorAll('.tessiven-service strong')].map(row => row.textContent)).toEqual(['NameNode','ZooKeeper']);
    await userEvent.hover(page.elementLocator(copies[0].querySelector('header')!));
    await expect.poll(() => copies.every(copy => copy.dataset.linked === 'true')).toBe(true);
    expect(host.querySelector('.tessiven-popup')).toBeNull();
    await userEvent.hover(page.getByRole('button',{name:'Fit canvas',exact:true}));
    await expect.poll(() => copies.every(copy => copy.dataset.linked === 'false')).toBe(true);
    copies[1].parentElement!.focus();
    await expect.poll(() => copies.every(copy => copy.dataset.linked === 'true')).toBe(true);
    expect(host.querySelector('.tessiven-popup')).toBeNull();
  });

  it('uses the existing details popup for memberships and canonical Ask context', async () => {
    await page.viewport(1300,800);
    const { ask } = mount(true);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    const copy = host.querySelector<HTMLElement>('.tessiven-node[data-node-id="node-1"]')!;
    copy.parentElement!.focus();
    copy.parentElement!.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}));
    await expect.element(page.getByRole('dialog', { name:'Details' })).toBeVisible();
    const popup = document.querySelector<HTMLElement>('.tessiven-popup')!;
    expect(document.querySelectorAll('.tessiven-popup')).toHaveLength(1);
    expect(popup.closest('[data-floe-surface-portal-layer]')).toBe(host);
    expect(popup.closest('[data-floe-local-interaction-surface="true"]')).not.toBeNull();
    expect(popup.style.position).not.toBe('fixed');
    expect(popup.querySelector('.tessiven-detail-object > code')?.textContent).toBe('node-1');
    expect(popup.querySelectorAll('.tessiven-memberships button')).toHaveLength(2);
    expect(popup.textContent).toContain('conceptual:demo/node-1');
    await page.getByRole('button', {name:'Ask Flower',exact:true}).click();
    expect(ask).toHaveBeenCalledWith({canvas_id:'hadoop',version_id:3,object_refs:['node-1']});
  });

  it('locates an instance in its own logical group on a shared host', async () => {
    await page.viewport(1300,800);
    const version = sharedHostsVersion();
    version.document.presentation!.initiallyExpanded = [];
    mount(false,version,'zk-1');
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(3);
    expect(host.querySelector('.tessiven-node[data-node-id="node-1"]')?.getAttribute('data-group-id')).toBe('zk');
    await expect.element(page.getByRole('dialog',{name:'Details'})).toBeVisible();
    expect(document.querySelector('.tessiven-detail-object > code')?.textContent).toBe('zk-1');
  });

  it('locates the same host in a collapsed group and restores focus without changing its reference', async () => {
    await page.viewport(1300,800);
    const { ask } = mount(true);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    const group = host.querySelector<HTMLElement>('[data-graph-object="zk"]')!;
    await userEvent.click(group.querySelector('button')!);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(2);
    await page.getByRole('button', {name:'Fit canvas',exact:true}).click();
    await userEvent.click(host.querySelector('.tessiven-node > header strong')!);
    await page.getByRole('button',{name:'Locate in ZooKeeper / Core',exact:true}).click();
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    expect(document.querySelectorAll('.tessiven-popup')).toHaveLength(1);
    expect(document.querySelector('.tessiven-detail-object > code')?.textContent).toBe('node-1');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    expect(document.activeElement?.getAttribute('data-graph-object')).toBe('zk::node-1');
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await expect.element(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem',{name:'Ask Flower'}).click();
    expect(ask).toHaveBeenCalledWith({canvas_id:'hadoop',version_id:3,object_refs:['node-1']});
  });

  it('keeps service rows focused on real instances and preserves inspection', async () => {
    await page.viewport(1300,800);
    const version = sharedHostsVersion();
    version.document.instances![0].binding = { owner:'managed_service',resourceId:'namenode-service' };
    const { inspect, ask } = mount(false,version);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    const copy = host.querySelector('.tessiven-node[data-node-id="node-1"][data-group-id="zk"]')!;
    await userEvent.click(copy.querySelector('.tessiven-service')!);
    await expect.element(page.getByRole('dialog',{name:'Details'})).toBeVisible();
    expect(document.querySelector('.tessiven-detail-object > code')?.textContent).toBe('nn-1');
    expect(document.querySelectorAll('.tessiven-memberships button')).toHaveLength(1);
    await page.getByRole('button',{name:'Inspect service',exact:true}).click();
    expect(inspect).toHaveBeenCalledWith(version.document.instances![0]);
    await userEvent.click(copy.querySelector('.tessiven-service')!);
    await page.getByRole('button',{name:'Ask Flower',exact:true}).click();
    expect(ask).toHaveBeenCalledWith({canvas_id:'hadoop',version_id:3,object_refs:['nn-1']});
  });

  it.each(['one','two','same','mixed'] as const)('renders complete physical inventory and own group emphasis for %s', async scenario => {
    await page.viewport(1300,800);
    const version = sharedHostsVersion(scenario);
    mount(false,version);
    const views = version.document.groups!.reduce((n,group) => n + group.nodeRefs.length,scenario === 'mixed' ? 1 : 0);
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(views);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    for (const copy of host.querySelectorAll<HTMLElement>('.tessiven-node')) {
      const instances = version.document.instances!.filter(i => i.nodeRef === copy.dataset.nodeId);
      const services = [...new Set(instances.map(i => i.serviceRef))];
      expect(copy.querySelectorAll('.tessiven-service')).toHaveLength(services.length);
      const group = version.document.groups!.find(g => g.id === copy.dataset.groupId);
      if (group) {
        for (const [n,row] of [...copy.querySelectorAll<HTMLElement>('.tessiven-service')].entries()) {
          expect(row.dataset.member).toBe(String(instances.some(i => i.serviceRef === services[n] && group.instanceRefs!.includes(i.id))));
        }
      }
    }
    for (const theme of builtInShellThemePresets.filter(t => ['porcelain-light','porcelain-dark'].includes(t.name))) {
      applyTheme(theme);
      await frames();
      await page.screenshot({element:host,path:`../../.vitest-attachments/shared-hosts-${scenario}-${theme.name}.png`});
    }
  });

  it('keeps linked surfaces identical across every theme and accessible preferences', async () => {
    await page.viewport(1300,800);
    mount();
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    for (const theme of builtInShellThemePresets) {
      applyTheme(theme);
      const copies = [...host.querySelectorAll<HTMLElement>('.tessiven-node[data-node-id="node-1"]')];
      copies[0].parentElement!.dispatchEvent(new PointerEvent('pointerenter'));
      await expect.poll(() => copies.every(copy => copy.dataset.linked === 'true')).toBe(true);
      await frames();
      const styles = copies.map(copy => [getComputedStyle(copy).backgroundColor,getComputedStyle(copy).borderColor,getComputedStyle(copy.querySelector('header')!).backgroundColor]);
      expect(styles[0],theme.name).toEqual(styles[1]);
      expect(host.querySelector('.tessiven-popup')).toBeNull();
      expect(copies.every(copy => !copy.hasAttribute('title') && !copy.querySelector('[title]'))).toBe(true);
      await page.screenshot({element:host,path:`../../.vitest-attachments/shared-hosts-hover-${theme.name}.png`});
    }
    await media.emulateMediaPreferences({reducedMotion:'reduce'});
    expect(getComputedStyle(host.querySelector('.tessiven-node')!).transitionDuration).toBe('0s');
    await media.emulateMediaPreferences({forcedColors:'active'});
    const linked = host.querySelector('.tessiven-node[data-linked="true"]')!;
    expect(getComputedStyle(linked).outlineStyle).toBe('solid');
    await media.emulateMediaPreferences({forcedColors:'none',reducedMotion:'no-preference'});
  });

  it.each([390,320])('clamps node details in a narrow %s px canvas', async width => {
    await page.viewport(width,740);
    mount();
    host.style.width = `${width}px`;
    await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(5);
    await userEvent.click(host.querySelector('.tessiven-node > header strong')!);
    await expect.element(page.getByRole('dialog',{name:'Details'})).toBeVisible();
    const popup = document.querySelector<HTMLElement>('.tessiven-popup')!;
    const bounds = popup.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth + 1);
    await page.screenshot({path:`../../.vitest-attachments/shared-hosts-details-${width}.png`});
  });
});
