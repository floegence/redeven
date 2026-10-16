import { createSignal, onCleanup, Show, type Component, type JSX } from 'solid-js';
import { Check, Download, GitBranchPlus } from 'lucide-solid';

export const FlowerAnswerActions: Component<{
  copyButton: JSX.Element;
  timestamp: number;
  exportLabel: string;
  exportedLabel: string;
  forkLabel: string;
  forkBusyLabel: string;
  settled: boolean;
  forkBusy: boolean;
  onExport: () => boolean;
  onFork?: () => void;
}> = props => {
  const [exported, setExported] = createSignal(false);
  let reset: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { if (reset !== undefined) clearTimeout(reset); });
  const date = () => new Date(props.timestamp);
  const validTime = () => props.timestamp > 0 && Number.isFinite(date().getTime());
  return <div class="flower-answer-actions">
    <div class="flower-answer-action-buttons">
      {props.copyButton}
      <button type="button" class="flower-answer-action" aria-label={exported() ? props.exportedLabel : props.exportLabel} title={exported() ? props.exportedLabel : props.exportLabel}
        disabled={!props.settled} data-exported={exported()} onClick={() => {
          if (!props.onExport()) return;
          setExported(true);
          if (reset !== undefined) clearTimeout(reset);
          reset = setTimeout(() => setExported(false), 1600);
        }}>
        <Show when={exported()} fallback={<Download size={18} strokeWidth={2} aria-hidden="true" />}><Check size={18} strokeWidth={2} aria-hidden="true" /></Show>
      </button>
      <Show when={props.onFork}>
        <button type="button" class="flower-answer-action" aria-label={props.forkBusy ? props.forkBusyLabel : props.forkLabel} title={props.forkBusy ? props.forkBusyLabel : props.forkLabel}
          disabled={!props.settled || props.forkBusy} aria-busy={props.forkBusy} onClick={() => props.onFork?.()}>
          <GitBranchPlus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </Show>
    </div>
    <Show when={validTime()}><time class="flower-answer-time" dateTime={date().toISOString()} title={date().toLocaleString()}>{date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time></Show>
  </div>;
};
