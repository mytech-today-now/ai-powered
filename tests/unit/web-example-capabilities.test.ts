import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "integrations/web-example/app.js"), "utf8");
const start = source.indexOf("  function capabilityValues");
const end = source.indexOf("  function syncImageConstraints", start);
if (start < 0 || end < 0) throw new Error("Could not locate capability helpers in app.js");

const context: any = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

describe("web-example model capability validation", () => {
  const luma = {
    aspectRatios: ["16:9", "9:16"],
    resolutions: ["720p"],
    durationRange: { min: 1, max: 9 },
    fpsOptions: [24],
    qualityOptions: ["standard"],
  };

  it("accepts a supported capability combination", () => {
    expect(() =>
      context.validateCapabilityValues(luma, {
        aspectRatio: "16:9",
        resolution: "720p",
        duration: 9,
        fps: 24,
        quality: "standard",
      }),
    ).not.toThrow();
  });

  it("rejects stale or browser-manipulated quality and resolution values", () => {
    expect(() => context.validateCapabilityValues(luma, { quality: "high" })).toThrow(
      /quality is not supported/,
    );
    expect(() => context.validateCapabilityValues(luma, { resolution: "1080p" })).toThrow(
      /resolution is not supported/,
    );
  });

  it("enforces duration range boundaries", () => {
    expect(() => context.validateCapabilityValues(luma, { duration: 1 })).not.toThrow();
    expect(() => context.validateCapabilityValues(luma, { duration: 10 })).toThrow(
      /duration is not supported/,
    );
  });

  it("uses finite provider option values and leaves Pikaframes duration unsupported", () => {
    const pikaImageToVideo = {
      resolutions: ["720p", "1080p"],
      options: [{ name: "duration", values: [5, 10] }],
    };
    const pikaFrames = {
      resolutions: ["720p", "1080p"],
      options: [{ name: "transitionDuration", min: 1, max: 10 }],
    };

    expect(() =>
      context.validateCapabilityValues(pikaImageToVideo, { duration: 10 }),
    ).not.toThrow();
    expect(() => context.validateCapabilityValues(pikaImageToVideo, { duration: 6 })).toThrow(
      /duration is not supported/,
    );
    expect(context.durationCapabilityValues(pikaFrames)).toEqual([]);
    expect(() => context.validateCapabilityValues(pikaFrames, { duration: 5 })).toThrow(
      /duration is not supported/,
    );
  });
});
