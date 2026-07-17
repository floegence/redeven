import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { AlertCircle, Refresh } from '@floegence/floe-webapp-core/icons';
import { Input, Tag } from '@floegence/floe-webapp-core/ui';

import type { DesktopSSHConfigHost } from '../shared/desktopSSHConfig';
import type { DesktopI18n } from '../shared/i18n';
import {
  DesktopAnchoredListbox,
  scrollDesktopListboxOptionIntoView,
} from './DesktopAnchoredListbox';
import { DesktopTooltip } from './DesktopTooltip';
import {
  filterAndRankSSHConfigHosts,
  sshConfigHostEndpointLabel,
} from './sshConfigHostOptions';

export type SSHDestinationComboboxProps = Readonly<{
  i18n: DesktopI18n;
  inputID: string;
  value: string;
  hosts: readonly DesktopSSHConfigHost[];
  loading: boolean;
  loadError: boolean;
  autofocus: boolean;
  class?: string;
  onInput: (value: string) => void;
  onSelectHost: (host: DesktopSSHConfigHost) => void;
  onRetry: () => void;
}>;

export function SSHDestinationCombobox(props: SSHDestinationComboboxProps) {
  const [open, setOpen] = createSignal(false);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let closeTimer: number | undefined;
  let rootRef: HTMLDivElement | undefined;
  let overlayRef: HTMLDivElement | undefined;
  let optionsRef: HTMLDivElement | undefined;

  const filteredHosts = createMemo(() => filterAndRankSSHConfigHosts(props.hosts, props.value));
  const showEmptyState = createMemo(() => (
    !props.loading && (!props.loadError || props.hosts.length > 0)
  ));
  const emptyStateMessage = createMemo(() => (
    props.hosts.length === 0 && props.value.trim() === ''
      ? props.i18n.t('connectionDialog.sshConfigEmpty')
      : props.i18n.t('connectionDialog.sshConfigNoMatches')
  ));
  const optionsID = () => `${props.inputID}-options`;
  const optionID = (index: number) => `${props.inputID}-option-${index}`;

  createEffect(on(
    [() => props.value, () => props.hosts],
    () => setHighlightedIndex(0),
  ));

  createEffect(() => {
    const hostCount = filteredHosts().length;
    if (hostCount <= 0) {
      setHighlightedIndex(0);
      return;
    }
    if (highlightedIndex() >= hostCount) {
      setHighlightedIndex(hostCount - 1);
    }
  });

  createEffect(() => {
    if (open() && filteredHosts().length > 0) {
      scrollDesktopListboxOptionIntoView(optionsRef, optionID(highlightedIndex()));
    }
  });

  onCleanup(() => {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
    }
  });

  function containsTarget(target: EventTarget | null): boolean {
    return target instanceof Node && (rootRef?.contains(target) === true || overlayRef?.contains(target) === true);
  }

  function openMenu(): void {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    setOpen(true);
  }

  function closeMenuSoon(): void {
    closeTimer = window.setTimeout(() => setOpen(false), 100);
  }

  function selectHost(host: DesktopSSHConfigHost): void {
    props.onSelectHost(host);
    setOpen(false);
  }

  function moveHighlight(delta: number): void {
    const hostCount = filteredHosts().length;
    if (hostCount <= 0) {
      return;
    }
    setHighlightedIndex((current) => (current + delta + hostCount) % hostCount);
  }

  return (
    <div
      ref={rootRef}
      class="relative"
      onFocusOut={(event) => {
        if (containsTarget(event.relatedTarget)) {
          return;
        }
        closeMenuSoon();
      }}
    >
      <Input
        id={props.inputID}
        value={props.value}
        onInput={(event) => {
          setHighlightedIndex(0);
          props.onInput(event.currentTarget.value);
          openMenu();
        }}
        onFocus={openMenu}
        onKeyDown={(event) => {
          if (!open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            setOpen(true);
          }
          if (!open() || filteredHosts().length <= 0) {
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveHighlight(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveHighlight(-1);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const host = filteredHosts()[highlightedIndex()];
            if (host) {
              selectHost(host);
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
          }
        }}
        placeholder={props.i18n.t('connectionDialog.sshDestinationPlaceholder')}
        size="sm"
        class={cn('w-full', props.class)}
        spellcheck={false}
        autofocus={props.autofocus}
        role="combobox"
        aria-expanded={open() ? 'true' : 'false'}
        aria-controls={optionsID()}
        aria-activedescendant={open() && filteredHosts().length > 0 ? optionID(highlightedIndex()) : undefined}
        aria-autocomplete="list"
        aria-busy={props.loading ? 'true' : 'false'}
      />
      <Show when={open()}>
        <DesktopAnchoredListbox
          anchorRef={rootRef}
          class="shadow-xl"
          maxHeight={320}
          open={open()}
          onOverlayRef={(element) => {
            overlayRef = element;
          }}
        >
          <Show when={props.loading}>
            <div class="flex items-center gap-2 border-b border-border/70 px-3 py-2 text-[11px] text-muted-foreground" role="status">
              <Refresh class="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>{props.i18n.t('connectionDialog.sshConfigLoading')}</span>
            </div>
          </Show>
          <Show when={props.loadError && !props.loading}>
            <div class="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] text-destructive" role="alert">
              <span class="flex min-w-0 items-center gap-2">
                <AlertCircle class="h-3.5 w-3.5 shrink-0" />
                <span class="truncate">{props.i18n.t('connectionDialog.sshConfigLoadFailed')}</span>
              </span>
              <DesktopTooltip content={props.i18n.t('common.retry')} placement="top">
                <button
                  type="button"
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={props.i18n.t('common.retry')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={props.onRetry}
                >
                  <Refresh class="h-3.5 w-3.5" />
                </button>
              </DesktopTooltip>
            </div>
          </Show>
          <div
            id={optionsID()}
            ref={optionsRef}
            class="min-h-0 flex-1 overflow-auto p-1"
            role="listbox"
            onWheel={(event) => {
              const el = event.currentTarget as HTMLElement;
              event.stopPropagation();
              if (el.scrollHeight > el.clientHeight) {
                el.scrollTop += event.deltaY;
              }
            }}
          >
            <Show
              when={filteredHosts().length > 0}
              fallback={(
                <Show when={showEmptyState()}>
                  <div class="px-3 py-3 text-xs text-muted-foreground" role="status">
                    {emptyStateMessage()}
                  </div>
                </Show>
              )}
            >
              <For each={filteredHosts()}>
                {(host, index) => (
                  <button
                    type="button"
                    id={optionID(index())}
                    class={cn(
                      'flex w-full cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-2 text-left transition-colors',
                      highlightedIndex() === index()
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground hover:bg-accent/70 hover:text-accent-foreground',
                    )}
                    role="option"
                    tabIndex={-1}
                    aria-selected={highlightedIndex() === index() ? 'true' : 'false'}
                    onClick={() => selectHost(host)}
                    onMouseEnter={() => setHighlightedIndex(index())}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectHost(host);
                    }}
                  >
                    <span class="min-w-0">
                      <span class="block truncate font-mono text-xs">{host.alias}</span>
                      <span class="block truncate text-[11px] text-muted-foreground">{sshConfigHostEndpointLabel(host)}</span>
                    </span>
                    <Show when={host.port !== null}>
                      <Tag variant="neutral" tone="soft" size="sm" class="shrink-0 cursor-default whitespace-nowrap">
                        {props.i18n.t('connectionDialog.sshPortTag', { port: host.port ?? '' })}
                      </Tag>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </DesktopAnchoredListbox>
      </Show>
    </div>
  );
}
