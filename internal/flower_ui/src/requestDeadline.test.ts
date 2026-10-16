import { afterEach, expect, it, vi } from 'vitest';
import { FlowerRequestDeadlineError, withFlowerRequestDeadline } from './requestDeadline';

afterEach(() => vi.useRealTimers());

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
