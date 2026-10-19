import { For, Show, type Component } from 'solid-js';
import type { FlowerToolPreview } from './contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from './copy';
import { FlowerActivityPreview } from './FlowerActivityPreview';

export const FlowerThreadToolPreview: Component<{
  preview?: FlowerToolPreview;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  copy: FlowerSurfaceCopy['chat'];
}> = (props) => {
  const words = () => props.copy.toolActivity;
  const label = (key: string) => ({ query: words().inputQuery, title: words().previewTitle, arguments: words().inputs,
    result: words().results, name: words().inputName, object: words().inputType, roles: words().previewRole,
    tool_names: words().previewTool, statuses: words().previewStatus, group_by: words().previewGroupBy, body: '',
    limit: words().inputLimit, sort: words().previewSort, scope: words().inputContext,
  })[key];
  const value = (text: string) => ({ threads: words().previewThreads, messages: words().previewMessages, tool_calls: words().previewToolCalls })[text] ?? text;
  const inputValue = (title: string, content: string) => title === 'scope'
    ? content === 'all' ? words().previewScopeAll : words().previewScopeSelected.replace('{count}', content)
    : title === 'object' ? value(content) : content;
  return <div class="flower-thread-tool-preview" aria-live="polite">
    <Show when={props.loading}><p class="flower-activity-detail-notice">{words().previewLoading}</p></Show>
    <Show when={props.failed}>
      <p class="flower-activity-detail-notice">{words().previewFailed}</p>
      <button type="button" class="flower-activity-detail-expand" onClick={props.retry}>{words().previewRetry}</button>
    </Show>
    <Show when={props.preview}>{preview => <>
      <dl class="flower-thread-tool-inputs" data-activity-section="inputs" aria-label={words().inputs}>
        <For each={preview().inputs}>{row => <div>
          <dt>{label(row.title ?? '') ?? row.title}</dt>
          <dd>{inputValue(row.title ?? '', row.content ?? '')}<Show when={row.truncated}><span class="flower-activity-detail-notice">{words().truncated}</span></Show></dd>
        </div>}</For>
      </dl>
      <Show when={preview().total !== undefined}><p class="flower-activity-detail-notice">{words().previewMatches.replace('{count}', String(preview().total))}</p></Show>
      <FlowerActivityPreview copy={props.copy} block={{ kind: 'structured_rows', section: 'results', preview: true, previewMeta: true,
        rows: preview().rows.map(row => ({ ...row, title: preview().tool_name === 'threads.read' ? label(row.title ?? '') ?? '' : row.title ?? '', content: row.content ?? '', meta: row.meta ?? '' })),
        ...(!preview().rows.length && preview().tool_name !== 'threads.aggregate' ? { notice: preview().content_unavailable ? words().previewUnavailable : words().noOutput } : {}),
      }} />
      <Show when={preview().has_more}><p class="flower-activity-detail-notice">{words().previewMore}</p></Show>
    </>}</Show>
  </div>;
};
