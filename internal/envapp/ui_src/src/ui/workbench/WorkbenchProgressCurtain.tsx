import { createMemo } from 'solid-js';

import { useI18n, type I18nHelpers } from '../i18n';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';

export type WorkbenchProgressCurtainStage =
  | 'layout'
  | 'canvas'
  | 'ready';

export interface WorkbenchProgressCurtainProps {
  visible: boolean;
  stage: WorkbenchProgressCurtainStage;
}

function workbenchProgressCurtainStatusText(
  stage: WorkbenchProgressCurtainStage,
  t: I18nHelpers['t'],
): string {
  switch (stage) {
    case 'layout':
      return t('workbench.progress.layout');
    case 'canvas':
      return t('workbench.progress.canvas');
    case 'ready':
      return t('workbench.progress.ready');
    default:
      return t('workbench.progress.ready');
  }
}

export function WorkbenchProgressCurtain(props: WorkbenchProgressCurtainProps) {
  const i18n = useI18n();
  const statusText = createMemo(() => workbenchProgressCurtainStatusText(props.stage, i18n.t));

  return (
    <RedevenLoadingCurtain
      visible={props.visible}
      surface="page"
      eyebrow={i18n.t('workbench.title')}
      message={statusText()}
      class="redeven-workbench-progress-curtain"
      dataStage={props.stage}
    />
  );
}
