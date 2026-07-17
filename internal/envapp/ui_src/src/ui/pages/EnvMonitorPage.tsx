import { RuntimeMonitorPanel } from '../widgets/RuntimeMonitorPanel';

export function EnvMonitorPage() {
  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <RuntimeMonitorPanel variant="page" />
    </div>
  );
}
