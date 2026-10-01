import { Show, createMemo } from 'solid-js';
import { sandboxedMarkdownHtml } from '@floegence/floe-webapp-core/chat-media';
import { TextFilePreviewPane, type TextFilePreviewPaneProps } from './TextFilePreviewPane';

export interface HtmlPreviewPaneProps extends TextFilePreviewPaneProps {
  allowLocalWheel?: boolean;
  loading?: boolean;
}

export function HtmlPreviewPane(props: HtmlPreviewPaneProps) {
  const document = createMemo(() => sandboxedMarkdownHtml(props.text));

  return (
    <Show when={props.editing} fallback={
      <Show when={!props.loading && !props.truncated}>
        <Show when={props.path} keyed>
          {path => (
            <iframe
              class="html-preview-frame block h-full min-h-0 w-full border-0"
              title={path}
              sandbox="allow-scripts"
              referrerpolicy="no-referrer"
              srcdoc={document()}
              inert={props.allowLocalWheel === false}
              tabIndex={props.allowLocalWheel === false ? -1 : 0}
              style={{ 'pointer-events': props.allowLocalWheel === false ? 'none' : undefined }}
            />
          )}
        </Show>
      </Show>
    }>
      <TextFilePreviewPane {...props} />
    </Show>
  );
}
