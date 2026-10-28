import { createSignal } from 'solid-js';
import { PersistentFloatingWindow } from '../../../envapp/ui_src/src/ui/widgets/PersistentFloatingWindow';

// Test-only contents, production floating-window implementation and geometry.
export function LongThreadWindows() {
  const [preview, setPreview] = createSignal(false);
  const [output, setOutput] = createSignal(false);
  return <>
    <div style={{ position: 'fixed', top: '8px', right: '8px', 'z-index': 2147483000, display: 'flex', gap: '8px' }}>
      <button id="open-preview" onClick={() => setPreview(true)}>Open preview</button>
      <button id="open-output" onClick={() => setOutput(true)}>Open output</button>
    </div>
    <PersistentFloatingWindow open={output()} onOpenChange={setOutput} title="Synthetic build output" persistenceKey="qualification-output" defaultPosition={{ x: 710, y: 410 }} defaultSize={{ width: 440, height: 300 }}>
      <pre>{Array.from({ length: 180 }, (_, i) => '[line ' + i + '] Completed source inspection.\n').join('')}</pre>
    </PersistentFloatingWindow>
    <PersistentFloatingWindow open={preview()} onOpenChange={setPreview} title="Long-thread preview" persistenceKey="qualification-preview" defaultPosition={{ x: 380, y: 180 }} defaultSize={{ width: 480, height: 370 }}>
      <div style={{ padding: '16px' }}><h2>Synthetic project preview</h2><textarea aria-label="Preview draft" />
        <table><tbody>{Array.from({ length: 100 }, (_, i) => <tr><td>Module {i}</td><td>Inspection complete</td><td>{i * 17} lines</td></tr>)}</tbody></table>
      </div>
    </PersistentFloatingWindow>
  </>;
}
