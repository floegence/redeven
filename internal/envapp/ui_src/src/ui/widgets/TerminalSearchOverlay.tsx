import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { ChevronDown, ChevronUp, RefreshIcon, X } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';

export type TerminalSearchOverlayProps = Readonly<{
  mobile: boolean;
  query: string;
  resultCount: number;
  resultIndex: number;
  state: 'idle' | 'searching' | 'ready' | 'error';
  inputRef: (element: HTMLInputElement) => void;
  onQueryChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRetry: () => void;
  onClose: () => void;
}>;

export function TerminalSearchOverlay(props: TerminalSearchOverlayProps) {
  const i18n = useI18n();
  const resultLabel = () => (
    props.resultCount <= 0 || props.resultIndex < 0
      ? '0/0'
      : `${props.resultIndex + 1}/${props.resultCount}`
  );

  return (
    <div class={`absolute top-2 z-20 flex items-center gap-1 rounded-md border border-[var(--redeven-terminal-search-border)] bg-[var(--redeven-terminal-search-background)] px-2 py-1 shadow-md backdrop-blur ${props.mobile ? 'left-2 right-2' : 'right-2'}`}>
      <Input
        ref={props.inputRef}
        size="sm"
        value={props.query}
        placeholder={i18n.t('terminal.searchPlaceholder')}
        class={`${props.mobile ? 'min-w-0 flex-1' : 'w-[220px]'} bg-[var(--redeven-terminal-search-input)] border-[var(--redeven-terminal-search-border)] text-[var(--redeven-terminal-search-foreground)] placeholder:text-[var(--redeven-terminal-search-muted)] focus:ring-[var(--redeven-terminal-search-accent)] focus:border-[var(--redeven-terminal-search-accent)] shadow-none`}
        onInput={(event) => props.onQueryChange(event.currentTarget.value)}
      />
      <div
        aria-live="polite"
        class={`text-[10px] tabular-nums text-right ${props.state === 'error' ? 'max-w-[150px] text-destructive' : 'min-w-[54px] text-[var(--redeven-terminal-search-muted)]'}`}
        data-terminal-search-state={props.state}
      >
        {props.state === 'error' ? i18n.t('terminal.olderOutputUnavailable') : resultLabel()}
      </div>
      {props.state === 'error' ? (
        <Button
          size="sm"
          variant="ghost"
          class="h-7 w-7 shrink-0 p-0 text-[var(--redeven-terminal-search-foreground)] hover:bg-[var(--redeven-terminal-search-hover)] hover:text-[var(--redeven-terminal-search-foreground)]"
          onClick={props.onRetry}
          title={i18n.t('terminal.retry')}
          aria-label={i18n.t('terminal.retry')}
          data-terminal-search-retry="true"
        >
          <RefreshIcon class="h-3.5 w-3.5" />
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        class="h-7 w-7 shrink-0 p-0 text-[var(--redeven-terminal-search-foreground)] hover:bg-[var(--redeven-terminal-search-hover)] hover:text-[var(--redeven-terminal-search-foreground)]"
        onClick={props.onPrevious}
        disabled={props.state === 'error' || props.state === 'searching' || props.resultCount <= 0}
        title={i18n.t('terminal.previous')}
      >
        <ChevronUp class="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        class="h-7 w-7 shrink-0 p-0 text-[var(--redeven-terminal-search-foreground)] hover:bg-[var(--redeven-terminal-search-hover)] hover:text-[var(--redeven-terminal-search-foreground)]"
        onClick={props.onNext}
        disabled={props.state === 'error' || props.state === 'searching' || props.resultCount <= 0}
        title={i18n.t('terminal.next')}
      >
        <ChevronDown class="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        class="h-7 w-7 shrink-0 p-0 text-[var(--redeven-terminal-search-foreground)] hover:bg-[var(--redeven-terminal-search-hover)] hover:text-[var(--redeven-terminal-search-foreground)]"
        onClick={props.onClose}
        title={i18n.t('terminal.close')}
      >
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
