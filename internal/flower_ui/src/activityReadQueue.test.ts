import { describe, expect, it, vi } from 'vitest';
import { createActivityReadQueue } from './activityReadQueue';

const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
describe('activity read scheduling', () => {
  it('shares identical reads but lets each disclosure cancel independently', async () => {
    const queue = createActivityReadQueue();
    let finish!: (value: string) => void;
    const transport = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
    const one = new AbortController(); const two = new AbortController();
    const first = queue.run('same', one.signal, transport);
    const second = queue.run('same', two.signal, transport);
    one.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport).toHaveBeenCalledTimes(1);
    finish('complete');
    await expect(second).resolves.toBe('complete');
    await tick(); expect(queue.active).toBe(0); expect(queue.pending).toBe(0);
  });
  it('bounds in-flight IO even when cancelled transports ignore their signals', async () => {
    const queue = createActivityReadQueue();
    const completions: Array<() => void> = [];
    const transport = vi.fn(() => new Promise<void>(resolve => completions.push(resolve)));
    const controllers = Array.from({ length: 5 }, () => new AbortController());
    const reads = controllers.map((controller, index) => queue.run(String(index), controller.signal, transport).catch(error => error));
    expect(transport).toHaveBeenCalledTimes(2);
    controllers[0].abort(); controllers[1].abort(); controllers[2].abort();
    expect(transport).toHaveBeenCalledTimes(2);
    completions.shift()!(); await tick();
    expect(transport).toHaveBeenCalledTimes(3);
    expect(queue.active).toBe(2);
    completions.shift()!(); await tick();
    expect(transport).toHaveBeenCalledTimes(4);
    completions.splice(0).forEach(finish => finish());
    await Promise.all(reads); await tick();
    expect(queue.active).toBe(0); expect(queue.pending).toBe(0);
  });
  it('keeps a reopened owner when an older cancelled request finishes', async () => {
    const queue = createActivityReadQueue(); const owner = new AbortController();
    let firstFinish!: () => void; let secondFinish!: () => void;
    const first = queue.run('same', owner.signal, () => new Promise<void>(resolve => { firstFinish = resolve; })).catch(error => error);
    owner.abort();
    const second = queue.run('same', new AbortController().signal, () => new Promise<void>(resolve => { secondFinish = resolve; }));
    firstFinish(); await tick();
    expect(queue.pending).toBe(1);
    secondFinish(); await Promise.all([first, second]); await tick();
    expect(queue.pending).toBe(0);
  });
});
