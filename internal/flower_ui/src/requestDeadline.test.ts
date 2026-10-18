import { afterEach, expect, it, vi } from 'vitest';
import { FlowerRequestDeadlineError, withFlowerRequestDeadline, withFlowerReadDeadline } from './requestDeadline';

afterEach(() => vi.useRealTimers());

it('does not dispatch a read superseded before its first microtask', async () => {
  const controller = new AbortController(); const read = vi.fn();
  const pending = withFlowerReadDeadline(read, 'timeout', controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).not.toHaveBeenCalled();
});

it('releases a stalled save without replaying or publishing its late response', async () => {
  vi.useFakeTimers();
  let finish!: (value: string) => void;
  const operation = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const saved = vi.fn();
  const pending = withFlowerRequestDeadline(operation, 'Check settings before retrying').then(saved);
  const failed = expect(pending).rejects.toBeInstanceOf(FlowerRequestDeadlineError);
  await vi.advanceTimersByTimeAsync(120_000);
  await failed;
  finish('late saved settings');
  await Promise.resolve();
  expect(operation).toHaveBeenCalledTimes(1);
  expect(saved).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('releases its deadline after successful or failed completion', async () => {
  vi.useFakeTimers();
  await expect(withFlowerRequestDeadline(async () => 'saved', 'timeout')).resolves.toBe('saved');
  await expect(withFlowerRequestDeadline(async () => { throw new Error('rejected'); }, 'timeout')).rejects.toThrow('rejected');
  expect(vi.getTimerCount()).toBe(0);
});

it('bounds reads at 15 seconds and ignores late results', async () => {
  vi.useFakeTimers();
  let finish!: (value: string) => void;
  const publish = vi.fn();
  const pending = withFlowerReadDeadline(() => new Promise<string>(resolve => { finish = resolve; }), 'read timeout').then(publish);
  const rejected = expect(pending).rejects.toThrow('read timeout');
  await vi.advanceTimersByTimeAsync(15_000);
  await rejected;
  finish('late');
  await Promise.resolve();
  expect(publish).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('releases superseded reads immediately and never starts an already aborted read', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const pending = withFlowerReadDeadline(() => new Promise(() => {}), 'timeout', controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  const operation = vi.fn(async () => 'never');
  await expect(withFlowerReadDeadline(operation, 'timeout', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(operation).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
