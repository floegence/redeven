class VitestResizeObserver implements ResizeObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];

  constructor(_callback: ResizeObserverCallback) {}

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): ResizeObserverEntry[] {
    return [];
  }
}

class VitestAnimation {
  private resolveFinished!: () => void;
  private rejectFinished!: () => void;
  private timer: number | undefined;
  private state: AnimationPlayState = 'running';
  readonly finished = new Promise<void>((resolve, reject) => {
    this.resolveFinished = resolve;
    this.rejectFinished = reject;
  });

  constructor(duration: number) {
    this.timer = window.setTimeout(() => this.finish(), duration);
  }

  get playState(): AnimationPlayState {
    return this.state;
  }

  cancel(): void {
    if (this.state !== 'running') return;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.state = 'idle';
    this.rejectFinished();
  }

  finish(): void {
    if (this.state !== 'running') return;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.state = 'finished';
    this.resolveFinished();
  }
  pause(): void {
    this.state = 'paused';
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = VitestResizeObserver;
}

if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.animate !== 'function') {
  HTMLElement.prototype.animate = function animate(
    _keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ): Animation {
    const duration = typeof options === 'number' ? options : Number(options?.duration ?? 0);
    return new VitestAnimation(Math.max(0, duration)) as unknown as Animation;
  };
}
