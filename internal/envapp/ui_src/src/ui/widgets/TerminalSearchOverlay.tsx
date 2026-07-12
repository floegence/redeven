import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { ChevronDown, ChevronUp, X } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';

export type TerminalSearchOverlayProps = Readonly<{
  mobile: boolean;
  query: string;
  resultCount: number;
  resultIndex: number;
  inputRef: (element: HTMLInputElement) => void;
  onQueryChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
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
    <div class={`absolute top-2 z-20 flex items-center gap-1 rounded-md border border-white/15 bg-[#0b0f14]/95 px-2 py-1 shadow-md backdrop-blur ${props.mobile ? 'left-2 right-2' : 'right-2'}`}>
      <Input
        ref={props.inputRef}
        size="sm"
        value={props.query}
        placeholder={i18n.t('terminal.searchPlaceholder')}
        class={`${props.mobile ? 'min-w-0 flex-1' : 'w-[220px]'} bg-black/20 border-white/20 text-[#e5e7eb] placeholder:text-[#94a3b8] focus:ring-yellow-400 focus:border-yellow-400 shadow-none`}
        onInput={(event) => props.onQueryChange(event.currentTarget.value)}
      />
      <div class="text-[10px] text-[#94a3b8] tabular-nums min-w-[54px] text-right">
        {resultLabel()}
      </div>
      <Button
        size="sm"
        variant="ghost"
        class="h-7 w-7 shrink-0 p-0 text-[#e5e7eb] hover:bg-white/10 hover:text-white"
        onClick={props.onPrevious}
        disabled={props.resultCount <= 0}
        title={i18n.t('terminal.previous')}
      >
        <ChevronUp class="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        class="h-7 w-7 shrink-0 p-0 text-[#e5e7eb] hover:bg-white/10 hover:text-white"
        onClick={props.onNext}
        disabled={props.resultCount <= 0}
        title={i18n.t('terminal.next')}
      >
        <ChevronDown class="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        class="h-7 w-7 shrink-0 p-0 text-[#e5e7eb] hover:bg-white/10 hover:text-white"
        onClick={props.onClose}
        title={i18n.t('terminal.close')}
      >
        <X class="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
