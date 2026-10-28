import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { Show, type JSX } from 'solid-js';

export const taskFileSize = (bytes: number) => bytes < 1024 ? bytes + ' B'
  : bytes < 1048576 ? (bytes / 1024).toFixed(1) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';

export function FlowerTaskFileIdentity(props: {
  name: string; title?: string; mime: string; size: number;
  detail?: JSX.Element; status?: JSX.Element;
  onPreview?: () => void; previewLabel: string; previewDisabled?: boolean;
}) {
  const format = () => props.name.includes('.') ? props.name.split('.').pop()!.toUpperCase() : props.mime.split(';')[0];
  return <div class="flower-task-file-identity">
    <span class="flower-task-file-icon" aria-hidden="true"><FileItemIcon item={{ name: props.name, type: 'file' }} size={22} /></span>
    <div class="flower-task-file-heading">
      <h4 class="flower-task-file-name">
        <Show when={props.onPreview} fallback={props.title || props.name}>
          <button type="button" class="flower-task-file-preview" aria-label={props.previewLabel + ': ' + (props.title || props.name)}
            title={props.previewLabel} disabled={props.previewDisabled} onClick={() => props.onPreview?.()}>{props.title || props.name}</button>
        </Show>
      </h4>
      <div class="flower-task-file-meta"><span title={props.mime}>{format()}</span><span>{taskFileSize(props.size)}</span>{props.status}{props.detail}</div>
    </div>
  </div>;
}
