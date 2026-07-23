export type FlowerCompanionTailProjection = Readonly<{
  identity: string;
  text: string;
}>;

export type FlowerCompanionTailMotionElements = Readonly<{
  viewport: HTMLElement;
  value: HTMLElement;
}>;

export type FlowerCompanionTailMotionOptions = Readonly<{
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  measurePrefix?: (codePointCount: number, value: HTMLElement) => number;
  reducedMotion?: () => boolean;
}>;

const MAX_BUFFER_CODE_POINTS = 800;
const RUNNING_TRIM_CODE_POINTS = 736;
const SETTLED_BUFFER_CODE_POINTS = 480;
const MIN_ROLLING_OVERLAP = 96;
const FOLLOW_EPSILON_PX = 1;

function codePoints(value: string): string[] {
  return Array.from(value);
}

export function reliableFlowerTailAppend(previous: string, next: string): string | null {
  if (next === previous) return '';
  if (next.startsWith(previous)) return next.slice(previous.length);
  const previousCharacters = codePoints(previous);
  const nextCharacters = codePoints(next);
  const requiredOverlap = Math.min(
    MIN_ROLLING_OVERLAP,
    Math.ceil(previousCharacters.length / 3),
  );
  if (requiredOverlap < MIN_ROLLING_OVERLAP || nextCharacters.length < previousCharacters.length) return null;
  const maximum = Math.min(previousCharacters.length, nextCharacters.length);
  for (let overlap = maximum; overlap >= requiredOverlap; overlap -= 1) {
    if (
      previousCharacters.slice(-overlap).join('')
      === nextCharacters.slice(0, overlap).join('')
    ) {
      return nextCharacters.slice(overlap).join('');
    }
  }
  return null;
}

function defaultMeasurePrefix(codePointCount: number, value: HTMLElement): number {
  const text = value.firstChild;
  if (!(text instanceof Text)) return 0;
  const utf16Offset = codePoints(text.data).slice(0, codePointCount).join('').length;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, Math.min(text.length, utf16Offset));
  const width = range.getBoundingClientRect().width;
  range.detach();
  return width;
}

export class FlowerCompanionTailMotionController {
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly measurePrefix: (codePointCount: number, value: HTMLElement) => number;
  private readonly reducedMotion: () => boolean;
  private frame: number | null = null;
  private generation = 0;
  private target = 0;
  private identity = '';
  private windowText = '';
  private buffer = '';
  private disposed = false;

  constructor(
    private readonly elements: FlowerCompanionTailMotionElements,
    options: FlowerCompanionTailMotionOptions = {},
  ) {
    this.requestFrame = options.requestFrame ?? window.requestAnimationFrame.bind(window);
    this.cancelFrame = options.cancelFrame ?? window.cancelAnimationFrame.bind(window);
    this.measurePrefix = options.measurePrefix ?? defaultMeasurePrefix;
    this.reducedMotion = options.reducedMotion ?? (() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  update(projection: FlowerCompanionTailProjection): void {
    if (this.disposed) return;
    const nextText = projection.text;
    const append = projection.identity === this.identity
      ? reliableFlowerTailAppend(this.windowText, nextText)
      : null;
    this.identity = projection.identity;
    this.windowText = nextText;
    if (append === null) {
      this.buffer = nextText;
      this.renderAndSnap();
      return;
    }
    if (!append) return;

    let nextBuffer = this.buffer + append;
    const nextCharacters = codePoints(nextBuffer);
    let compensatedScrollLeft = this.elements.viewport.scrollLeft;
    if (nextCharacters.length > MAX_BUFFER_CODE_POINTS) {
      const removeCount = nextCharacters.length - RUNNING_TRIM_CODE_POINTS;
      if (removeCount > codePoints(this.buffer).length) {
        this.buffer = nextCharacters.slice(-RUNNING_TRIM_CODE_POINTS).join('');
        this.renderAndSnap();
        return;
      }
      const removedWidth = this.measurePrefix(removeCount, this.elements.value);
      if (compensatedScrollLeft <= removedWidth + FOLLOW_EPSILON_PX) {
        this.buffer = nextCharacters.slice(-RUNNING_TRIM_CODE_POINTS).join('');
        this.renderAndSnap();
        return;
      }
      nextBuffer = nextCharacters.slice(-RUNNING_TRIM_CODE_POINTS).join('');
      compensatedScrollLeft = Math.max(0, compensatedScrollLeft - removedWidth);
    }

    this.buffer = nextBuffer;
    this.elements.value.textContent = this.buffer;
    this.elements.viewport.scrollLeft = compensatedScrollLeft;
    this.target = this.maximumScrollLeft();
    const distance = this.target - this.elements.viewport.scrollLeft;
    const burstLimit = Math.max(240, this.elements.viewport.clientWidth * 1.5);
    if (this.reducedMotion() || distance > burstLimit) {
      this.snap();
      return;
    }
    this.follow();
  }

  resize(): void {
    if (this.disposed) return;
    this.snap();
  }

  suspend(): void {
    if (this.disposed) return;
    this.snap();
  }

  reducedMotionChanged(): void {
    if (this.disposed || !this.reducedMotion()) return;
    this.snap();
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
  }

  private maximumScrollLeft(): number {
    return Math.max(0, this.elements.viewport.scrollWidth - this.elements.viewport.clientWidth);
  }

  private renderAndSnap(): void {
    this.elements.value.textContent = this.buffer;
    this.snap();
  }

  private snap(): void {
    this.generation += 1;
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    this.target = this.maximumScrollLeft();
    this.elements.viewport.scrollLeft = this.target;
    this.trimSettledBuffer();
  }

  private follow(): void {
    if (this.frame !== null || this.disposed) return;
    const generation = ++this.generation;
    let previousTimestamp: number | null = null;
    let stalledFrames = 0;
    const tick = (timestamp: number) => {
      if (this.disposed || generation !== this.generation) return;
      this.target = this.maximumScrollLeft();
      const current = this.elements.viewport.scrollLeft;
      const delta = this.target - current;
      if (Math.abs(delta) <= FOLLOW_EPSILON_PX) {
        this.elements.viewport.scrollLeft = this.target;
        this.frame = null;
        this.trimSettledBuffer();
        return;
      }
      const elapsedMs = previousTimestamp === null
        ? 1000 / 60
        : Math.min(64, Math.max(1, timestamp - previousTimestamp));
      previousTimestamp = timestamp;
      const alpha = 1 - Math.exp(-elapsedMs / 72);
      const step = delta * alpha;
      this.elements.viewport.scrollLeft = Math.min(this.target, current + step);
      const achieved = this.elements.viewport.scrollLeft;
      stalledFrames = achieved <= current + 0.01 ? stalledFrames + 1 : 0;
      if (stalledFrames >= 2) {
        this.snap();
        return;
      }
      this.frame = this.requestFrame(tick);
    };
    this.frame = this.requestFrame(tick);
  }

  private trimSettledBuffer(): void {
    const characters = codePoints(this.buffer);
    if (characters.length <= SETTLED_BUFFER_CODE_POINTS) return;
    this.buffer = characters.slice(-SETTLED_BUFFER_CODE_POINTS).join('');
    this.elements.value.textContent = this.buffer;
    this.target = this.maximumScrollLeft();
    this.elements.viewport.scrollLeft = this.target;
  }
}
