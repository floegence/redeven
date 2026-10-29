import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { Show, type JSX } from 'solid-js';

export const taskFileSize = (bytes: number) => bytes < 1024 ? bytes + ' B'
  : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';

export function FlowerTaskFileIdentity(props: {
  name: string; title?: string; mime: string; size: number;
  origin?: string; thumbnail?: JSX.Element; status?: JSX.Element;
  onPreview?: () => void; previewLabel: string; previewDisabled?: boolean;
}) {
  const content = () => <>
    <span class="flower-task-file-icon" aria-hidden="true"><Show when={props.thumbnail}
      fallback={<FileItemIcon item={{ name: props.name, type: 'file' }} size={22} />}>{props.thumbnail}</Show></span>
    <span class="flower-task-file-heading"><span class="flower-task-file-name">{props.title || props.name}</span>
      <span class="flower-task-file-meta"><Show when={props.origin}><span>{props.origin}</span></Show><span>{taskFileSize(props.size)}</span>{props.status}</span>
    </span>
  </>;
  return <Show when={props.onPreview} fallback={<div class="flower-task-file-identity">{content()}</div>}>
    <button type="button" class="flower-task-file-identity flower-task-file-preview" disabled={props.previewDisabled}
      aria-label={props.previewLabel + ': ' + (props.title || props.name)} title={props.name} onClick={() => props.onPreview?.()}>{content()}</button>
  </Show>;
}
