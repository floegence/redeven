// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowerToolIcon } from '../../../../flower_ui/src/FlowerToolIcon';
import { flowerToolMotion } from '../../../../flower_ui/src/flowerToolMotion';

if (!SVGElement.prototype.animate) SVGElement.prototype.animate = (() => ({cancel() {}, finished: Promise.resolve()})) as unknown as typeof Element.prototype.animate;

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('semantic tool icons', () => {
 it.each(['file.edit', 'file.write', 'apply_patch', 'tessiven.edit'])('gives %s a pencil and synchronized writing stroke', name => {
  const host = document.createElement('div');
  disposers.push(render(() => <FlowerToolIcon toolName={name} running={false} />, host));
  expect(host.querySelector('[data-flower-writing-part="pencil"]'), name).not.toBeNull();
  expect(host.querySelector('[data-flower-writing-part="ink"]'), name).not.toBeNull();
  expect(flowerToolMotion[name].tracks).toHaveLength(2);
 });
 it('uses the same terminal glyph for starting a command and reading its output', () => {
  const host = document.createElement('div');
  disposers.push(render(() => <><FlowerToolIcon toolName="terminal.exec" running={false} /><FlowerToolIcon toolName="terminal.read" running={false} /></>, host));
  const [exec, read] = host.querySelectorAll('svg');
  expect(exec.outerHTML).toBe(read.outerHTML);
 });
 it.each(['terminal.exec', 'terminal.read'])('restores the four-square loader only while %s is running', name => {
  const animate = vi.spyOn(SVGElement.prototype, 'animate');
  const [running, setRunning] = createSignal(false);
  const host = document.createElement('div');
  disposers.push(render(() => <FlowerToolIcon toolName={name} running={running()} />, host));
  expect(host.querySelector('svg')).not.toBeNull();
  expect(host.querySelector('.flower-activity-inline-loader')).toBeNull();
  setRunning(true);
  expect(host.querySelectorAll('.flower-activity-inline-loader-square')).toHaveLength(4);
  expect(host.querySelector('.flower-activity-inline-loader')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelector('svg')).toBeNull();
  expect(animate).not.toHaveBeenCalled();
  setRunning(false);
  expect(host.querySelector('.flower-activity-inline-loader')).toBeNull();
  expect(host.querySelector('svg')).not.toBeNull();
 });
 it('validates every animation against the actual icon parts', () => {
  for (const name of Object.keys(flowerToolMotion)) {
   const host=document.createElement('div');
   const dispose=render(() => <FlowerToolIcon toolName={name} source={name === 'mcp' ? 'mcp' : undefined} running={false} />,host);
   expect(host.querySelector('svg'),name).not.toBeNull(); dispose();
  }
 });
 it.each(['file.edit', 'file.write', 'apply_patch', 'tessiven.edit'])('keeps the %s pencil and removes all running effects on completion', name => {
  const cancel = vi.fn();
  const animate = vi.spyOn(SVGElement.prototype, 'animate').mockReturnValue({ cancel, finished: Promise.resolve() } as unknown as Animation);
  const [running, setRunning] = createSignal(true);
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <FlowerToolIcon toolName={name} running={running()} />, host));
  const svg = host.querySelector('svg');
  expect(svg?.querySelectorAll('g').length).toBeGreaterThan(0);
  expect(animate).toHaveBeenCalled();
  setRunning(false);
  expect(host.querySelector('svg')).toBe(svg);
  expect(cancel).toHaveBeenCalled();
  expect([...host.querySelectorAll('g')].every(group => !group.style.strokeDasharray && !group.style.opacity)).toBe(true);
 });
 it('honors reduced motion and cancels animations on unmount', () => {
  const cancel = vi.fn();
  const animate = vi.spyOn(SVGElement.prototype, 'animate').mockReturnValue({ cancel, finished: Promise.resolve() } as unknown as Animation);
  let reduce = false; let change = () => {};
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({get matches(){return reduce;},addEventListener: (_: string, listener: () => void) => { change=listener; }, removeEventListener: vi.fn()}) as unknown as MediaQueryList);
  const host=document.createElement('div'); document.body.append(host);
  const dispose=render(() => <FlowerToolIcon toolName="file.edit" running />,host);
  expect(animate).toHaveBeenCalled(); reduce=true; change(); expect(cancel).toHaveBeenCalled();
  const count=animate.mock.calls.length; change(); expect(animate).toHaveBeenCalledTimes(count);
  dispose();
 });
});
