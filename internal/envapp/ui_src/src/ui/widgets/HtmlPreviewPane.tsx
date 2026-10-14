import { Show, useContext } from 'solid-js';
import { SandboxedHtmlFrame } from '@floegence/floe-webapp-core/html-preview';
import { TextFilePreviewPane, type TextFilePreviewPaneProps } from './TextFilePreviewPane';
import { FilePreviewContext } from './FilePreviewContext';
import { useI18n } from '../i18n';

export interface HtmlPreviewPaneProps extends TextFilePreviewPaneProps {
  allowLocalWheel?: boolean;
  loading?: boolean;
}

export function HtmlPreviewPane(props: HtmlPreviewPaneProps) {
  const navigation = useContext(FilePreviewContext);
  const i18n = useI18n();

  return (
    <Show when={props.editing} fallback={
      <Show when={!props.loading && !props.truncated}>
        <Show when={props.path} keyed>
          {path => (
            <SandboxedHtmlFrame
              class="html-preview-frame block h-full min-h-0 w-full border-0"
              title={path}
              html={props.text}
              labels={{ linkUnavailable: i18n.t('flowerSurface.chat.media.linkUnavailable'), anchorUnavailable: i18n.t('flowerSurface.chat.media.anchorUnavailable') }}
              onOpenLink={(href, signal) => {
                if (!navigation?.openHtmlLink) throw new Error(i18n.t('flowerSurface.chat.media.linkUnavailable'));
                return navigation.openHtmlLink(path, href, signal);
              }}
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
