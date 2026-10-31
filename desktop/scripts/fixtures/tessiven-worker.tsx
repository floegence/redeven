import { render } from 'solid-js/web';
import { TessivenGraph } from '../../../internal/tessiven_ui/src/TessivenGraph';
import { tessivenText } from '../../../internal/tessiven_ui/src/i18n';
import { toRenderVersion } from '../../../internal/tessiven_ui/src/presentation';
import { sharedHostsVersion } from '../../../internal/envapp/ui_src/src/styles/tessiven-shared-hosts.fixture';
import '../../src/welcome/index.css';
import '../../../internal/tessiven_ui/src/tessiven.css';

render(() => <div class="tessiven" style="height:100vh">
  <TessivenGraph version={toRenderVersion(sharedHostsVersion('mixed'))}
    historical={false} t={tessivenText('en-US')} onAsk={() => {}} onInspect={() => {}} />
</div>, document.getElementById('root')!);
