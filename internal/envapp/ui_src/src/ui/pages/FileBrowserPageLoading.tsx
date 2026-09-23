import { useLayout, useResolvedFloeConfig } from '@floegence/floe-webapp-core';
import { MoreHorizontal, Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import { FileBrowserWorkspace } from '../widgets/FileBrowserWorkspace';
import { useI18n } from '../i18n';
import { resolveRendererStorageScopeID } from '../services/desktopSessionContext';

export const PAGE_SIDEBAR_DEFAULT_WIDTH = 240;
export const PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'redeven:remote-file-browser:page-sidebar-width';

export function normalizePageSidebarWidth(width: unknown): number {
  const raw = typeof width === 'number' && Number.isFinite(width) ? width : PAGE_SIDEBAR_DEFAULT_WIDTH;
  return Math.max(180, Math.min(520, Math.round(raw)));
}

/** The module fallback uses the same pending workspace as directory discovery. */
export function FileBrowserPageLoading(props: { environment?: string; stateScope?: string }) {
  const floe = useResolvedFloeConfig();
  const layout = useLayout();
  const i18n = useI18n();
  const scope = () => resolveRendererStorageScopeID(props.environment || 'env_local');
  const stateScope = props.stateScope?.trim() || 'page';
  const scopedKey = (key: string) => stateScope === 'page' ? key : `${key}:${stateScope}`;
  const savedWidth = floe.persist.load<number>(scopedKey(PAGE_SIDEBAR_WIDTH_STORAGE_KEY), PAGE_SIDEBAR_DEFAULT_WIDTH);
  const width = normalizePageSidebarWidth(savedWidth);
  return <FileBrowserWorkspace mode="files" onModeChange={() => {}} gitHistoryDisabled initializing
    files={[]} currentPath="" initialPath="" resetKey={0} instanceId="files-module-loading"
    persistenceKey={scope() ? stateScope === 'page' ? `files:${scope()}` : `files:${stateScope}:${scope()}` : undefined} width={width} open={!layout.isMobile()}
    toolbarEndActions={<>
      <Button size="sm" variant="ghost" icon={Refresh} disabled aria-label={i18n.t('files.refreshCurrentDirectory')}>
        {i18n.t('common.actions.refresh')}
      </Button>
      <Button size="sm" variant="ghost" disabled aria-label={i18n.t('files.moreFileBrowserOptions')}>
        <MoreHorizontal class="size-3.5" />
      </Button>
    </>} />;
}
