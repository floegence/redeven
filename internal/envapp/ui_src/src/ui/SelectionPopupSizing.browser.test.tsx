import desktopCSS from "../../../../../desktop/src/welcome/index.css?inline";
import envCSS from "../index.css?inline";
import flowerCSS from "./flower-feature.css?inline";
import { FloeProvider } from "@floegence/floe-webapp-core";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { FlowerProviderDialog } from "../../../../flower_ui/src/settings/FlowerProviderDialog";
import { modelCatalogCopy } from "../../../../flower_ui/src/settings/modelCatalogCopy";
import { DEFAULT_FLOWER_SURFACE_COPY } from "../../../../flower_ui/src/copy";
import { SpreadsheetPreview } from "../../../../flower_ui/src/preview/SpreadsheetPreview";
import { taskFilesEnUS } from "../../../../flower_ui/src/taskFilesCopy";

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
let style: HTMLStyleElement;
afterEach(() => {
  dispose?.();
  host?.remove();
  style?.remove();
});

function createHost(surface: "env" | "desktop", dark: boolean) {
  style = document.createElement("style");
  style.textContent = surface === "desktop" ? desktopCSS : envCSS + flowerCSS;
  document.head.append(style);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  document.documentElement.dataset.floeShellTheme = dark
    ? "porcelain-dark"
    : "porcelain-light";
  host = document.createElement("div");
  host.className = "flower-surface";
  document.body.append(host);
}

async function expectReadableOptions(
  control: HTMLElement,
  labels: readonly string[],
) {
  await userEvent.click(control);
  const menu = document.querySelector<HTMLElement>(".floe-floating-menu")!;
  await expect.poll(() => menu.dataset.floatingPresence).toBe("open");
  await document.fonts.ready;
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const bounds = menu.getBoundingClientRect();
  expect(
    bounds.width,
    "popup grows beyond the compact trigger",
  ).toBeGreaterThan(control.getBoundingClientRect().width + 4);
  expect(bounds.left).toBeGreaterThanOrEqual(8);
  expect(bounds.right).toBeLessThanOrEqual(window.innerWidth - 8);
  const list = menu.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(
    list.scrollWidth,
    "options need no horizontal scrollbar",
  ).toBeLessThanOrEqual(list.clientWidth);
  for (const label of labels) {
    const option = [
      ...list.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((item) => item.textContent === label)!;
    expect(option, label).toBeTruthy();
    const walker = document.createTreeWalker(option, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && text.textContent !== label) text = walker.nextNode();
    expect(text, label).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(text!);
    expect(range.getClientRects().length, `${label} fits on one line`).toBe(1);
    expect(
      range.getBoundingClientRect().right,
      `${label} is fully visible`,
    ).toBeLessThanOrEqual(bounds.right - 4);
  }
  return menu;
}

for (const surface of ["env", "desktop"] as const)
  for (const width of [390, 1440])
    for (const dark of [false, true]) {
      for (const locale of ["en-US", "zh-CN"])
        it(`sizes the DeepSeek fetch popup to its labels in ${surface} at ${width}px (${locale}, dark=${dark})`, async () => {
          await page.viewport(width, 900);
          createHost(surface, dark);
          const copy = {
            ...DEFAULT_FLOWER_SURFACE_COPY.settings.dialog,
            catalog: modelCatalogCopy(locale),
          };
          dispose = render(
            () => (
              <FloeProvider>
                <FlowerProviderDialog
                  open
                  mode="edit"
                  provider={{
                    id: "deepseek-fixture",
                    type: "deepseek",
                    base_url: "https://api.deepseek.com",
                    models: [{ model_name: "deepseek-chat" }],
                  }}
                  copy={copy}
                  keyConfigured
                  webSearchKeyConfigured={false}
                  onOpenChange={vi.fn()}
                  onConfirm={vi.fn()}
                />
              </FloeProvider>
            ),
            host,
          );
          await expect
            .poll(() =>
              document
                .querySelector('[role="dialog"]')
                ?.getAttribute("data-floating-presence"),
            )
            .toBe("open");
          const control = document.querySelector<HTMLElement>(
            '[data-flower-provider-fetch] [role="combobox"]',
          )!;
          const menu = await expectReadableOptions(control, [
            copy.catalog.fetchDirect,
            copy.catalog.fetchDeepSeek,
          ]);
          await userEvent.click(
            page.getByRole("option", {
              name: copy.catalog.fetchDeepSeek,
              exact: true,
            }),
          );
          await expect.poll(() => menu.isConnected).toBe(false);
          expect(control.textContent).toBe(copy.catalog.fetchDeepSeek);
          expect(document.querySelector('[role="dialog"]')).not.toBeNull();
          expect(document.activeElement).toBe(control);
          await userEvent.click(control);
          await userEvent.keyboard("{Escape}");
          await expect
            .poll(() => document.querySelector('[role="listbox"]'))
            .toBeNull();
          expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        });

      it(`sizes spreadsheet encoding options without wrapping in ${surface} at ${width}px (dark=${dark})`, async () => {
        await page.viewport(width, 900);
        createHost(surface, dark);
        dispose = render(
          () => (
            <FloeProvider>
              <div style={{ padding: "24px", height: "450px" }}>
                <SpreadsheetPreview
                  bytes={new TextEncoder().encode("name,value\nFixture,1")}
                  format="csv"
                  copy={taskFilesEnUS}
                />
              </div>
            </FloeProvider>
          ),
          host,
        );
        const control = host.querySelector<HTMLElement>('[role="combobox"]')!;
        const menu = await expectReadableOptions(control, [
          "UTF-8",
          "GB18030",
          "UTF-16 LE",
          "UTF-16 BE",
          "Windows-1252",
        ]);
        await userEvent.click(
          page.getByRole("option", { name: "Windows-1252", exact: true }),
        );
        await expect.poll(() => menu.isConnected).toBe(false);
        expect(control.textContent).toBe("Windows-1252");
        expect(document.activeElement).toBe(control);
      });
    }
