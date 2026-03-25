import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronUp, Terminal } from '@floegence/floe-webapp-core/icons';

import { resolveAnchoredOverlayPosition, type AnchoredOverlayPosition } from '../primitives/anchoredOverlay';
import type { ContextCompactionEventView, ContextUsageView } from './aiDataNormalizers';

export function CompactContextSummary(props: {
  usage: ContextUsageView | null;
  compactions: ContextCompactionEventView[];
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [showDebug, setShowDebug] = createSignal(false);
  const [position, setPosition] = createSignal<AnchoredOverlayPosition | null>(null);

  let anchorRef: HTMLButtonElement | undefined;
  let panelRef: HTMLDivElement | undefined;
  let frame = 0;

  const clearFrameHandle = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const updatePosition = () => {
    if (!anchorRef || !panelRef || typeof window === 'undefined') return;

    const anchorRect = anchorRef.getBoundingClientRect();
    const panelRect = panelRef.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportOffsetLeft = viewport?.offsetLeft ?? 0;
    const viewportOffsetTop = viewport?.offsetTop ?? 0;

    const nextPosition = resolveAnchoredOverlayPosition({
      anchorRect,
      overlaySize: { width: panelRect.width, height: panelRect.height },
      viewport: { width: viewportWidth, height: viewportHeight },
      preferredPlacement: 'top',
      gap: 8,
      margin: 8,
    });

    setPosition({
      ...nextPosition,
      left: nextPosition.left + viewportOffsetLeft,
      top: nextPosition.top + viewportOffsetTop,
    });
  };

  const scheduleUpdate = () => {
    clearFrameHandle();
    frame = requestAnimationFrame(() => {
      frame = 0;
      updatePosition();
    });
  };

  const usagePercent = createMemo(() => {
    const raw = Number(props.usage?.usagePercent ?? 0);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return raw;
  });
  const usagePercentLabel = createMemo(() => (props.usage ? `${usagePercent().toFixed(1)}%` : '--'));

  type CompactionAttemptView = {
    compactionId: string;
    stepIndex: number;
    stage: ContextCompactionEventView['stage'];
    strategy?: string;
    reason?: string;
    error?: string;
    estimateTokensBefore?: number;
    estimateTokensAfter?: number;
    contextLimit?: number;
    pressure?: number;
    effectiveThreshold?: number;
    configuredThreshold?: number;
    windowBasedThreshold?: number;
    messagesBefore?: number;
    messagesAfter?: number;
    atUnixMs: number;
  };

  const compactionAttempts = createMemo((): CompactionAttemptView[] => {
    const list = Array.isArray(props.compactions) ? props.compactions : [];
    if (list.length <= 0) return [];

    const byID = new Map<string, ContextCompactionEventView[]>();
    for (const entry of list) {
      const id = String(entry?.compactionId ?? '').trim();
      if (!id) continue;
      const existing = byID.get(id);
      if (existing) existing.push(entry);
      else byID.set(id, [entry]);
    }

    const pickLatest = (
      items: ContextCompactionEventView[],
      stage: ContextCompactionEventView['stage'],
    ): ContextCompactionEventView | null => {
      const filtered = items.filter((it) => it.stage === stage);
      if (filtered.length <= 0) return null;
      filtered.sort((a, b) => {
        const atA = Number(a.atUnixMs ?? 0) || 0;
        const atB = Number(b.atUnixMs ?? 0) || 0;
        if (atA !== atB) return atB - atA;
        const idA = Number(a.eventId ?? 0) || 0;
        const idB = Number(b.eventId ?? 0) || 0;
        return idB - idA;
      });
      return filtered[0] ?? null;
    };

    const out: CompactionAttemptView[] = [];
    for (const [id, items] of byID.entries()) {
      if (!items || items.length <= 0) continue;

      const applied = pickLatest(items, 'applied');
      const failed = pickLatest(items, 'failed');
      const skipped = pickLatest(items, 'skipped');
      const started = pickLatest(items, 'started');
      const terminal = applied || failed || skipped || started;
      if (!terminal) continue;

      let atUnixMs = 0;
      for (const item of items) {
        const at = Number(item.atUnixMs ?? 0) || 0;
        if (at > atUnixMs) atUnixMs = at;
      }

      const stage = terminal.stage;
      const stepIndex = Math.max(0, Math.floor(Number(terminal.stepIndex ?? 0) || 0));
      const strategy = String((applied?.strategy ?? failed?.strategy ?? skipped?.strategy ?? started?.strategy ?? '')).trim();
      const reason = String((applied?.reason ?? failed?.reason ?? skipped?.reason ?? started?.reason ?? '')).trim();
      const error = String((applied?.error ?? failed?.error ?? skipped?.error ?? started?.error ?? '')).trim();

      out.push({
        compactionId: id,
        stepIndex,
        stage,
        strategy: strategy || undefined,
        reason: reason || undefined,
        error: error || undefined,
        estimateTokensBefore: applied?.estimateTokensBefore ?? failed?.estimateTokensBefore ?? skipped?.estimateTokensBefore ?? started?.estimateTokensBefore,
        estimateTokensAfter: applied?.estimateTokensAfter ?? skipped?.estimateTokensAfter ?? started?.estimateTokensAfter,
        contextLimit: applied?.contextLimit ?? failed?.contextLimit ?? skipped?.contextLimit ?? started?.contextLimit,
        pressure: applied?.pressure ?? failed?.pressure ?? skipped?.pressure ?? started?.pressure,
        effectiveThreshold: applied?.effectiveThreshold ?? failed?.effectiveThreshold ?? skipped?.effectiveThreshold ?? started?.effectiveThreshold,
        configuredThreshold: applied?.configuredThreshold ?? failed?.configuredThreshold ?? skipped?.configuredThreshold ?? started?.configuredThreshold,
        windowBasedThreshold: applied?.windowBasedThreshold ?? failed?.windowBasedThreshold ?? skipped?.windowBasedThreshold ?? started?.windowBasedThreshold,
        messagesBefore: applied?.messagesBefore ?? skipped?.messagesBefore ?? started?.messagesBefore,
        messagesAfter: applied?.messagesAfter ?? skipped?.messagesAfter ?? started?.messagesAfter,
        atUnixMs,
      });
    }

    out.sort((a, b) => {
      const atA = Number(a.atUnixMs ?? 0) || 0;
      const atB = Number(b.atUnixMs ?? 0) || 0;
      if (atA !== atB) return atA - atB;
      return a.compactionId.localeCompare(b.compactionId);
    });

    if (out.length <= 12) return out;
    return out.slice(out.length - 12);
  });

  const chipLabel = createMemo(() => {
    if (props.usage) {
      return usagePercentLabel();
    }
    const eventCount = compactionAttempts().length;
    return eventCount > 0 ? `${eventCount} events` : '--';
  });
  const usageTokensLabel = createMemo(() => {
    const usage = props.usage;
    if (!usage) return '';
    const used = Math.max(0, Math.floor(Number(usage.estimateTokens ?? 0) || 0));
    const total = Math.max(0, Math.floor(Number(usage.contextLimit ?? 0) || 0));
    if (total <= 0) return '';
    return `${used.toLocaleString('en-US')} / ${total.toLocaleString('en-US')} tok`;
  });
  const usageBadgeClass = createMemo(() => {
    if (!props.usage) return 'bg-muted/50 text-muted-foreground border-border/60 hover:bg-muted hover:text-foreground';
    const percent = usagePercent();
    if (percent >= 90) return 'bg-error/10 text-error border-error/30 hover:bg-error/14';
    if (percent >= 75) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25 hover:bg-amber-500/14';
    return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25 hover:bg-blue-500/14';
  });
  const thresholdLabel = createMemo(() => {
    const usage = props.usage;
    if (!usage) return '--';
    const ratio = Number(usage.effectiveThreshold ?? NaN);
    if (!Number.isFinite(ratio) || ratio <= 0) return '--';
    return `${Math.round(ratio * 100)}%`;
  });
  const turnMessagesLabel = createMemo(() => {
    const usage = props.usage;
    if (!usage) return '--';
    const raw = Number(usage.turnMessages ?? NaN);
    if (!Number.isFinite(raw) || raw <= 0) return '--';
    return Math.max(0, Math.floor(raw)).toLocaleString('en-US');
  });
  const usageMetaLabel = createMemo(() => {
    const usage = props.usage;
    if (!usage) return '';
    const source = String(usage.estimateSource ?? '').trim();
    const contextWindow = Math.max(0, Math.floor(Number(usage.contextWindow ?? 0) || 0));
    const inputWindow = Math.max(0, Math.floor(Number(usage.contextLimit ?? 0) || 0));
    const windowLabel =
      contextWindow > 0 && contextWindow !== inputWindow
        ? `Input window ${inputWindow.toLocaleString('en-US')} / Context window ${contextWindow.toLocaleString('en-US')}`
        : '';
    const at = Number(usage.atUnixMs ?? 0) || 0;
    const timeLabel = at > 0
      ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const parts = [] as string[];
    if (source) parts.push(`Source: ${source}`);
    if (windowLabel) parts.push(windowLabel);
    if (timeLabel) parts.push(`Updated ${timeLabel}`);
    return parts.join(' · ');
  });
  const sortedSections = createMemo(() => {
    const usage = props.usage;
    if (!usage) return [] as Array<[string, number]>;
    const entries = Object.entries(usage.sectionsTokens ?? {})
      .map(([name, value]) => [String(name ?? '').trim(), Math.max(0, Number(value ?? 0) || 0)] as [string, number])
      .filter(([name]) => !!name);
    entries.sort((a, b) => b[1] - a[1]);
    return entries;
  });
  const visibleCompactionAttempts = createMemo(() => {
    const list = compactionAttempts();
    if (showDebug()) return list;
    return list.filter((item) => item.stage === 'applied' || item.stage === 'failed');
  });
  const hiddenAttemptsCount = createMemo(() => {
    const all = compactionAttempts().length;
    const visible = visibleCompactionAttempts().length;
    return Math.max(0, all - visible);
  });
  const debugToggleLabel = createMemo(() => {
    if (showDebug()) return 'Hide debug';
    const hidden = hiddenAttemptsCount();
    if (hidden > 0) return `Show debug (+${hidden})`;
    return 'Show debug';
  });
  const formatRatioPercent = (ratio: number | undefined, digits = 1): string => {
    const raw = Number(ratio ?? NaN);
    if (!Number.isFinite(raw) || raw < 0) return '--';
    return `${(raw * 100).toFixed(digits)}%`;
  };
  const formatCompactionReason = (reason: string | undefined): string => {
    const value = String(reason ?? '').trim().toLowerCase();
    if (!value) return '';
    if (value === 'below_threshold') return 'Below threshold';
    if (value === 'no_effect') return 'No effect';
    return value;
  };

  createEffect(() => {
    if (!expanded()) {
      clearFrameHandle();
      setPosition(null);
      return;
    }

    scheduleUpdate();

    const handleViewportChange = () => scheduleUpdate();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if ((anchorRef && target && anchorRef.contains(target)) || (panelRef && target && panelRef.contains(target))) {
        return;
      }
      setExpanded(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };

    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('resize', handleViewportChange);
    window.visualViewport?.addEventListener('scroll', handleViewportChange);
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);

    const observer = typeof ResizeObserver === 'undefined' || !anchorRef || !panelRef
      ? null
      : new ResizeObserver(() => scheduleUpdate());
    if (observer && anchorRef && panelRef) {
      observer.observe(anchorRef);
      observer.observe(panelRef);
    }

    onCleanup(() => {
      observer?.disconnect();
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('resize', handleViewportChange);
      window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      clearFrameHandle();
    });
  });

  onCleanup(() => {
    clearFrameHandle();
  });

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-context-summary-anchor=""
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded()}
        aria-haspopup="dialog"
        class={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer border transition-all duration-150',
          expanded()
            ? 'bg-primary/10 text-primary border-primary/30'
            : usageBadgeClass(),
        )}
      >
        <Terminal class="w-3.5 h-3.5" />
        <span>{chipLabel()}</span>
        <ChevronUp class={cn('w-3 h-3 transition-transform duration-200', expanded() ? '' : 'rotate-180')} />
      </button>

      <Show when={expanded()}>
        <Portal>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            data-context-summary-popover=""
            class={cn(
              'fixed z-[200] w-[24rem] max-w-[calc(100vw-1rem)] max-sm:w-[calc(100vw-1rem)] rounded-xl overflow-hidden',
              'border border-border/60 bg-card shadow-xl shadow-black/12 backdrop-blur-xl',
              'chat-tasks-panel chat-tasks-panel-open',
            )}
            style={{
              left: position() ? `${position()!.left}px` : '0px',
              top: position() ? `${position()!.top}px` : '0px',
              visibility: position() ? 'visible' : 'hidden',
            }}
          >
            <div class="h-[2px] bg-gradient-to-r from-blue-500/60 via-blue-500/30 to-transparent" />

            <div class="px-3.5 pt-2.5 pb-2 border-b border-border/50 bg-gradient-to-b from-muted/40 to-transparent">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <Terminal class="w-3.5 h-3.5 text-blue-500/80" />
                  <span class="text-[13px] font-semibold text-foreground tracking-tight">Context</span>
                  <span class="text-[10px] font-semibold tabular-nums text-primary bg-primary/10 border border-primary/20 rounded-full px-1.5 py-px leading-none">
                    {usagePercentLabel()}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <Show when={usageTokensLabel()}>
                    <span class="text-[10px] font-mono tabular-nums text-muted-foreground/80">{usageTokensLabel()}</span>
                  </Show>
                  <Show when={compactionAttempts().length > 0}>
                    <button
                      type="button"
                      class={cn(
                        'text-[10px] font-medium px-1.5 py-px rounded border transition-colors',
                        showDebug()
                          ? 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/15'
                          : 'bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted/60 hover:text-foreground',
                      )}
                      title="Show compaction debug events"
                      onClick={() => setShowDebug((value) => !value)}
                    >
                      {debugToggleLabel()}
                    </button>
                  </Show>
                </div>
              </div>
            </div>

            <div class="px-3.5 py-2 border-b border-border/40 bg-muted/10">
              <Show when={props.usage} fallback={
                <div class="text-[11px] text-muted-foreground">No context usage telemetry yet.</div>
              }>
                <div class="grid grid-cols-3 gap-1.5 text-[10px]">
                  <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                    <div
                      class="font-medium text-muted-foreground/70 uppercase tracking-wider"
                      title="One model request equals one round."
                    >
                      Round
                    </div>
                    <div class="font-semibold tabular-nums text-foreground/85">{props.usage?.stepIndex ?? 0}</div>
                  </div>
                  <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                    <div class="font-medium text-muted-foreground/70 uppercase tracking-wider" title="When compaction may trigger.">
                      Threshold
                    </div>
                    <div class="font-semibold tabular-nums text-foreground/85">{thresholdLabel()}</div>
                  </div>
                  <div class="rounded-md bg-muted/40 px-1.5 py-1 text-center">
                    <div class="font-medium text-muted-foreground/70 uppercase tracking-wider">Msgs</div>
                    <div class="font-semibold tabular-nums text-foreground/85">{turnMessagesLabel()}</div>
                  </div>
                </div>

                <Show when={usageMetaLabel()}>
                  <div class="mt-2 text-[10px] text-muted-foreground/80">{usageMetaLabel()}</div>
                </Show>

                <Show when={sortedSections().length > 0}>
                  <div class="mt-2">
                    <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Sections</div>
                    <div class="mt-1 flex flex-wrap gap-1">
                      <For each={sortedSections()}>
                        {([name, value]) => (
                          <span class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px] text-foreground/80">
                            <span class="font-medium">{name}</span>
                            <span class="font-mono tabular-nums text-muted-foreground">{Math.max(0, Math.floor(value)).toLocaleString('en-US')}</span>
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </Show>
            </div>

            <div class="max-h-56 overflow-auto">
              <Show when={visibleCompactionAttempts().length > 0} fallback={
                <div class="px-3.5 py-3 text-[11px] text-muted-foreground text-center">No compaction actions yet.</div>
              }>
                <div class="flex flex-col gap-1.5 p-2.5">
                  <For each={visibleCompactionAttempts()}>
                    {(item) => {
                      const stageClass = () => {
                        switch (item.stage) {
                          case 'started':
                            return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/25';
                          case 'applied':
                            return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25';
                          case 'failed':
                            return 'bg-error/10 text-error border-error/25';
                          default:
                            return 'bg-muted/50 text-muted-foreground border-border/60';
                        }
                      };
                      const stageLabel = () => {
                        switch (item.stage) {
                          case 'started':
                            return 'Started';
                          case 'applied':
                            return 'Applied';
                          case 'failed':
                            return 'Failed';
                          case 'skipped':
                            return 'Skipped';
                          default:
                            return 'Unknown';
                        }
                      };
                      const tokenDeltaLabel = () => {
                        const before = Number(item.estimateTokensBefore ?? NaN);
                        const after = Number(item.estimateTokensAfter ?? NaN);
                        if (Number.isFinite(before) && Number.isFinite(after) && after > 0) {
                          return `${Math.floor(before).toLocaleString('en-US')} → ${Math.floor(after).toLocaleString('en-US')} tok`;
                        }
                        if (Number.isFinite(before) && before > 0) {
                          return `${Math.floor(before).toLocaleString('en-US')} tok`;
                        }
                        return '';
                      };
                      const pressureLabel = () => {
                        const parts: string[] = [];
                        const pressure = formatRatioPercent(item.pressure, 1);
                        if (pressure !== '--') parts.push(`pressure ${pressure}`);
                        const threshold = formatRatioPercent(item.effectiveThreshold, 0);
                        if (threshold !== '--') parts.push(`thr ${threshold}`);
                        return parts.join(' · ');
                      };
                      const messagesDeltaLabel = () => {
                        const before = Number(item.messagesBefore ?? NaN);
                        const after = Number(item.messagesAfter ?? NaN);
                        if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0 || after <= 0) return '';
                        return `msgs ${Math.floor(before)} → ${Math.floor(after)}`;
                      };
                      return (
                        <div class="rounded-lg border border-border/55 bg-background/80 px-2.5 py-1.5">
                          <div class="flex items-center gap-2">
                            <span class={cn('inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold', stageClass())}>
                              {stageLabel()}
                            </span>
                            <span class="text-[10px] text-muted-foreground">round {item.stepIndex}</span>
                            <Show when={formatCompactionReason(item.reason)}>
                              <span
                                class="ml-auto text-[10px] text-muted-foreground truncate max-w-[10rem]"
                                title={formatCompactionReason(item.reason)}
                              >
                                {formatCompactionReason(item.reason)}
                              </span>
                            </Show>
                          </div>
                          <Show when={tokenDeltaLabel() || pressureLabel() || messagesDeltaLabel()}>
                            <div class="mt-1 text-[10px] text-muted-foreground/85">
                              {tokenDeltaLabel()}
                              <Show when={tokenDeltaLabel() && (pressureLabel() || messagesDeltaLabel())}>
                                <span> · </span>
                              </Show>
                              {pressureLabel()}
                              <Show when={pressureLabel() && messagesDeltaLabel()}>
                                <span> · </span>
                              </Show>
                              {messagesDeltaLabel()}
                            </div>
                          </Show>
                          <Show when={item.strategy && showDebug()}>
                            <div class="mt-1 text-[10px] text-muted-foreground/85">strategy: {item.strategy}</div>
                          </Show>
                          <Show when={item.error}>
                            <div class="mt-1 text-[10px] text-error break-words">{item.error}</div>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
