import { render } from 'solid-js/web';
import { App } from './ui/App';

import './index.css';

const root = document.getElementById('root')!;
// Replace the static first-visit surface in the same task as the live Shell mount.
root.replaceChildren();
render(() => <App />, root);
