import { Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { terminalFontCatalog, type ResolvedTerminalFont } from '../services/terminalFonts';

export function TerminalFontStatus(props: { font: ResolvedTerminalFont; showReady?: boolean }) {
  const i18n = useI18n();
  const message = () => {
    const font = props.font;
    if (font.status === 'loading') return i18n.t('terminal.settings.fontLoading');
    if (font.status === 'failed') return i18n.t('terminal.settings.fontLoadFailed');
    if (font.status === 'fallback') return i18n.t('terminal.settings.fontFallback', {
      requested: font.requestedLabel, actual: font.effectiveLabel ?? '',
    });
    return i18n.t('terminal.settings.fontActual', { font: font.effectiveLabel ?? '' });
  };
  return (
    <Show when={props.showReady || props.font.status === 'fallback' || props.font.status === 'failed'}>
      <div class="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-1 text-xs text-muted-foreground"
        role="status" data-terminal-font-status={props.font.status}>
        <span>{message()}</span>
        <Show when={props.font.status === 'fallback' || props.font.status === 'failed'}>
          <Button size="sm" variant="ghost" onClick={() => { void terminalFontCatalog.prepare(props.font.requestedID, true); }}>
            {i18n.t('terminal.settings.fontRetry')}
          </Button>
        </Show>
      </div>
    </Show>
  );
}
