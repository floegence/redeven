import "../index.css";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { I18nProvider } from "./i18n";
import { writeStoredLanguagePreference } from "./i18n/storage";
import { ResourceAccessGate } from "./ResourceAccessGate";

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
function mount(local = false) {
  writeStoredLanguagePreference("en-US");
  const host = document.createElement("div");
  document.body.append(host);
  const navigate = vi.fn();
  dispose = render(
    () => (
      <I18nProvider>
        <ResourceAccessGate local={local} navigate={navigate} />
      </I18nProvider>
    ),
    host,
  );
  return { host, navigate };
}
function response(data: object) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

it("completes the isolated resource password and factor steps before navigating, and resumes only its stored grant", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({ second_factor_required: true, challenge_id: "challenge" }),
    )
    .mockResolvedValueOnce(
      response({
        unlocked: true,
        resume_token: "resource-only",
        resume_expires_at_unix_ms: Date.now() + 60000,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const { host, navigate } = mount();
  await expect.poll(() => host.querySelector("input")).toBeTruthy();
  await page
    .elementLocator(host.querySelector("input")!)
    .fill("environment password");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => host.querySelector("input")?.autocomplete)
    .toBe("one-time-code");
  expect(navigate).not.toHaveBeenCalled();
  await page.elementLocator(host.querySelector("input")!).fill("012 345");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => navigate.mock.calls.length).toBe(1);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    challenge_id: "challenge",
    code: "012 345",
  });
  expect(fetcher.mock.calls[1][1].credentials).toBe("omit");
  expect(
    JSON.parse(sessionStorage.getItem("redeven:resource-access:v1")!).token,
  ).toBe("resource-only");
  dispose();
  host.remove();
  fetcher.mockResolvedValueOnce(response({ unlocked: true }));
  const next = mount();
  await expect.poll(() => next.navigate.mock.calls.length).toBe(1);
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
    resume_token: "resource-only",
  });
});

it("uses the local challenge cookie without reading or storing remote grants", async () => {
  sessionStorage.setItem(
    "redeven:resource-access:v1",
    JSON.stringify({ token: "remote", expires_at: Date.now() + 60000 }),
  );
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({ second_factor_required: true, challenge_id: "local" }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: false,
          error: { code: "ACCESS_CHALLENGE_EXPIRED" },
        }),
        { status: 401 },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  const { host, navigate } = mount(true);
  await expect.poll(() => host.querySelector("input")).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
  await page
    .elementLocator(host.querySelector("input")!)
    .fill("environment password");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => host.querySelector("input")?.autocomplete)
    .toBe("one-time-code");
  await page.elementLocator(host.querySelector("input")!).fill("012345");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => host.querySelector("input")?.autocomplete)
    .toBe("current-password");
  expect(fetcher.mock.calls[0][0]).toBe("/api/local/access/unlock");
  expect(fetcher.mock.calls[0][1].credentials).toBe("same-origin");
  expect(navigate).not.toHaveBeenCalled();
  expect(host.querySelector("input")?.getAttribute("aria-invalid")).toBe("false");
});


it.each([
  { code: "ACCESS_PASSWORD_INVALID", factor: false, invalid: true },
  { code: "ACCESS_FACTOR_INVALID", factor: true, invalid: true },
  { code: "ACCESS_PASSWORD_RETRY_LATER", factor: false, invalid: false },
  { code: "", factor: false, invalid: false },
])("distinguishes resource input validation from service failure: $code", async ({ code, factor, invalid }) => {
  const fetcher = vi.fn();
  if (factor) fetcher.mockResolvedValueOnce(response({ second_factor_required: true, challenge_id: "challenge" }));
  if (code) {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false, error: { code, retry_after_ms: code === "ACCESS_PASSWORD_RETRY_LATER" ? 30_000 : 0 },
    }), { status: code === "ACCESS_PASSWORD_RETRY_LATER" ? 429 : 401 }));
  } else {
    fetcher.mockRejectedValueOnce(new Error("Connection interrupted"));
  }
  vi.stubGlobal("fetch", fetcher);
  const { host, navigate } = mount(true);
  await expect.poll(() => host.querySelector("input")).toBeTruthy();
  await page.elementLocator(host.querySelector("input")!).fill("environment password");
  await userEvent.keyboard("{Enter}");
  if (factor) {
    await expect.poll(() => host.querySelector("input")?.autocomplete).toBe("one-time-code");
    await page.elementLocator(host.querySelector("input")!).fill("012345");
    await userEvent.keyboard("{Enter}");
  }
  await expect.poll(() => host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  expect(host.querySelector("input")?.getAttribute("aria-invalid")).toBe(String(invalid));
  expect(navigate).not.toHaveBeenCalled();
});
