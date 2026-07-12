import type { ParentProps } from 'solid-js';

import './codex-feature.css';
import { CodexProvider } from './CodexProvider';

export function CodexFeatureProvider(props: ParentProps) {
  return <CodexProvider>{props.children}</CodexProvider>;
}
