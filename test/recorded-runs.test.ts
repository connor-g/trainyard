import { describe, expect, test } from "vite-plus/test";
import { advance, carPositions, sampleLayout } from "../src/railway.ts";
import type { Layout } from "../src/railway.ts";
import { scenicPresets } from "../src/presets.ts";

const STEP = 1 / 60;
const SECONDS = 30;

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** Runs the yard with a fixed time step and records car positions once per simulated second. */
function record(yard: Layout) {
  const frames: string[] = [];
  let stations = 0;
  for (let frame = 1; frame <= SECONDS * 60; frame += 1) {
    advance(yard.grid, yard.trains, STEP * 1.6, yard.cols, STEP, () => (stations += 1));
    if (frame % 60) continue;
    const cars = yard.trains.map((train) =>
      carPositions(train, yard.cols)
        .map((car) => [car.type, round(car.x), round(car.y), round(car.angle)].join(" "))
        .join(" | "),
    );
    frames.push(frame / 60 + "s: " + cars.join(" || "));
  }
  return { frames, stations };
}

describe("recorded runs", () => {
  for (const yard of [sampleLayout(), ...scenicPresets()]) {
    test(yard.name, () => {
      expect(record(yard)).toMatchSnapshot();
    });
  }
});
