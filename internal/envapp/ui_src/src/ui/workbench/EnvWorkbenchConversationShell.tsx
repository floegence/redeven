import type { JSX } from 'solid-js';
import { REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_PROPS } from './surface/workbenchWheelInteractive';

export function EnvWorkbenchConversationShell(props: {
  railLabel: string;
  rail: JSX.Element;
  workbench: JSX.Element;
}) {
  return (
    <div
      {...REDEVEN_WORKBENCH_WHEEL_INTERACTIVE_PROPS}
      class="redeven-workbench-conversation-shell relative flex h-full min-h-0 overflow-hidden"
    >
      <aside class="redeven-workbench-conversation-shell__rail flex h-full min-h-0 w-[19rem] shrink-0 flex-col">
        <div class="redeven-workbench-conversation-shell__rail-header flex items-center justify-between px-3 py-2">
          <div class="redeven-workbench-conversation-shell__rail-title text-[11px] font-semibold uppercase tracking-[0.18em]">{props.railLabel}</div>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden">{props.rail}</div>
      </aside>

      <div class="redeven-workbench-body-surface relative min-h-0 min-w-0 flex-1">
        {props.workbench}
      </div>
    </div>
  );
}
