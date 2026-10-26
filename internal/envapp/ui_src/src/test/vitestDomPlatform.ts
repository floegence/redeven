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

if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => [];
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

// jsdom has no layout or viewport observation. These component tests represent
// a visible transcript; real browser suites qualify clipping and scroll geometry.
if (typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')) {
  // No hit testing exists without layout. Browser suites own anchor geometry.
  document.elementFromPoint ??= () => null;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() {
    return this.classList.contains('flower-chat-transcript') ? 600 : 0;
  } });
  if (typeof globalThis.IntersectionObserver === 'undefined') {
    globalThis.IntersectionObserver = class {
      readonly root = null; readonly rootMargin = ''; readonly thresholds = [0];
      private elements = new Set<Element>();
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.elements.add(target);
        queueMicrotask(() => { if (this.elements.has(target)) this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this); });
      }
      unobserve(target: Element) { this.elements.delete(target); }
      disconnect() { this.elements.clear(); }
      takeRecords(): IntersectionObserverEntry[] { return []; }
    };
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (typeof Element !== 'undefined' && typeof Element.prototype.animate !== 'function') {
  Element.prototype.animate = function animate(
    _keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ): Animation {
    const duration = typeof options === 'number' ? options : Number(options?.duration ?? 0);
    return new VitestAnimation(Math.max(0, duration)) as unknown as Animation;
  };
}
