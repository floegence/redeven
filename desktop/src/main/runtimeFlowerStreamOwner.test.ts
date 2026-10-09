import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { bindRuntimeFlowerStreamOwner } from './runtimeFlowerStreamOwner';

const owner = () => {
  const events = new EventEmitter();
  return { events, sender: events as unknown as WebContents };
};

it.each(['reload', 'crash', 'destroy'])('releases a document stream on %s', event => {
  const { events, sender } = owner();
  const cancel = vi.fn();
  bindRuntimeFlowerStreamOwner(sender, cancel);
  if (event === 'reload') events.emit('did-start-navigation', {}, 'file:///index.html', false, true);
  if (event === 'crash') events.emit('render-process-gone', {}, { reason: 'crashed' });
  if (event === 'destroy') events.emit('destroyed');
  expect(cancel).toHaveBeenCalledOnce();
  events.emit('destroyed');
  expect(cancel).toHaveBeenCalledOnce();
  expect(events.eventNames()).toEqual([]);
});

it('preserves document streams across canvas navigation and subframe loads', () => {
  const { events, sender } = owner();
  const cancel = vi.fn();
  const release = bindRuntimeFlowerStreamOwner(sender, cancel);
  events.emit('did-start-navigation', {}, 'file:///index.html#tessiven', true, true);
  events.emit('did-start-navigation', {}, 'https://example.test', false, false);
  expect(cancel).not.toHaveBeenCalled();
  release();
  events.emit('destroyed');
  expect(cancel).not.toHaveBeenCalled();
  expect(events.eventNames()).toEqual([]);
});

it('does not exhaust stream slots after repeated reloads or close another owner', () => {
  const first = owner();
  const other = owner();
  const otherCancel = vi.fn();
  const releaseOther = bindRuntimeFlowerStreamOwner(other.sender, otherCancel);
  let activeStreams = 0;
  for (let i = 0; i < 20; i += 1) {
    activeStreams += 1;
    bindRuntimeFlowerStreamOwner(first.sender, () => { activeStreams -= 1; });
    first.events.emit('did-start-navigation', {}, 'file:///index.html', false, true);
    expect(activeStreams).toBe(0);
    expect(first.events.eventNames()).toEqual([]);
  }
  expect(otherCancel).not.toHaveBeenCalled();
  releaseOther();
});
