/* global window, document, AudioNode, AudioDestinationNode, Worker, requestAnimationFrame, location */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

// Correlate white video flashes with decoded audible pulses after the actual
// Flowersec carrier. The analyser observes the existing output graph; it does
// not replace the decoder, schedule samples, or bypass the product worklet.
export async function runBrowserProjectionMediaSync({
  popup,
  source,
  evidence,
}) {
  const report = {
    mode: "Local Fast Debugging; dependency overlays; not release acceptance",
    started: new Date().toISOString(),
    measurement:
      "Displayed video luminance and decoded PCM at the audio device timeline; 2-second warmup, 12-second sample",
  };
  try {
    await popup.evaluate(() => {
      window.fixtureAudioOutputs = [];
      window.fixtureDecodedTransitions = { audio: [], video: [] };
      let workerGeneration = 0;
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          const generation = ++workerGeneration;
          let bright = false,
            audible = false;
          const canvas = document.createElement("canvas");
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          this.addEventListener("message", ({ data }) => {
            if (data.type === "video") {
              context.drawImage(data.frame, 0, 0, 1, 1);
              const next = context.getImageData(0, 0, 1, 1).data[0] > 180;
              if (next && !bright)
                window.fixtureDecodedTransitions.video.push({
                  timestamp: data.frame.timestamp,
                  at: performance.now(),
                  generation,
                });
              bright = next;
            } else if (data.type === "audio") {
              const next = data.channels[0].some(
                (value) => Math.abs(value) > 0.06,
              );
              if (next && !audible)
                window.fixtureDecodedTransitions.audio.push({
                  timestamp: data.timestamp,
                  at: performance.now(),
                  generation,
                });
              audible = next;
            }
          });
        }
      };
      const connect = AudioNode.prototype.connect;
      window.fixtureRestoreAudioProbe = () => {
        AudioNode.prototype.connect = connect;
        window.Worker = NativeWorker;
      };
      AudioNode.prototype.connect = function (...args) {
        const result = connect.apply(this, args);
        if (args[0] instanceof AudioDestinationNode) {
          const analyser = this.context.createAnalyser();
          analyser.fftSize = 256;
          connect.call(this, analyser);
          window.fixtureAudioOutputs.push({ analyser, context: this.context });
        }
        return result;
      };
    });
    await source.evaluate(async () => {
      const clip = document.querySelector("#clip");
      clip.srcObject = null;
      clip.src = new URL("/av-sync.webm", location.href).href;
      clip.loop = true;
      clip.muted = false;
      clip.volume = 1;
      await clip.play();
      window.fixtureStopSync = () => clip.pause();
    });
    // A trusted product gesture unlocks client audio without starting media at
    // the source. The source has already chosen to play the fixture stream.
    await popup.getByRole("combobox", { name: "Website address" }).click();
    const ready = await popup.waitForFunction(
      () =>
        window.fixtureAudioOutputs.some(
          (output) => output.context.state === "running",
        ),
      null,
      { timeout: 10000 },
    );
    await ready.dispose();
    report.samples = await popup.evaluate(async () => {
      const outputs = window.fixtureAudioOutputs,
        audio = [],
        video = [];
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const samples = new Float32Array(256),
        start = performance.now();
      let wasAudio = false,
        wasVideo = false;
      await new Promise((resolve) => {
        const sample = () => {
          const now = performance.now(),
            elapsed = now - start;
          const clip = document
            .querySelector(".floe-viewport iframe")
            ?.contentDocument?.querySelector("#clip");
          let bright = false;
          if (clip?.readyState >= 2) {
            context.drawImage(clip, 0, 0, 1, 1);
            bright = context.getImageData(0, 0, 1, 1).data[0] > 180;
          }
          if (bright && !wasVideo && elapsed >= 2000) video.push(now);
          wasVideo = bright;
          let audible = false,
            outputAt = now;
          for (const output of outputs) {
            output.analyser.getFloatTimeDomainData(samples);
            const first = samples.findIndex((value) => Math.abs(value) > 0.06);
            if (first < 0) continue;
            audible = true;
            const clock = output.context.getOutputTimestamp();
            outputAt =
              clock.performanceTime +
              (output.context.currentTime -
                (samples.length - first) / output.context.sampleRate -
                clock.contextTime) *
                1000;
            break;
          }
          if (audible && !wasAudio && elapsed >= 2000) audio.push(outputAt);
          wasAudio = audible;
          if (elapsed >= 14000) resolve();
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      return {
        audio,
        video,
        decoded: window.fixtureDecodedTransitions,
        outputClocks: outputs.map(({ context }) => ({
          baseLatency: context.baseLatency,
          outputLatency: context.outputLatency,
          currentTime: context.currentTime,
          output: context.getOutputTimestamp(),
          now: performance.now(),
        })),
      };
    });
    assert.ok(
      report.samples.audio.length >= 8,
      "At least eight audible pulses must reach the real output graph",
    );
    assert.ok(
      report.samples.video.length >= 8,
      "At least eight decoded flashes must appear in the replay video",
    );
    // The worker preserves source timestamps for decoding, but Chromium's
    // audio decoder may apply a codec pre-skip that is not reflected in the
    // video timestamp. Compare transitions on the actual decoded wall clock;
    // retain timestamp skew as diagnostic evidence.
    const decodedAudio = report.samples.decoded.audio,
      decodedVideo = report.samples.decoded.video;
    report.decoded_timestamp_skew_ms = decodedVideo.flatMap((video) => {
      const sameWorker = decodedAudio.filter(
        (audio) => audio.generation === video.generation,
      );
      if (!sameWorker.length) return [];
      const nearest = sameWorker.reduce((best, audio) =>
        Math.abs(audio.timestamp - video.timestamp) <
        Math.abs(best.timestamp - video.timestamp)
          ? audio
          : best,
      );
      return [(video.timestamp - nearest.timestamp) / 1000];
    });
    report.maximum_absolute_decoded_timestamp_skew_ms = Math.max(
      ...report.decoded_timestamp_skew_ms.map(Math.abs),
    );
    report.decoded_skew_ms = decodedVideo.flatMap((video) => {
      const sameWorker = decodedAudio.filter(
        (audio) => audio.generation === video.generation,
      );
      if (!sameWorker.length) return [];
      const nearest = sameWorker.reduce((best, audio) =>
        Math.abs(audio.at - video.at) < Math.abs(best.at - video.at)
          ? audio
          : best,
      );
      return [video.at - nearest.at];
    });
    report.maximum_absolute_decoded_skew_ms = Math.max(
      ...report.decoded_skew_ms.map(Math.abs),
    );
    report.skew_ms = report.samples.video.map(
      (at) =>
        at -
        report.samples.audio.reduce((best, value) =>
          Math.abs(value - at) < Math.abs(best - at) ? value : best,
        ),
    );
    report.maximum_absolute_skew_ms = Math.max(...report.skew_ms.map(Math.abs));
    assert.ok(
      report.maximum_absolute_decoded_skew_ms <= 100,
      `Decoded audio/video wall skew ${report.maximum_absolute_decoded_skew_ms.toFixed(1)} ms exceeds 100 ms`,
    );
    report.result = "passed";
  } catch (error) {
    report.result = "failed";
    report.error = error.message;
    throw error;
  } finally {
    await source.evaluate(() => window.fixtureStopSync?.()).catch(() => {});
    await popup
      .evaluate(() => window.fixtureRestoreAudioProbe?.())
      .catch(() => {});
    await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
  }
}
