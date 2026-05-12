import { createMemo } from 'solid-js';

import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';

export type WorkbenchProgressCurtainStage =
  | 'connecting'
  | 'layout'
  | 'canvas'
  | 'ready';

export interface WorkbenchProgressCurtainProps {
  visible: boolean;
  stage: WorkbenchProgressCurtainStage;
  message?: string;
}

const CURTAIN_STATUS_TEXT: Record<WorkbenchProgressCurtainStage, string> = {
  connecting: 'Connecting workspace',
  layout: 'Loading layout',
  canvas: 'Preparing canvas',
  ready: 'Ready',
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function WorkbenchProgressCurtain(props: WorkbenchProgressCurtainProps) {
  const statusText = createMemo(
    () => compact(props.message) || CURTAIN_STATUS_TEXT[props.stage],
  );

  return (
    <RedevenLoadingCurtain
      visible={props.visible}
      surface="page"
      eyebrow="Workbench"
      message={statusText()}
      class="redeven-workbench-progress-curtain"
      dataStage={props.stage}
    />
  );
}
