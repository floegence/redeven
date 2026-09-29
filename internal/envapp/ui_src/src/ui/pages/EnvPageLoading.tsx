import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { BuiltinActivityPage } from '../services/activityNavigation';
import { ActivityPageLoading } from '../primitives/ActivityPageLoading';
import { CodespacesPageSkeleton } from './CodespacesPresentation';
import { HostApplicationsPageSkeleton } from './HostApplicationsPresentation';
import { WebServicesPageSkeleton } from './WebServicesPresentation';
import { ContainersPageSkeleton } from './ContainersPresentation';
import { FileBrowserPageLoading } from './FileBrowserPageLoading';

type PageLoadingContext = { environment?: string; stateScope?: string; variant?: 'activity' | 'workbench' };

/** Every built-in page declares its initial presentation and document handoff once. */
export const ENV_PAGE_PRESENTATIONS: Record<BuiltinActivityPage, {
  loading: Component<PageLoadingContext>;
  restoreGeometry: boolean;
}> = {
  terminal: { loading: ActivityPageLoading, restoreGeometry: false },
  monitor: { loading: ActivityPageLoading, restoreGeometry: false },
  files: { loading: FileBrowserPageLoading, restoreGeometry: true },
  codespaces: { loading: CodespacesPageSkeleton, restoreGeometry: true },
  ports: { loading: WebServicesPageSkeleton, restoreGeometry: true },
  applications: { loading: HostApplicationsPageSkeleton, restoreGeometry: true },
  containers: { loading: ContainersPageSkeleton, restoreGeometry: true },
  ai: { loading: ActivityPageLoading, restoreGeometry: false },
  settings: { loading: ActivityPageLoading, restoreGeometry: false },
  'plugin-center': { loading: ActivityPageLoading, restoreGeometry: false },
};

export function envPagePresentation(page: string) {
  return Object.hasOwn(ENV_PAGE_PRESENTATIONS, page)
    ? ENV_PAGE_PRESENTATIONS[page as BuiltinActivityPage]
    : { loading: ActivityPageLoading, restoreGeometry: false };
}

export function EnvPageLoading(props: PageLoadingContext & { page: string }) {
  return <div class="h-full min-h-0" data-env-page-loading aria-busy="true">
    <Dynamic component={envPagePresentation(props.page).loading} environment={props.environment} stateScope={props.stateScope} variant={props.variant} />
  </div>;
}
