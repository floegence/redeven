import { useTheme } from '@floegence/floe-webapp-core';
import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { highlightCodeToHtml, resolveCodeHighlightTheme } from '../utils/shikiHighlight';

const MAX_HIGHLIGHT_CHARACTERS = 160 * 1024;

export interface CodePreviewPaneProps {
  code: string;
  language?: string;
}

export function CodePreviewPane(props: CodePreviewPaneProps) {
  const theme = useTheme();
  const [highlightedHtml, setHighlightedHtml] = createSignal('');
  const [highlightError, setHighlightError] = createSignal<string | null>(null);
  let highlightRequestSeq = 0;

  const disabledReason = createMemo(() => {
    if (props.code.length <= MAX_HIGHLIGHT_CHARACTERS) return null;
    return 'Syntax highlighting disabled for large files.';
  });

  const themeName = createMemo(() => resolveCodeHighlightTheme(theme.resolvedTheme()));
  const statusText = createMemo(() => disabledReason() ?? highlightError());

  createEffect(() => {
    const code = props.code;
    const language = props.language;
    const disabled = disabledReason();
    const nextTheme = themeName();
    const seq = (highlightRequestSeq += 1);

    setHighlightedHtml('');
    setHighlightError(null);

    if (!code || disabled || !language) return;

    void highlightCodeToHtml({
      code,
      language,
      theme: nextTheme,
    }).then((html) => {
      if (seq !== highlightRequestSeq) return;
      if (!html) {
        setHighlightError('Syntax highlighting unavailable for this language.');
        return;
      }
      setHighlightedHtml(html);
    });
  });

  return (
    <div class="code-preview-pane flex min-h-0 flex-1 flex-col">
      <Show when={props.language || statusText()}>
        <div class="code-preview-pane__meta flex items-center gap-2 border-b border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
          <Show when={props.language}>
            <span class="code-preview-pane__badge rounded-full border border-border/80 px-2 py-0.5 font-mono uppercase tracking-[0.08em] text-[10px] text-foreground/80">
              {props.language}
            </span>
          </Show>
          <Show when={statusText()}>
            <span class="min-w-0 truncate">{statusText()}</span>
          </Show>
        </div>
      </Show>

      <Show
        when={highlightedHtml()}
        fallback={(
          <pre class="code-preview-pane__plain min-h-0 flex-1 overflow-auto whitespace-pre select-text">
            <code>{props.code}</code>
          </pre>
        )}
      >
        <div class="code-preview-pane__html code-preview-pane__with-line-numbers min-h-0 flex-1 overflow-auto">
          {/* eslint-disable-next-line solid/no-innerhtml */}
          <div innerHTML={highlightedHtml()} />
        </div>
      </Show>
    </div>
  );
}
