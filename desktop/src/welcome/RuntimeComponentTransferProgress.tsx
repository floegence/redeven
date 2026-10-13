import { createMemo, Show } from 'solid-js';
import type { DesktopComponentTaskProgress } from '../shared/desktopComponentTaskProgress';
import type { DesktopI18n } from '../shared/i18n';

export function runtimeComponentTransferPercent(task: DesktopComponentTaskProgress): number | undefined {
  const percent = task.total_bytes && task.total_bytes > 0 && task.completed_bytes !== undefined
    ? task.completed_bytes / task.total_bytes * 100
    : task.transfer_percent;
  return percent !== undefined && Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : undefined;
}

export function RuntimeComponentTransferProgress(props: {
  task: DesktopComponentTaskProgress;
  i18n: DesktopI18n;
  active?: boolean;
}) {
  const percent = createMemo(() => runtimeComponentTransferPercent(props.task));
  const label = createMemo(() => props.i18n.t(props.task.transfer_kind === 'upload'
    ? 'progress.transferUploading' : 'progress.transferDownloading'));
  const size = (bytes: number) => `${props.i18n.formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MiB`;
  const byteDetail = createMemo(() => props.task.completed_bytes === undefined ? ''
    : `${size(props.task.completed_bytes)}${props.task.total_bytes ? ` / ${size(props.task.total_bytes)}` : ''}`);
  return (
    <Show when={props.task.transfer_kind}>
      <div class="redeven-environment-progress__component-transfer" data-active={props.active !== false && props.task.status === 'running'}>
        <Show when={byteDetail() || percent() !== undefined}>
          <div class="redeven-environment-progress__transfer-meta">
            <span>{byteDetail()}</span>
            <Show when={percent() !== undefined}>
              <span>{props.i18n.formatNumber(Math.floor(percent()!) / 100, { style: 'percent', maximumFractionDigits: 0 })}</span>
            </Show>
          </div>
        </Show>
        <div
          class="redeven-environment-progress__transfer-meter"
          data-indeterminate={percent() === undefined}
          role="progressbar"
          aria-label={`${props.i18n.t(props.task.id === 'gateway' ? 'progress.componentName.gateway' : 'progress.componentName.runtime')} · ${label()}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent()}
          aria-valuetext={byteDetail() || undefined}
        >
          <span style={{ width: percent() === undefined ? '35%' : `${percent()}%` }} />
        </div>
      </div>
    </Show>
  );
}
