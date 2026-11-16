import { describe, expect, test } from "vite-plus/test";

import { initialMotion } from "../src/model/motion.ts";
import { carPositions } from "../src/model/queries.ts";
import { SPEED, initialSimState, step } from "../src/model/simulation.ts";
import { CAR_GAP, COLLISION, closestApproach, isValidPath } from "../src/model/train.ts";
import type { TrainId } from "../src/model/types.ts";
import { sampleLayout, scenicPresets } from "../src/presets.ts";

const STEP = 1 / 60;

/** Each built-in yard runs for a simulated minute; these check how its trains behave, not where they end up. */
describe("built-in yards", () => {
  for (const yard of [sampleLayout(), ...scenicPresets()]) {
    test(yard.name, () => {
      let motion = initialMotion(yard);
      let sim = initialSimState();
      let stations = 0;
      let closest = Infinity;
      const travelled = new Map<TrainId, number>();
      for (let frame = 0; frame < 60 * 60; frame += 1) {
        const before = carPositions(yard, motion);
        const next = step(yard, motion, sim, STEP, 1);
        ({ motion, sim } = next);
        stations += next.events.stationArrivals;
        const after = carPositions(yard, motion);

        for (const train of yard.trains) {
          const current = motion.get(train.id)!;
          // Every train stays on track, with every car on the rails, evenly spaced.
          expect(
            isValidPath(yard.board, current.history, current.progress, train.cars.length),
          ).toBe(true);
          const cars = after.get(train.id)!;
          expect(cars).toHaveLength(train.cars.length);
          for (let i = 1; i < cars.length; i += 1) {
            const gap = Math.hypot(cars[i].x - cars[i - 1].x, cars[i].y - cars[i - 1].y);
            expect(gap).toBeLessThanOrEqual(CAR_GAP + 1e-9);
            expect(gap).toBeGreaterThan(CAR_GAP * 0.85);
          }
          // Nothing moves faster than full speed.
          const [engine] = cars;
          const [was] = before.get(train.id)!;
          const moved = Math.hypot(engine.x - was.x, engine.y - was.y);
          expect(moved).toBeLessThanOrEqual(SPEED * STEP + 1e-9);
          travelled.set(train.id, (travelled.get(train.id) ?? 0) + moved);
        }
        const trains = [...after.values()];
        for (const [i, cars] of trains.entries()) {
          for (const other of trains.slice(i + 1))
            closest = Math.min(closest, closestApproach(cars, other));
        }
      }
      // No train ever runs into another, and none gets stuck.
      expect(closest).toBeGreaterThanOrEqual(COLLISION);
      for (const distance of travelled.values()) expect(distance).toBeGreaterThan(40);
      // Trains stop at a station on their loop, and only there.
      const hasStation = yard.board.grid.some((tile) => tile?.type === "station");
      expect(stations > 0).toBe(hasStation);
    });
  }
});
