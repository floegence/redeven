import { expect, it } from 'vitest';
import { computerManagementAdapter } from '../../../../internal/flower_ui/host/computerUseAdapter';
import { runtimeFlowerMethodAllowed, runtimeFlowerPath } from '../../main/runtimeFlowerRoutes';
import type { RuntimeFlowerRequestMethod } from '../../shared/runtimeFlowerIPC';

it('admits the shared browser installation controller through the Desktop bridge', async () => {
  const methods: RuntimeFlowerRequestMethod[] = [];
  const management = computerManagementAdapter(async <T,>(method: 'GET' | 'PUT' | 'POST', path: string) => {
    expect(runtimeFlowerPath(path)).toBe('/_redeven_proxy/api/browser/installation');
    expect(runtimeFlowerMethodAllowed(path, method)).toBe(true);
    methods.push(method);
    return { enabled: true, state: 'not_installed' } as T;
  });
  await management.loadBrowserInstallation!();
  await management.saveBrowserEnabled!(true);
  expect(methods).toEqual(['GET', 'PUT']);
});
