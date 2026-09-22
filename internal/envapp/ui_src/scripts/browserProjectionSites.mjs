/* global document, window, location, innerHeight, game */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const sites = [
  ["Tencent News", "https://news.qq.com/"],
  ["Baidu News", "https://news.baidu.com/"],
  ["Google", "https://www.google.com/"],
  ["X", "https://x.com/"],
  ["YouTube", "https://www.youtube.com/"],
  ["Three.js", "https://threejs.org/"],
  ["TSL", "https://threejs.org/examples/webgpu_tsl_editor.html", true],
  ["Three.js Editor", "https://threejs.org/editor/", true],
  [
    "Phaser Canvas game",
    "https://labs.phaser.io/view.html?src=src/games/firstgame/part7.js&v=3.90.0",
    "game",
  ],
];

// Public-site qualification uses the actual browser chrome and authenticated
// product carrier. A separate native source probe records external failures;
// neither a challenge nor a native browser failure counts as a product pass.
export async function runBrowserProjectionSites({ popup, source, evidence }) {
  assert.ok(evidence);
  const report = {
    mode: "Local Fast Debugging; dependency overlays; not release acceptance",
    seed: 20260923,
    started: new Date().toISOString(),
    sites: [],
  };
  let random = report.seed;
  const until = async (predicate, argument, timeout = 20000) => {
    const handle = await popup.waitForFunction(predicate, argument, {
      timeout,
    });
    await handle.dispose();
  };
  const facts = (page) =>
    page.evaluate(() => ({
      url: location.href,
      title: document.title,
      text: document.body?.innerText.slice(0, 500) ?? "",
      height: document.documentElement.scrollHeight,
      canvas: document.querySelectorAll("canvas").length,
    }));
  const blocked = (value) =>
    /captcha|verify (?:that )?you are human|access denied|unusual traffic|人机验证|安全验证|访问异常|网络异常/iu.test(
      `${value.title}\n${value.text}`,
    );
  try {
    for (const [name, url, canvas] of sites) {
      const result = { name, requested: url };
      report.sites.push(result);
      const native = await source.context().newPage();
      result.nativeErrors = [];
      native.on("pageerror", (error) =>
        result.nativeErrors.push(error.message),
      );
      try {
        const response = await native.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await native.waitForLoadState("load", { timeout: 20000 });
        if (canvas)
          await native
            .locator("canvas")
            .first()
            .waitFor({ state: "visible", timeout: 10000 });
        if (canvas === "game")
          await native
            .waitForFunction(
              () =>
                typeof game !== "undefined" &&
                game.scene.scenes[0]?.player?.body,
              null,
              { timeout: 15000 },
            )
            .then((handle) => handle.dispose());
        result.native = {
          status: response?.status(),
          ...(await facts(native)),
        };
        await native.screenshot({
          path: evidence.replace(
            /\.json$/u,
            `-${report.sites.length}-native.png`,
          ),
        });
        if (
          (response?.status() ?? 200) >= 400 ||
          blocked(result.native) ||
          (canvas === "game" && result.nativeErrors.length)
        ) {
          result.result = "external_blocker";
          continue;
        }
      } catch (error) {
        result.result = "external_blocker";
        result.nativeError = error.message;
        continue;
      } finally {
        await native.close();
      }
      try {
        const address = popup.getByRole("combobox", {
          name: "Website address",
        });
        const navigation = source.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await address.fill(url);
        await address.press("Enter");
        const response = await navigation;
        await source.waitForLoadState("load", { timeout: 20000 });
        if (canvas)
          await source
            .locator("canvas")
            .first()
            .waitFor({ state: "visible", timeout: 10000 });
        if (canvas === "game")
          await source
            .waitForFunction(
              () =>
                typeof game !== "undefined" &&
                game.scene.scenes[0]?.player?.body,
              null,
              { timeout: 15000 },
            )
            .then((handle) => handle.dispose());
        result.source = {
          status: response?.status(),
          ...(await facts(source)),
        };
        if ((response?.status() ?? 200) >= 400 || blocked(result.source)) {
          result.result = "external_blocker";
          continue;
        }
        await until(
          (expected) => {
            const address = document.querySelector("[role=combobox]");
            const root = document.querySelector(
              ".floe-viewport iframe",
            )?.contentDocument;
            const stage =
              document.querySelector(".floe-viewport")?.parentElement;
            return (
              address?.value === expected.url &&
              !address.readOnly &&
              root?.title === expected.title &&
              root?.body?.childElementCount > 0 &&
              !stage?.classList.contains("switching") &&
              !stage?.classList.contains("loading") &&
              document
                .querySelector("[data-floe-ui=status]")
                ?.classList.contains("live")
            );
          },
          { url: source.url(), title: result.source.title },
        );
        result.projected = await popup
          .frameLocator(".floe-viewport iframe")
          .locator("body")
          .evaluate((body) => ({
            text: body.innerText.slice(0, 500),
            height: body.ownerDocument.documentElement.scrollHeight,
            elements: body.querySelectorAll("*").length,
          }));
        assert.ok(
          result.projected.elements > 0,
          "The source page has a rendered DOM projection",
        );
        if (canvas) {
          const image = popup
            .frameLocator(".floe-viewport iframe")
            .locator("[data-floebrowser-canvas]")
            .first();
          await image.waitFor({ state: "visible" });
          await image.evaluate((image) => image.decode());
          result.canvas = await image.evaluate((image) => ({
            width: image.naturalWidth,
            height: image.naturalHeight,
            unavailable: image.getAttribute("data-floebrowser-unsupported"),
          }));
          assert.ok(
            result.canvas.width > 0 && !result.canvas.unavailable,
            "The native Canvas has decoded projected pixels",
          );
          await source.evaluate(() => {
            window.fixtureSiteKeys = [];
            document.addEventListener("keydown", (event) =>
              window.fixtureSiteKeys.push(event.key),
            );
          });
          await image.click();
          await popup.keyboard.press("ArrowRight");
          const delivered = await source.waitForFunction(
            () => window.fixtureSiteKeys.includes("ArrowRight"),
            null,
            { timeout: 5000 },
          );
          await delivered.dispose();
          result.canvasInput = await source.evaluate(
            () => window.fixtureSiteKeys,
          );
          if (canvas === "game") {
            result.playerBefore = await source.evaluate(
              () => game.scene.scenes[0].player.x,
            );
            await popup.keyboard.down("ArrowRight");
            try {
              const moved = await source.waitForFunction(
                (before) => game.scene.scenes[0].player.x > before + 5,
                result.playerBefore,
                { timeout: 5000 },
              );
              await moved.dispose();
            } finally {
              await popup.keyboard.up("ArrowRight");
            }
            result.playerAfter = await source.evaluate(
              () => game.scene.scenes[0].player.x,
            );
          }
        }
        const viewport = await popup.locator(".floe-viewport").boundingBox();
        assert.ok(viewport);
        await popup.mouse.move(
          viewport.x + viewport.width * 0.75,
          viewport.y + viewport.height * 0.6,
        );
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        result.scrollDelta = 300 + (random % 300);
        await popup.mouse.wheel(0, result.scrollDelta);
        if (
          result.source.height >
          (await source.evaluate(() => innerHeight)) + result.scrollDelta
        ) {
          result.scrolled = await source
            .waitForFunction(
              () =>
                window.scrollY > 0 ||
                (document.scrollingElement?.scrollTop ?? 0) > 0 ||
                [...document.querySelectorAll('*')].some((node) => node.scrollTop > 0),
              null,
              { timeout: 5000 },
            )
            .then(async (handle) => {
              await handle.dispose();
              return true;
            })
            .catch(() => false);
          result.scrollPosition = await source.evaluate(() => ({
            window: window.scrollY,
            document: document.scrollingElement?.scrollTop ?? 0,
          }));
        }
        await popup.screenshot({
          path: evidence.replace(/\.json$/u, `-${report.sites.length}.png`),
        });
        result.result = "passed";
      } catch (error) {
        result.result = "product_failure";
        result.error = error.message;
      } finally {
        await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
      }
    }
    const productFailures = report.sites.filter(
      (site) => site.result === "product_failure",
    );
    report.external_blockers = report.sites
      .filter((site) => site.result === "external_blocker")
      .map((site) => ({
        name: site.name,
        error: site.nativeError,
        status: site.native?.status,
      }));
    report.result = productFailures.length
      ? "failed"
      : report.external_blockers.length
        ? "passed_with_external_blockers"
        : "passed";
    assert.equal(
      productFailures.length,
      0,
      "Real-site qualification found a product failure; inspect its report",
    );
  } finally {
    await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
  }
}
