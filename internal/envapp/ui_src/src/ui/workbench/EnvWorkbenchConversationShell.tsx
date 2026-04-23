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
      class="relative flex h-full min-h-0 overflow-hidden bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_92%,var(--muted)_8%),color-mix(in_srgb,var(--background)_98%,transparent))]"
    >
      <aside class="flex h-full min-h-0 w-[19rem] shrink-0 flex-col border-r border-border/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--sidebar)_90%,transparent),color-mix(in_srgb,var(--sidebar)_96%,transparent))]">
        <div class="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">{props.railLabel}</div>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden">{props.rail}</div>
      </aside>

      <div class="relative min-h-0 min-w-0 flex-1">
        {props.workbench}
      </div>
    </div>
  );
}
