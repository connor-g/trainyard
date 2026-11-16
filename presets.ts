import { blankLayout, couple, indexAt, startTrain, trackPaths } from "./src/railway.ts";
import type { ColorName, Layout, Point, StockType, TrackType } from "./src/railway.ts";

type Feature = [x: number, y: number, type: TrackType];
type CarSpec = [type: StockType, color: ColorName];
type TrainSpec = [x: number, y: number, cars: CarSpec[], reverse?: boolean];

function stepPort(x: number, y: number, otherX: number, otherY: number) {
  if (x === otherX) return otherY < y ? 0 : 2;
  return otherX > x ? 1 : 3;
}

function layLoop(yard: Layout, corners: Point[]) {
  const cells: Point[] = [];
  corners.forEach(([x, y], i) => {
    const [nextX, nextY] = corners[(i + 1) % corners.length];
    const dx = Math.sign(nextX - x);
    const dy = Math.sign(nextY - y);
    for (let offset = 0; offset < Math.abs(nextX - x) + Math.abs(nextY - y); offset += 1) {
      cells.push([x + offset * dx, y + offset * dy]);
    }
  });
  cells.forEach(([x, y], i) => {
    const index = indexAt(x, y, yard.cols);
    const from = stepPort(x, y, ...cells.at(i - 1)!);
    const to = stepPort(x, y, ...cells[(i + 1) % cells.length]);
    const straight = Math.abs(from - to) === 2;
    const previous = yard.grid[index];
    if (previous) {
      if (!straight || previous.type !== "straight" || previous.turn === 1 - (from % 2)) {
        throw new Error("Invalid crossing in " + yard.name);
      }
      yard.grid[index] = { type: "cross", turn: 0, branch: false };
    } else if (straight) {
      yard.grid[index] = { type: "straight", turn: 1 - (from % 2), branch: false };
    } else {
      const turn = [0, 1, 2, 3].find((turn) => {
        const [ports] = trackPaths({ type: "curve", turn });
        return ports.includes(from) && ports.includes(to);
      })!;
      yard.grid[index] = { type: "curve", turn, branch: false };
    }
  });
}

function buildYard(
  name: string,
  background: string,
  corners: Point[],
  features: Feature[],
  trains: TrainSpec[],
): Layout {
  const yard: Layout = { ...blankLayout(), name, background };
  layLoop(yard, corners);
  for (const [x, y, type] of features) {
    const index = indexAt(x, y, yard.cols);
    const tile = yard.grid[index];
    if (tile?.type !== "straight") throw new Error("Missing straight track in " + name);
    tile.type = type;
  }
  for (const [x, y, cars, reverse = false] of trains) {
    const [[type, color], ...coupled] = cars;
    const train = startTrain(
      yard.grid,
      indexAt(x, y, yard.cols),
      { type, color },
      0.5,
      0.5,
      reverse,
      yard.cols,
    )!;
    for (const [type, color] of coupled) {
      const error = couple(yard.grid, train, { type, color }, yard.cols);
      if (error) throw new Error(name + ": " + error);
    }
    yard.trains.push(train);
  }
  return yard;
}

export function scenicPresets(): Layout[] {
  return [
    buildYard(
      "Harbor Line",
      "coast",
      [
        [2, 4],
        [6, 4],
        [6, 2],
        [13, 2],
        [13, 5],
        [15, 5],
        [15, 11],
        [8, 11],
        [8, 9],
        [2, 9],
      ],
      [
        [3, 4, "bridge"],
        [2, 5, "bridge"],
        [2, 6, "bridge"],
        [2, 7, "bridge"],
        [2, 8, "bridge"],
        [5, 9, "station"],
      ],
      [
        [
          11,
          11,
          [
            ["electric", "teal"],
            ["passenger", "cream"],
            ["passenger", "ocean"],
            ["caboose", "coral"],
          ],
        ],
      ],
    ),
    buildYard(
      "Pine Summit",
      "mountain",
      [
        [3, 3],
        [6, 3],
        [6, 2],
        [11, 2],
        [11, 3],
        [14, 3],
        [14, 9],
        [11, 9],
        [11, 11],
        [3, 11],
        [3, 8],
        [2, 8],
        [2, 5],
        [3, 5],
      ],
      [
        [7, 2, "tunnel"],
        [8, 2, "tunnel"],
        [9, 2, "tunnel"],
        [10, 2, "tunnel"],
        [6, 11, "station"],
      ],
      [
        [
          8,
          11,
          [
            ["steam", "pine"],
            ["tender", "slate"],
            ["log", "brown"],
            ["log", "amber"],
            ["caboose", "brick"],
          ],
        ],
      ],
    ),
    buildYard(
      "Red Mesa Crossing",
      "desert",
      [
        [3, 3],
        [9, 3],
        [9, 11],
        [14, 11],
        [14, 6],
        [3, 6],
      ],
      [
        [6, 3, "station"],
        [12, 6, "bridge"],
        [14, 8, "station"],
      ],
      [
        [
          9,
          4,
          [
            ["diesel", "ocean"],
            ["tank", "cream"],
            ["hopper", "slate"],
          ],
        ],
        [
          6,
          6,
          [
            ["steam", "brick"],
            ["box", "amber"],
            ["caboose", "coral"],
          ],
          true,
        ],
      ],
    ),
  ];
}
