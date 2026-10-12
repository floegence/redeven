import type { FlowerPageContextRegistrar } from '../flower/flowerPageContext';
import { RemoteFileBrowser } from '../widgets/RemoteFileBrowser';

export function EnvFileBrowserPage(props: { registerPageContext?: FlowerPageContextRegistrar } = {}) {
  return (
    <div class="h-full min-h-0 overflow-hidden relative">
      <RemoteFileBrowser registerPageContext={props.registerPageContext} />
    </div>
  );
}
