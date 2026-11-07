import { createSignal, Show, useContext } from 'solid-js';
import { createTextSearch } from '@floegence/floe-webapp-core/ui';
import { FilePreviewSearchOverlay, registerFilePreviewSearch } from './FilePreviewSearch';
import { usePreviewSearchLabels } from './previewSearchLabels';
import { SandboxedHtmlFrame, type SandboxedHtmlSearch } from '@floegence/floe-webapp-core/html-preview';
import { TextFilePreviewPane, type TextFilePreviewPaneProps } from './TextFilePreviewPane';
import { FilePreviewContext } from './FilePreviewContext';
import { useI18n } from '../i18n';
import '../../styles/htmlPreview.css';

export interface HtmlPreviewPaneProps extends TextFilePreviewPaneProps {
  allowLocalWheel?: boolean;
  loading?: boolean;
  active?: boolean;
}

export function HtmlPreviewPane(props: HtmlPreviewPaneProps) {
  const navigation = useContext(FilePreviewContext);
  const i18n = useI18n();

  const [api, setApi] = createSignal<SandboxedHtmlSearch>();
  const [ready, setReady] = createSignal(false);
  const [state, setState] = createSignal({ current: 0, total: 0 });
  const labels = usePreviewSearchLabels();
  const search = createTextSearch({
    identity: () => props.text,
    active: () => props.active !== false && !props.editing,
    engine: {
      state,
      search: (query, direction) => { if (ready()) api()?.search(query, direction); },
      clear: () => api()?.clear(),
    },
  });
  registerFilePreviewSearch({ show: search.show, expanded: search.open, enabled: () => props.active !== false && ready() }, () => !props.editing);
  const pending = () => <div class="redeven-html-preview-pending" role="status"><span>{i18n.t('filePreview.loadingFile')}</span></div>;

  return (
    <Show when={props.editing} fallback={
      <Show when={!props.loading && !props.truncated} fallback={<Show when={props.loading}>{pending()}</Show>}>
        <Show when={props.path} keyed>
          {path => (
            <div class="relative h-full min-h-0" onKeyDown={search.onKeyDown}>
              <FilePreviewSearchOverlay search={search} labels={labels} />
              <SandboxedHtmlFrame
                onSearchReady={setApi}
                onSearchState={setState}
                onPresentationStateChange={state => setReady(state === 'ready')}
                onSearchRequest={action => action === 'open' ? search.show() : search.close()}
                class="html-preview-frame block h-full min-h-0 w-full border-0"
                title={path}
                html={props.text}
                active={props.active}
                renderPending={pending}
                labels={{ linkUnavailable: i18n.t('flowerSurface.chat.media.linkUnavailable'), anchorUnavailable: i18n.t('flowerSurface.chat.media.anchorUnavailable') }}
                onOpenLink={(href, signal) => {
                  if (!navigation?.openHtmlLink) throw new Error(i18n.t('flowerSurface.chat.media.linkUnavailable'));
                  return navigation.openHtmlLink(path, href, signal);
                }}
                inert={props.allowLocalWheel === false || props.active === false}
                tabIndex={props.allowLocalWheel === false || props.active === false ? -1 : 0}
                style={{ 'pointer-events': props.allowLocalWheel === false ? 'none' : undefined }}
              />
            </div>
          )}
        </Show>
      </Show>
    }>
      <TextFilePreviewPane {...props} />
    </Show>
  );
}
