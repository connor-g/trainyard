import { GRID_SIZES, blankBoard, indexAt, trackPaths } from "./railway.ts";
import type {
  Background,
  Board,
  ColorName,
  GridSize,
  Point,
  StockType,
  Tile,
  TrackType,
} from "./railway.ts";
import { frozen } from "./model/freeze.ts";
import { MAX_CARS, extendTail, isValidPath, placeCar, toRefs } from "./model/train.ts";
import { nextTrainId } from "./model/types.ts";
import type { TrainSpec, Yard } from "./model/types.ts";

type Feature = [x: number, y: number, type: TrackType];
type CarSpec = [type: StockType, color: ColorName];
type PresetTrain = [x: number, y: number, cars: CarSpec[], reverse?: boolean];

function stepPort(x: number, y: number, otherX: number, otherY: number) {
  if (x === otherX) return otherY < y ? 0 : 2;
  return otherX > x ? 1 : 3;
}

/** A board being built; presets fill it in before it is frozen into a yard. */
interface Draft {
  name: string;
  grid: (Tile | null)[];
  cols: number;
}

function layLoop(yard: Draft, corners: Point[]) {
  const { grid, cols } = yard;
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
    const index = indexAt(x, y, cols);
    const from = stepPort(x, y, ...cells.at(i - 1)!);
    const to = stepPort(x, y, ...cells[(i + 1) % cells.length]);
    const straight = Math.abs(from - to) === 2;
    const previous = grid[index];
    if (previous) {
      if (!straight || previous.type !== "straight" || previous.turn === 1 - (from % 2)) {
        throw new Error("Invalid crossing in " + yard.name);
      }
      grid[index] = { type: "cross", turn: 0, branch: false };
    } else if (straight) {
      grid[index] = { type: "straight", turn: 1 - (from % 2), branch: false };
    } else {
      const turn = [0, 1, 2, 3].find((turn) => {
        const [ports] = trackPaths({ type: "curve", turn });
        return ports.includes(from) && ports.includes(to);
      })!;
      grid[index] = { type: "curve", turn, branch: false };
    }
  });
}

/** A train standing on the square at (x, y), with its cars coupled behind the engine. */
function presetTrain(board: Board, name: string, [x, y, cars, reverse = false]: PresetTrain) {
  if (cars.length > MAX_CARS) throw new Error(name + ": too many cars");
  const placed = placeCar(board, indexAt(x, y, board.cols), 0.5, 0.5, reverse);
  if (!placed) throw new Error(name + ": no track for a train");
  const history = extendTail(board, placed.history, placed.progress, cars.length);
  if (!isValidPath(board, history, placed.progress, cars.length))
    throw new Error(name + ": not enough track behind a train");
  return {
    id: nextTrainId(),
    cars: cars.map(([type, color]) => ({ type, color })),
    start: { path: toRefs(history), progress: placed.progress },
  } satisfies TrainSpec;
}

function finish(draft: Draft, background: Background, trains: PresetTrain[]): Yard {
  const board: Board = { grid: draft.grid, cols: draft.cols, rows: draft.grid.length / draft.cols };
  return frozen({
    name: draft.name,
    board,
    background,
    trains: trains.map((train) => presetTrain(board, draft.name, train)),
  });
}

function draft(name: string): Draft {
  const { grid, cols } = blankBoard();
  return { name, grid: grid.slice(), cols };
}

function buildYard(
  name: string,
  background: Background,
  corners: Point[],
  features: Feature[],
  trains: PresetTrain[],
): Yard {
  const yard = draft(name);
  layLoop(yard, corners);
  for (const [x, y, type] of features) {
    const index = indexAt(x, y, yard.cols);
    const tile = yard.grid[index];
    if (tile?.type !== "straight") throw new Error("Missing straight track in " + name);
    yard.grid[index] = { ...tile, type };
  }
  return finish(yard, background, trains);
}

export function sampleLayout(): Yard {
  const yard = draft("Meadow Loop");
  const { grid, cols } = yard;
  const put = (x: number, y: number, type: TrackType, turn = 0) => {
    grid[indexAt(x, y, cols)] = { type, turn, branch: false };
  };
  put(3, 2, "curve");
  put(13, 2, "curve", 1);
  put(13, 9, "curve", 2);
  put(3, 9, "curve", 3);
  for (let x = 4; x < 13; x += 1) {
    put(x, 2, "straight");
    put(x, 9, "straight");
  }
  for (let y = 3; y < 9; y += 1) {
    put(3, y, "straight", 1);
    put(13, y, "straight", 1);
  }
  // The inner route rejoins the loop through the second switch.
  put(6, 2, "right");
  put(11, 2, "left", 2);
  put(6, 3, "straight", 1);
  put(11, 3, "straight", 1);
  put(6, 4, "curve", 3);
  put(11, 4, "curve", 2);
  for (let x = 7; x < 11; x += 1) put(x, 4, "straight");
  return finish(yard, "meadow", [
    [
      6,
      9,
      [
        ["steam", "brick"],
        ["box", "amber"],
        ["caboose", "pine"],
      ],
      true,
    ],
  ]);
}

export function scenicPresets(): Yard[] {
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

export function blankYard(size: GridSize = GRID_SIZES[0], background: Background = "plain"): Yard {
  return frozen({ name: "New Layout", board: blankBoard(size), background, trains: [] });
}
