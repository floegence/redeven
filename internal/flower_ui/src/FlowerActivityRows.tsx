import { CodeBlock } from '@floegence/floe-webapp-core/chat';
import { ChevronDown, ChevronRight } from '@floegence/floe-webapp-core/icons';
import { Index, Show, createEffect, createMemo, createSignal, createUniqueId, on, type JSX, type Component } from 'solid-js';
import type { FlowerActivityDetailBlock } from './flowerActivityPresentation';
import type { FlowerActivityTargetRef } from './contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from './copy';
import { FlowerMarkdownBlock } from './chat/markdown/FlowerMarkdownBlock';

export const FlowerActivityRows: Component<{
  continuous?: boolean;
  block: Extract<FlowerActivityDetailBlock, { kind: 'structured_rows' }>;
  copy: FlowerSurfaceCopy['chat'];
  renderTargetActions?: (target: FlowerActivityTargetRef) => JSX.Element;
  renderContent?: () => JSX.Element;
}> = (props) => (
  <section class="flower-activity-structured-rows" data-activity-section={props.block.section}>
    <Show when={props.block.notice}>
      <p class="flower-activity-detail-notice">{props.block.notice}</p>
    </Show>
    <Index each={props.block.rows}>
      {(row) => {
        const [expanded, setExpanded] = createSignal(false);
        const contentID = createUniqueId();
        // An ordinal identifies a position, not the script occupying it. Keep
        // disclosure through ordinary content growth, but do not carry it to
        // a row whose label, format, or resource owner has changed.
        const disclosureIdentity = createMemo(() => JSON.stringify([props.block.section, row().title, row().meta, row().format, row().language, row().target]));
        let previousContent = row().content;
        createEffect(on([disclosureIdentity, () => row().content], ([identity, content], previous) => {
          // Same labels do not identify a replacement script. Ordinary streamed
          // suffixes retain disclosure; replacing or reordering its source does not.
          if (previous && (identity !== previous[0] || !content.startsWith(previousContent))) setExpanded(false);
          previousContent = content;
        }));
        const script = () => props.block.section === 'inputs' && row().format === 'code';
        const long = () => row().content.length > 1600 || row().content.split('\n').length > 8;
        return (
          <div class="flower-activity-structured-row" data-format={row().format} data-script={script()} data-expanded={expanded()}>
            <Show when={row().title || row().meta}>
              <div class="flower-activity-structured-row-heading">
                <Show when={row().title}><strong>{row().title}</strong></Show>
                <Show when={row().meta}><span>{row().meta}</span></Show>
                <Show when={row().target}>{target => props.renderTargetActions?.(target())}</Show>
              </div>
            </Show>
            <Show when={script()}>
              <button type="button" class="flower-activity-script-toggle" aria-expanded={expanded()} aria-controls={contentID}
                aria-label={expanded() ? props.copy.toolActivity.showLess : props.copy.toolActivity.showAll}
                title={expanded() ? props.copy.toolActivity.showLess : props.copy.toolActivity.showAll}
                onClick={() => setExpanded(value => !value)}>
                <Show when={expanded()} fallback={<ChevronRight class="h-3.5 w-3.5" />}><ChevronDown class="h-3.5 w-3.5" /></Show>
                <code>{row().content.trim().split('\n')[0]}</code>
              </button>
            </Show>
            <Show when={row().content || props.renderContent}>
              <div id={contentID} class="flower-activity-detail-content" data-expanded={expanded() || !long() || props.continuous && !script()}>
                <Show when={props.renderContent} fallback={<>
                <Show when={row().format !== 'text'} fallback={<p class="flower-activity-structured-row-text">{row().content}</p>}>
                  <Show when={row().format === 'markdown'} fallback={<CodeBlock
                    content={row().content}
                    language={row().language || 'text'}
                    copyLabel={props.copy.toolActivity.copy}
                    copiedLabel={props.copy.codeCopied}
                    copyErrorLabel={props.copy.toolActivity.copyFailed}
                  />}>
                    <FlowerMarkdownBlock content={row().content} streaming={false} copyCodeLabel={props.copy.toolActivity.copy} codeCopiedLabel={props.copy.codeCopied} class="flower-activity-structured-row-markdown" />
                  </Show>
                </Show>
                </>}>{render => render()()}</Show>
              </div>
            </Show>
            <Show when={row().truncated}>
              <p class="flower-activity-detail-notice">{props.copy.toolActivity.truncated}</p>
            </Show>
            <Show when={!props.continuous && !script() && long()}>
              <button type="button" class="flower-activity-detail-expand" aria-expanded={expanded()} aria-controls={contentID} onClick={() => setExpanded(value => !value)}>
                {expanded() ? props.copy.toolActivity.showLess : props.copy.toolActivity.showAll}
              </button>
            </Show>
          </div>
        );
      }}
    </Index>
  </section>
);
