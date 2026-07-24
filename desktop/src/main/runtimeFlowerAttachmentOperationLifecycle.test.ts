import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
	beginRuntimeFlowerAttachmentWrite,
	endRuntimeFlowerAttachmentWrite,
	finishRuntimeFlowerAttachmentOperation,
  trackRuntimeFlowerAttachmentOperation,
  type RuntimeFlowerAttachmentLifecycleOperation,
} from './runtimeFlowerAttachmentOperationLifecycle';

type TestOperation = RuntimeFlowerAttachmentLifecycleOperation & Readonly<{ key: string }>;

function operation(key: string, sender: EventEmitter): TestOperation {
  return { key, sender, settled: false };
}

describe('runtime Flower attachment operation lifecycle', () => {
  it('prevents a commit claim while the same operation has a chunk write in flight', () => {
    const current = operation('serialized', new EventEmitter());
    const chunkClaimed = beginRuntimeFlowerAttachmentWrite(current);
    const commitClaimed = beginRuntimeFlowerAttachmentWrite(current);

    expect(chunkClaimed).toBe(true);
    expect(commitClaimed).toBe(false);

    endRuntimeFlowerAttachmentWrite(current);
    expect(beginRuntimeFlowerAttachmentWrite(current)).toBe(true);
  });

  it('prevents a second commit from writing the same operation footer', () => {
    const current = operation('commit-once', new EventEmitter());
    expect(beginRuntimeFlowerAttachmentWrite(current)).toBe(true);
    expect(beginRuntimeFlowerAttachmentWrite(current)).toBe(false);

    finishRuntimeFlowerAttachmentOperation(new Map([['commit-once', current]]), current);
    expect(beginRuntimeFlowerAttachmentWrite(current)).toBe(false);
  });

  it('allows different upload operations to write independently', () => {
    const first = operation('first', new EventEmitter());
    const second = operation('second', new EventEmitter());

    expect(beginRuntimeFlowerAttachmentWrite(first)).toBe(true);
    expect(beginRuntimeFlowerAttachmentWrite(second)).toBe(true);
  });

  it('does not accumulate renderer listeners across settled uploads', () => {
    const sender = new EventEmitter();
    const operations = new Map<string, TestOperation>();

    for (let index = 0; index < 100; index += 1) {
      const current = operation(`operation-${index}`, sender);
      trackRuntimeFlowerAttachmentOperation(operations, current, vi.fn());
      expect(sender.listenerCount('destroyed')).toBe(1);

      finishRuntimeFlowerAttachmentOperation(operations, current);
      expect(sender.listenerCount('destroyed')).toBe(0);
    }

    expect(operations.size).toBe(0);
  });

  it('removes only the settled operation listener when uploads share a renderer', () => {
    const sender = new EventEmitter();
    const operations = new Map<string, TestOperation>();
    const firstDestroyed = vi.fn();
    const secondDestroyed = vi.fn();
    const first = operation('first', sender);
    const second = operation('second', sender);

    trackRuntimeFlowerAttachmentOperation(operations, first, firstDestroyed);
    trackRuntimeFlowerAttachmentOperation(operations, second, secondDestroyed);
    expect(sender.listenerCount('destroyed')).toBe(2);

    finishRuntimeFlowerAttachmentOperation(operations, first);
    expect(sender.listenerCount('destroyed')).toBe(1);
    expect(operations.has('second')).toBe(true);

    sender.emit('destroyed');

    expect(firstDestroyed).not.toHaveBeenCalled();
    expect(secondDestroyed).toHaveBeenCalledOnce();
    expect(second.settled).toBe(true);
    expect(sender.listenerCount('destroyed')).toBe(0);
    expect(operations.size).toBe(0);
  });

  it('keeps a replacement operation when stale cleanup runs for the same key', () => {
    const sender = new EventEmitter();
    const operations = new Map<string, TestOperation>();
    const stale = operation('shared', sender);
    trackRuntimeFlowerAttachmentOperation(operations, stale, vi.fn());
    finishRuntimeFlowerAttachmentOperation(operations, stale);

    const replacement = operation('shared', sender);
    trackRuntimeFlowerAttachmentOperation(operations, replacement, vi.fn());
    finishRuntimeFlowerAttachmentOperation(operations, stale);

    expect(operations.get('shared')).toBe(replacement);
    expect(sender.listenerCount('destroyed')).toBe(1);
  });
});
