import type { FlowerPageContextRegistrar } from '../flower/flowerPageContext';
import { RuntimeMonitorPanel } from '../widgets/RuntimeMonitorPanel';

export function EnvMonitorPage(props: { registerPageContext?: FlowerPageContextRegistrar } = {}) {
  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <RuntimeMonitorPanel registerPageContext={props.registerPageContext} variant="page" />
    </div>
  );
}
