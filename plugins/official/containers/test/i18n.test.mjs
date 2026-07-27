import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build, stop } from "esbuild";

after(() => stop());

const bundle = await build({
  entryPoints: [new URL("../src/i18n.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node22"],
  write: false,
});
const source = Buffer.from(bundle.outputFiles[0].contents).toString("utf8");
const i18n = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test("ships complete independent dictionaries with matching placeholders", () => {
  const locales = i18n.SUPPORTED_CONTAINERS_LOCALES;
  assert.deepEqual(locales, [
    "en-US",
    "zh-CN",
    "zh-TW",
    "ja-JP",
    "ko-KR",
    "de-DE",
    "fr-FR",
    "es-ES",
    "pt-BR",
    "ru-RU",
  ]);
  const canonical = i18n.CONTAINERS_COPY["en-US"];
  const keys = Object.keys(canonical).sort();

  for (const locale of locales) {
    const dictionary = i18n.CONTAINERS_COPY[locale];
    if (locale !== "en-US")
      assert.notEqual(
        dictionary,
        canonical,
        `${locale} must be an independent dictionary object`,
      );
    assert.deepEqual(
      Object.keys(dictionary).sort(),
      keys,
      `${locale} dictionary shape`,
    );
    for (const key of keys) {
      assert.equal(
        typeof dictionary[key],
        "string",
        `${locale}.${key} must be a string`,
      );
      assert.notEqual(
        dictionary[key],
        "",
        `${locale}.${key} must not be empty`,
      );
      assert.deepEqual(
        placeholders(dictionary[key]),
        placeholders(canonical[key]),
        `${locale}.${key} placeholders`,
      );
    }
  }
});

test("resolves exact, language-only, Chinese-script, and fallback locales", () => {
  assert.equal(i18n.resolveContainersLocale("pt-BR"), "pt-BR");
  assert.equal(i18n.resolveContainersLocale("pt"), "pt-BR");
  assert.equal(i18n.resolveContainersLocale("zh-Hant-HK"), "zh-TW");
  assert.equal(i18n.resolveContainersLocale("zh-Hans"), "zh-CN");
  assert.equal(i18n.resolveContainersLocale("ar-SA"), "en-US");
  assert.equal(i18n.resolveContainersLocale(undefined), "en-US");
});

test("interpolates every locale and keeps the longest copy bounded", () => {
  let longest = { locale: "", key: "", value: "" };
  for (const locale of i18n.SUPPORTED_CONTAINERS_LOCALES) {
    for (const key of Object.keys(i18n.CONTAINERS_COPY[locale])) {
      const value = i18n.containersCopy(locale, key, {
        engine: "Docker",
        count: 123,
        resource: "Containers",
        action: "Start",
        target: "example",
        image: "example",
        level: "Medium",
        operation: "Create",
        status: "completed",
        name: "example",
        size: "1 GB",
        detail: "Details",
        removed: 2,
        remaining: 1,
      });
      assert.doesNotMatch(
        value,
        /\{[a-z_]+\}/iu,
        `${locale}.${key} has an unresolved placeholder`,
      );
      if (value.length > longest.value.length) longest = { locale, key, value };
    }
  }
  assert.ok(
    longest.value.length <= 180,
    `${longest.locale}.${longest.key} is unexpectedly long: ${longest.value}`,
  );
});

test("provides localized search vocabulary for every view and locale", () => {
  for (const locale of i18n.SUPPORTED_CONTAINERS_LOCALES) {
    for (const view of ["containers", "images", "volumes"]) {
      const terms = i18n.localizedSearchTerms(locale, view);
      assert.ok(terms.length > 0, `${locale}.${view} search terms`);
      assert.equal(
        new Set(terms).size,
        terms.length,
        `${locale}.${view} duplicate search terms`,
      );
    }
  }
  assert.ok(i18n.localizedSearchTerms("zh-CN", "containers").includes("容器"));
  assert.ok(i18n.localizedSearchTerms("ja-JP", "images").includes("イメージ"));
  assert.ok(i18n.localizedSearchTerms("ru-RU", "volumes").includes("тома"));
});

function placeholders(value) {
  return [...value.matchAll(/\{([a-z_]+)\}/giu)]
    .map((match) => match[1])
    .sort();
}
