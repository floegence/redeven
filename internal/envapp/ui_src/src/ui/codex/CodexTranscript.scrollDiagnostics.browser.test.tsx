import '../../index.css';

import { createSignal, type Accessor } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexTranscript } from './CodexTranscript';
import type { CodexTranscriptItem } from './types';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
  useLayout: () => ({
    isMobile: () => false,
  }),
  useNotification: () => ({
    error: vi.fn(),
  }),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    client: () => null,
  }),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    ChevronRight: Icon,
    Code: Icon,
    FileText: Icon,
    Sparkles: Icon,
    Terminal: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
  Button: (props: any) => (
    <button class={props.class} type={props.type ?? 'button'} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  Dialog: (props: any) => (props.open ? <div>{props.children}</div> : null),
}));

vi.mock('../chat/blocks/MarkdownBlock', () => ({
  MarkdownBlock: (props: any) => (
    <div class={props.class} data-markdown-streaming={props.streaming ? 'true' : 'false'}>
      {props.content}
    </div>
  ),
}));

vi.mock('../chat/status/StreamingCursor', () => ({
  StreamingCursor: () => <span>{'\u258B'}</span>,
}));

vi.mock('../icons/CodexIcon', () => ({
  CodexIcon: (props: any) => <span class={props.class}>Codex</span>,
}));

vi.mock('../widgets/FilePreviewContext', () => ({
  useFilePreviewContext: () => ({
    openPreview: vi.fn(async () => undefined),
  }),
}));

vi.mock('../utils/fileStreamReader', () => ({
  readFileBytesOnce: vi.fn(),
}));

vi.mock('../../services/gatewayApi', () => ({
  prepareGatewayRequestInit: vi.fn(async (init?: RequestInit) => init ?? {}),
}));

vi.mock('../../utils/clipboard', () => ({
  writeTextToClipboard: vi.fn(async () => undefined),
}));

function buildCommandExecutionItems(count: number): CodexTranscriptItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `cmd_${index + 1}`,
    type: 'commandExecution',
    order: index,
    status: 'completed',
    exit_code: 0,
    duration_ms: 950 + index,
    cwd: '/workspace/redeven/internal/envapp/ui_src',
    command: `/bin/zsh -lc 'printf \"row ${index + 1}\\n\" && npm test -- src/ui/codex/CodexTranscript.test.tsx && npm run typecheck && npm run build'`,
    aggregated_output: `row ${index + 1}\ncompleted`,
  }));
}

function settleFrames(count = 4): Promise<void> {
  return Array.from({ length: count }).reduce<Promise<void>>(
    (promise) => promise.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))),
    Promise.resolve(),
  );
}

function ScrollHarness(props: Readonly<{
  items: readonly CodexTranscriptItem[];
  followBottomMode?: Accessor<'paused' | 'following'>;
}>) {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLDivElement | null>(null);

  return (
    <div
      style={{
        position: 'fixed',
        inset: '0',
        padding: '20px',
        background: 'var(--background, #fff)',
      }}
    >
      <div
        ref={setScrollContainer}
        data-testid="scroll-container"
        style={{
          width: '720px',
          height: '420px',
          overflow: 'auto',
          border: '1px solid var(--border, #d0d7de)',
          'border-radius': '14px',
          padding: '12px 14px',
          margin: '0 auto',
          'box-sizing': 'border-box',
          background: 'var(--background, #fff)',
        }}
      >
        <CodexTranscript
          scrollContainer={scrollContainer()}
          followBottomMode={props.followBottomMode}
          threadKey="scroll-diagnostics-thread"
          items={props.items}
          emptyTitle="Empty"
          emptyBody="Nothing yet."
        />
      </div>
    </div>
  );
}

type ScrollWrite = Readonly<{
  source: 'driver' | 'runtime';
  value: number;
}>;

function installScrollTopSpy(element: HTMLElement): Readonly<{
  writes: ScrollWrite[];
  driverSet: (value: number) => void;
  restore: () => void;
}> {
  const prototypeChain = [
    Object.getPrototypeOf(element),
    HTMLElement.prototype,
    Element.prototype,
  ].filter(Boolean);
  const descriptor = prototypeChain
    .map((candidate) => Object.getOwnPropertyDescriptor(candidate, 'scrollTop'))
    .find((candidate) => candidate?.get && candidate?.set);

  if (!descriptor?.get || !descriptor?.set) {
    throw new Error('scrollTop descriptor not found');
  }

  const writes: ScrollWrite[] = [];
  let driverWriteDepth = 0;

  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get() {
      return descriptor.get!.call(this);
    },
    set(value: number) {
      writes.push({
        source: driverWriteDepth > 0 ? 'driver' : 'runtime',
        value: Number(value),
      });
      descriptor.set!.call(this, value);
    },
  });

  return {
    writes,
    driverSet(value: number) {
      driverWriteDepth += 1;
      try {
        element.scrollTop = value;
      } finally {
        driverWriteDepth = Math.max(0, driverWriteDepth - 1);
      }
    },
    restore() {
      delete (element as { scrollTop?: number }).scrollTop;
    },
  };
}

async function runScenario(args: Readonly<{
  items: readonly CodexTranscriptItem[];
  stepPx?: number;
  steps?: number;
  initialJumpPx?: number;
}>): Promise<Readonly<{
  rowHeightPx: number;
  runtimeWrites: number;
  maxDriverSettleDelta: number;
  samples: Array<{
    requested: number;
    settled: number;
  }>;
}>> {
  const host = document.createElement('div');
  document.body.append(host);
  const mode = () => 'paused' as const;
  const dispose = render(() => (
    <ScrollHarness items={args.items} followBottomMode={mode} />
  ), host);

  await settleFrames(6);

  const scrollContainer = host.querySelector('[data-testid="scroll-container"]') as HTMLDivElement | null;
  const firstRow = host.querySelector('.codex-transcript-row') as HTMLDivElement | null;
  if (!scrollContainer || !firstRow) {
    dispose();
    throw new Error('scroll harness did not render');
  }

  const rowHeightPx = Math.round(firstRow.getBoundingClientRect().height);
  const spy = installScrollTopSpy(scrollContainer);
  const samples: Array<{ requested: number; settled: number }> = [];
  const stepPx = args.stepPx ?? 160;
  const totalSteps = args.steps ?? 14;
  const maxScrollTop = () => Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  let baseRequested = 0;

  if (typeof args.initialJumpPx === 'number' && Number.isFinite(args.initialJumpPx) && args.initialJumpPx > 0) {
    baseRequested = Math.min(maxScrollTop(), args.initialJumpPx);
    spy.driverSet(baseRequested);
    scrollContainer.dispatchEvent(new Event('scroll'));
    await settleFrames(6);
    samples.push({
      requested: baseRequested,
      settled: scrollContainer.scrollTop,
    });
  }

  for (let index = 0; index < totalSteps; index += 1) {
    const requested = Math.min(
      maxScrollTop(),
      baseRequested + ((index + 1) * stepPx),
    );
    spy.driverSet(requested);
    scrollContainer.dispatchEvent(new Event('scroll'));
    await settleFrames(4);
    samples.push({
      requested,
      settled: scrollContainer.scrollTop,
    });
  }

  const runtimeWrites = spy.writes.filter((entry) => entry.source === 'runtime').length;
  const maxDriverSettleDelta = samples.reduce(
    (max, sample) => Math.max(max, Math.abs(sample.requested - sample.settled)),
    0,
  );

  spy.restore();
  dispose();

  return {
    rowHeightPx,
    runtimeWrites,
    maxDriverSettleDelta,
    samples,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CodexTranscript virtualized shell scroll stability', () => {
  it('does not tug paused scrolling when newly visible shell rows receive their first measurements', async () => {
    const items = buildCommandExecutionItems(120);

    const deepJumpDown = await runScenario({
      items,
      initialJumpPx: 4200,
      stepPx: 72,
      steps: 8,
    });
    const deepJumpUp = await runScenario({
      items,
      initialJumpPx: 4200,
      stepPx: -72,
      steps: 8,
    });

    expect(deepJumpDown.rowHeightPx).toBeGreaterThan(60);
    expect(deepJumpDown.rowHeightPx).toBeLessThanOrEqual(80);
    expect(deepJumpDown.runtimeWrites).toBe(0);
    expect(deepJumpDown.maxDriverSettleDelta).toBe(0);
    expect(deepJumpDown.samples.every((sample) => sample.requested === sample.settled)).toBe(true);

    expect(deepJumpUp.runtimeWrites).toBe(0);
    expect(deepJumpUp.maxDriverSettleDelta).toBe(0);
    expect(deepJumpUp.samples.every((sample) => sample.requested === sample.settled)).toBe(true);
  });

});
