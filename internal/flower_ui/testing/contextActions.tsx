import { FloeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { FlowerSurface } from '../src/FlowerSurface';
import { createFlowerComposerDraftCoordinator } from '../src/composer/createFlowerComposerDraftCoordinator';
import { streamingFixture } from './streamingFixture';
import '../../../desktop/src/welcome/index.css';

const fixture = streamingFixture(4, 0);
document.getElementById('root')!.style.height = '100vh';
render(() => <FloeProvider><FlowerSurface adapter={fixture.adapter} draftCoordinator={createFlowerComposerDraftCoordinator()} /></FloeProvider>, document.getElementById('root')!);
