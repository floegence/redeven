import { For, Show, type Component } from 'solid-js';
import { ArrowLeft, Download, Globe, Highlighter, LayoutDashboard, Search, X, ChevronRight } from '@floegence/floe-webapp-core/icons';
import { NotesOverlayIcon } from '@floegence/floe-webapp-core/notes';
import type { EnvAppThemePickerProps } from './EnvAppThemePicker';
import { EnvAppThemePicker } from './EnvAppThemePicker';
import { LanguagePreferenceMenu } from './i18n/LanguagePreferenceMenu';
import { localeDisplayName } from './i18n/localeMeta';
import { useI18n } from './i18n';
import { DownloadTaskPanel } from './downloads/DownloadTaskPanel';
import type { DownloadManager } from './downloads/types';

export type MobileToolsPage = 'more' | 'downloads' | 'language' | 'appearance';

export function handleMobileToolsEscape(event: KeyboardEvent, page: MobileToolsPage | 'plugins' | 'closed', onBack: () => void) {
  if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing
    && page !== 'more' && page !== 'plugins' && page !== 'closed') {
    event.preventDefault();
    onBack();
  }
}

export function MobileShellTools(props: {
  page: MobileToolsPage;
  onPageChange: (page: MobileToolsPage) => void;
  onClose: () => void;
  onSearch: () => void;
  onNotes: () => void;
  onDashboard: () => void;
  manager: DownloadManager;
  theme: Pick<EnvAppThemePickerProps, 'onSourceChange' | 'onShellThemeChange'>;
  notify: { success: (title: string, message: string) => void };
}) {
  const i18n = useI18n();
  const badge = () => props.manager.activeCount() || (props.manager.tasks().some(task => task.status === 'failed') ? '!' : '');
  const title = () => props.page === 'downloads' ? i18n.t('uiCopy.downloads.title')
    : props.page === 'language' ? i18n.t('language.label')
      : props.page === 'appearance' ? i18n.t('shell.themePicker.title') : i18n.t('shell.mobileTools.more');
  const entries = (): { id: string; label: string; icon: Component<{ class?: string }>; onClick: () => void; detail?: string | number }[] => [
    { id: 'search', label: i18n.t('shell.mobileTools.search'), icon: Search, onClick: props.onSearch },
    { id: 'notes', label: i18n.t('shell.topbar.notesOverlay'), icon: NotesOverlayIcon, onClick: props.onNotes },
    { id: 'downloads', label: i18n.t('uiCopy.downloads.title'), icon: Download, onClick: () => props.onPageChange('downloads'), detail: badge() },
    ...(i18n.source() === 'browser' ? [{ id: 'language', label: i18n.t('language.label'), icon: Globe,
      onClick: () => props.onPageChange('language'), detail: localeDisplayName(i18n.locale()) }] : []),
    { id: 'appearance', label: i18n.t('shell.themePicker.title'), icon: Highlighter, onClick: () => props.onPageChange('appearance') },
    { id: 'dashboard', label: i18n.t('shell.topbar.backToDashboard'), icon: LayoutDashboard, onClick: props.onDashboard },
  ];
  return <div class="mobile-shell-tools flex min-h-0 flex-col">
    <header class="flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <Show when={props.page !== 'more'}>
        <button type="button" class="mobile-tools-icon" aria-label={i18n.t('shell.mobileTools.back')}
          onClick={() => props.onPageChange('more')}><ArrowLeft class="h-5 w-5" /></button>
      </Show>
      <h2 class="min-w-0 flex-1 text-base font-semibold">{title()}</h2>
      <button type="button" class="mobile-tools-icon" data-floe-autofocus aria-label={i18n.t('common.actions.close')}
        onClick={props.onClose}><X class="h-5 w-5" /></button>
    </header>
    <div class="min-h-0 overflow-y-auto overscroll-contain">
      <Show when={props.page === 'more'}><div class="p-2">
        <For each={entries()}>{entry => <button type="button" data-mobile-tool={entry.id}
          class="mobile-tools-row" onClick={() => entry.onClick()}>
          <entry.icon class="h-5 w-5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 text-left">{entry.label}</span>
          <Show when={entry.detail}><span class="max-w-28 truncate text-xs text-muted-foreground">{entry.detail}</span></Show>
          <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>}</For>
      </div></Show>
      <Show when={props.page === 'downloads'}><DownloadTaskPanel manager={props.manager} inline /></Show>
      <Show when={props.page === 'language'}><LanguagePreferenceMenu variant="inline" notify={props.notify} /></Show>
      <Show when={props.page === 'appearance'}><EnvAppThemePicker presentation="inline" {...props.theme} /></Show>
    </div>
  </div>;
}
