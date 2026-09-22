import { createEffect, createMemo } from 'solid-js';
import { WorkbenchWidgetHeader, type WorkbenchWidgetBodyProps } from '@floegence/floe-webapp-core/workbench';
import { useI18n } from '../i18n';
import { GitDiffPanel } from '../widgets/GitDiffPanel';
import { useEnvWorkbenchInstancesContext } from './EnvWorkbenchInstancesContext';

export function WorkbenchGitDiffWidget(props: WorkbenchWidgetBodyProps) {
  const i18n = useI18n();
  const workbench = useEnvWorkbenchInstancesContext();
  // Layout snapshots recreate placement targets, not Git content summaries.
  // Preserve the panel's request owner until this widget's target really changes.
  const target = createMemo(() => workbench.gitDiffTarget(props.widgetId), undefined, {
    equals: (previous, next) => previous?.repoRootPath === next?.repoRootPath
      && previous?.workspaceSection === next?.workspaceSection
      && previous?.path === next?.path
      && previous?.oldPath === next?.oldPath
      && previous?.newPath === next?.newPath
      && previous?.changeType === next?.changeType,
  });
  const path = () => target()?.newPath || target()?.path || target()?.oldPath || '';
  createEffect(() => workbench.updateWidgetTitle(props.widgetId, path() ? `${i18n.t('gitDiff.title')} · ${path()}` : i18n.t('gitDiff.title')));
  return (
    <div class="redeven-workbench-body-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-workbench-git-diff>
      <WorkbenchWidgetHeader titleTooltip={path()} actions={null} />
      <div class="min-h-0 flex-1 overflow-hidden">
        <GitDiffPanel
          open
          item={target()}
          source={target() ? { kind: 'workspace', repoRootPath: target()!.repoRootPath, workspaceSection: target()!.workspaceSection } : null}
          refreshKey={props.activation?.seq}
          emptyMessage={i18n.t('gitDiff.empty')}
        />
      </div>
    </div>
  );
}
