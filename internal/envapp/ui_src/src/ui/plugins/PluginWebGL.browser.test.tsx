import { expect, it } from 'vitest';
import { createPluginTestHarness } from '@floegence/redevplugin-ui/testing';
import { renderNativeWebGL } from '../../test/pluginWebGL.fixture';

// Business fixture only. Product acceptance covers real independent origins,
// platform authorization and WASM; this verifies native drawing and bridge JSON.
it('draws native WebGL and reports data through the production bridge client', async () => {
  const reports: unknown[] = [];
  const harness = createPluginTestHarness({ call(method, input) {
    expect(method).toBe('webgl.report');
    reports.push(input);
    return {};
  } });
  const bridge = new harness.BridgeClient();
  const stage = document.createElement('main');
  document.body.append(stage);
  try {
    await renderNativeWebGL(stage, bridge);
    expect(stage.querySelectorAll('canvas')).toHaveLength(2);
    expect(reports).toEqual([{ samples: { webgl: [255, 0, 0, 255], webgl2: [0, 255, 0, 255] } }]);
  } finally {
    bridge.dispose(); harness.dispose(); stage.remove();
  }
});
