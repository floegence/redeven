export const FLOWER_LIVE_EMPTY_POLL_DELAYS_MS = [750, 1250, 2000] as const;

export type FlowerLivePollResult = Readonly<{
  hadEvents: boolean;
  hasMore: boolean;
}>;

export type FlowerLivePollLoop = Readonly<{
  dispose: () => void;
}>;

export type FlowerLivePollLoopOptions = Readonly<{
  poll: () => Promise<FlowerLivePollResult>;
  active?: () => boolean;
  onError?: (error: unknown) => void;
}>;

export function createFlowerLivePollLoop(options: FlowerLivePollLoopOptions): FlowerLivePollLoop {
  const active = options.active ?? (() => true);
  let disposed = false;
  let emptyPolls = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (delayMs: number) => {
    if (disposed) return;
    timer = setTimeout(() => {
      timer = undefined;
      void poll();
    }, Math.max(0, delayMs));
  };
  const nextEmptyDelay = () => {
    const index = Math.min(emptyPolls, FLOWER_LIVE_EMPTY_POLL_DELAYS_MS.length - 1);
    emptyPolls += 1;
    return FLOWER_LIVE_EMPTY_POLL_DELAYS_MS[index];
  };
  const poll = async () => {
    if (disposed) return;
    if (!active()) {
      schedule(FLOWER_LIVE_EMPTY_POLL_DELAYS_MS.at(-1) ?? 2000);
      return;
    }
    try {
      const result = await options.poll();
      if (disposed) return;
      if (result.hadEvents || result.hasMore) {
        emptyPolls = 0;
        schedule(0);
        return;
      }
      schedule(nextEmptyDelay());
    } catch (error) {
      if (disposed) return;
      options.onError?.(error);
      schedule(nextEmptyDelay());
    }
  };

  void poll();
  return {
    dispose: () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
