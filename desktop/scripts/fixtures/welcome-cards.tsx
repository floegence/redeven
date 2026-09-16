import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@floegence/floe-webapp-core/ui';
import '../../src/welcome/index.css';

// Exercise the published Card and the exact product surface classes. Runtime
// inventory and card actions are covered separately by the Welcome integration.
render(() => <FloeProvider><main style={{ padding: '32px', display: 'grid', gap: '20px', 'grid-template-columns': 'repeat(3, 1fr)' }}>
  <For each={['idle', 'open', 'new']}>
    {(state) => <Card
      data-card-state={state}
      class={`redeven-environment-card h-full overflow-hidden ${state === 'open' ? 'redeven-environment-card--open' : state === 'new' ? 'redeven-new-environment-card border-dashed' : ''}`}
    >
      <CardHeader><CardTitle>{state === 'new' ? 'New Environment' : 'Workspace environment'}</CardTitle></CardHeader>
      <CardContent><p>Runtime and connection details</p></CardContent>
      <CardFooter><span>{state === 'open' ? 'Open' : 'Ready'}</span></CardFooter>
    </Card>}
  </For>
</main></FloeProvider>, document.getElementById('root')!);
