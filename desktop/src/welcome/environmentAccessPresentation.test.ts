import { describe, expect, it } from 'vitest';
import { linkedEnvironmentFixture } from '../testSupport/linkedEnvironmentFixture';
import { createDesktopI18n } from '../shared/i18n';
import { buildProviderBackedEnvironmentActionModel } from './viewModel';
import { environmentAccessPresentation } from './environmentAccessPresentation';

const i18n = createDesktopI18n('en-US');
describe('access routes in the existing Env split button', () => {
 it('preserves lifecycle actions and Cloud action ownership', () => {
  const { runtime, cloud } = linkedEnvironmentFixture();
  const routes = [{ id: 'direct', environment_id: runtime.id, kind: 'direct' as const, label: runtime.label, is_open: false },
    { id: 'proxy', environment_id: 'gateway', kind: 'gateway_proxy' as const, label: 'Office', gateway_label: 'Office', is_open: false }];
  const entry = { ...runtime, access_routes: routes, default_access_route_id: 'proxy' };
  const before = buildProviderBackedEnvironmentActionModel(runtime).action_presentation;
  const after = environmentAccessPresentation(entry, before, i18n);
  expect(after.primary_action.access_route_id).toBe('proxy');
  expect(after.menu_actions.slice(2)).toEqual(before.menu_actions);
  expect(after.menu_actions[0].action.access_route_id).toBe('direct');
  const cloudBefore = buildProviderBackedEnvironmentActionModel(cloud).action_presentation;
  expect(environmentAccessPresentation({ ...cloud, access_routes: routes }, cloudBefore, i18n)).toBe(cloudBefore);
 });
 it('blocks a removed default instead of silently opening another route', () => {
  const { runtime } = linkedEnvironmentFixture();
  const entry = { ...runtime, default_access_route_id: 'gone', access_routes: [{ id: 'direct', environment_id: runtime.id, kind: 'direct' as const, label: runtime.label, is_open: false }] };
  const result = environmentAccessPresentation(entry, buildProviderBackedEnvironmentActionModel(runtime).action_presentation, i18n);
  expect(result.primary_action.enabled).toBe(false);
 });
});
