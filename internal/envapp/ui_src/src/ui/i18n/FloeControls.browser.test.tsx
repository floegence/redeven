import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { Form, FormField, FormLabel, FormMessage, Input, Select, Pagination, Button } from '@floegence/floe-webapp-core/ui';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { I18nProvider, useI18n, type EnvAppI18nContext } from './I18nProvider';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  localStorage.clear();
});

it('retains mounted fields while localized published controls follow product language', async () => {
  localStorage.clear();
  await page.viewport(390, 844);
  let i18n: EnvAppI18nContext | undefined;
  let submitted: FormData | undefined;
  const Fixture = () => {
    i18n = useI18n();
    const [value, setValue] = createSignal('');
    return <main>
      <Form validate={data => String(data.get('name')).length < 3 ? { name: 'Invalid project' } : undefined}
        onSubmit={(_event, context) => { submitted = context.data; }}>
        <FormField name="name"><FormLabel>Project name</FormLabel><Input /><FormMessage /></FormField>
        <FormField name="format"><FormLabel>Format</FormLabel><Select value={value()} onChange={setValue}
          options={[{ value: '', label: 'Default JSON' }, { value: 'json', label: 'json' }, { value: 'text', label: 'text' }]} /></FormField>
        <Button type="submit">Save fixture</Button>
      </Form>
      <Pagination page={1} totalPages={3} onChange={() => undefined} />
    </main>;
  };
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <I18nProvider><Fixture /></I18nProvider>, host);
  await expect.poll(() => Boolean(i18n)).toBe(true);
  await i18n!.setLocalePreference('en-US');
  const input = page.getByRole('textbox', { name: 'Project name', exact: true });
  await userEvent.fill(input, 'ab');
  await userEvent.click(page.getByRole('button', { name: 'Save fixture' }));
  await expect.poll(() => document.activeElement?.getAttribute('name')).toBe('name');
  const original = host.querySelector('input[name="name"]');
  const select = page.getByRole('combobox', { name: 'Format', exact: true });
  await expect.element(select).toHaveTextContent('Default JSON');
  await userEvent.click(select);
  await userEvent.keyboard('{End}{Enter}');
  await expect.element(select).toHaveTextContent('text');
  await userEvent.fill(input, 'Retained project');
  await i18n!.setLocalePreference('zh-TW');
  await expect.element(page.getByRole('button', {name:'下一頁',exact:true})).toBeVisible();
  expect(host.querySelector('input[name="name"]')).toBe(original);
  await expect.element(input).toHaveValue('Retained project');
  await userEvent.click(page.getByRole('button', { name: 'Save fixture' }));
  await expect.poll(() => submitted?.get('format')).toBe('text');
  await i18n!.setLocalePreference('ja-JP');
  await expect.element(page.getByRole('button', {name:'次のページ',exact:true})).toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});
