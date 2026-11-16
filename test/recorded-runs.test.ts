import { describe, expect, test } from "vite-plus/test";
import { initialMotion } from "../src/model/motion.ts";
import { carPositions } from "../src/model/queries.ts";
import { initialSimState, step } from "../src/model/simulation.ts";
import type { Yard } from "../src/model/types.ts";
import { sampleLayout, scenicPresets } from "../src/presets.ts";

const STEP = 1 / 60;
const SECONDS = 30;

const round = (value: number) => Math.round(value * 1e4) / 1e4;

/** Runs the yard with a fixed time step and records car positions once per simulated second. */
function record(yard: Yard) {
  const frames: string[] = [];
  let stations = 0;
  let motion = initialMotion(yard);
  let sim = initialSimState();
  for (let frame = 1; frame <= SECONDS * 60; frame += 1) {
    const next = step(yard, motion, sim, STEP, 1);
    ({ motion, sim } = next);
    stations += next.events.stationArrivals;
    if (frame % 60) continue;
    const cars = [...carPositions(yard, motion).values()].map((train) =>
      train
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
