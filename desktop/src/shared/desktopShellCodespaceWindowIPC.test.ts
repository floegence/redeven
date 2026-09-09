import { expect, it } from 'vitest';
import { normalizeDesktopShellOpenCodespaceWindowRequest as normalize } from './desktopShellCodespaceWindowIPC';
it.each(['open', 'browser'])('accepts only a bounded %s resource intent and keeps passwords ephemeral', (mode) => {
  expect(normalize({ mode, code_space_id: 'space-one' })).toEqual({
    mode,
    code_space_id: 'space-one',
  });
  expect(
    normalize({
      mode,
      code_space_id: 'space-one',
      password: ' secret ',
    }),
  ).toEqual({ mode, code_space_id: 'space-one', password: ' secret ' });
  for (const extra of [
    { url: 'https://example.com' },
    { host: 'localhost' },
    { port: 80 },
    { route: 'remote' },
  ])
    expect(
      normalize({ mode, code_space_id: 'space-one', ...extra }),
    ).toBeNull();
  for (const id of [
    '',
    '../space',
    'space/one',
    '-space',
    'space-',
    'UPPER',
    'x'.repeat(49),
  ])
    expect(normalize({ mode, code_space_id: id })).toBeNull();
  expect(
    normalize({ code_space_id: 'one', url: 'https://example.com' }),
  ).toBeNull();
  expect(
    normalize({
      mode: 'navigate',
      code_space_id: 'one',
      url: 'https://example.com',
    }),
  ).toBeNull();
});
