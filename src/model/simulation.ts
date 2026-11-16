import { isEngine, neighbor, onward, pathKey, position } from "../railway.ts";
import type { Board, Car, CarPosition, Segment, StockType } from "../railway.ts";
import {
  CAR_GAP,
  COLLISION,
  END_CLEARANCE,
  carPositionsOn,
  overlaps,
  toSegments,
} from "./train.ts";
import type { Motion, TrainId, TrainMotion, Yard } from "./types.ts";

const SPEED = 1.6;
const STATION_STOP_SECONDS = 1.6;
const CROSSING_CLEARANCE = 0.38;
const CROSSING_STOP_DISTANCE = 0.42;

interface StationStop {
  /** Key of the platform segment the train stopped on. */
  readonly path: string;
  readonly remaining: number;
}
interface CrossingRequest {
  /** Key of the segment the train is approaching the crossing on. */
  readonly path: string;
  readonly crossing: number;
  readonly order: number;
}

/** Simulation bookkeeping that isn't part of a train's position, keyed by train. */
export interface SimState {
  readonly stationStops: ReadonlyMap<TrainId, StationStop>;
  readonly crossingRequests: ReadonlyMap<TrainId, CrossingRequest>;
  readonly crossingArrival: number;
}

export const initialSimState = (): SimState => ({
  stationStops: new Map(),
  crossingRequests: new Map(),
  crossingArrival: 0,
});

export interface StepEvents {
  /** For the rolling sound. */
  readonly movingEngines: ReadonlySet<StockType>;
  /** For steam puffs. */
  readonly movingTrains: ReadonlySet<TrainId>;
  /** For the station bell. */
  readonly stationArrivals: number;
}

/** A train while it is being stepped. */
interface Running {
  readonly id: TrainId;
  readonly cars: readonly Car[];
  readonly before: TrainMotion;
  history: readonly Segment[];
  progress: number;
  held: boolean;
}

interface CrossingApproach {
  path: Segment;
  crossing: number;
  untilStop: number;
  order?: number;
}

const head = (train: Running) => train.history[train.history.length - 1];

function crossingTraffic(
  board: Board,
  trains: readonly Running[],
  requests: Map<TrainId, CrossingRequest>,
  arrival: { next: number },
  distance: number,
) {
  const { grid } = board;
  const owners = new Map<number, Running>();
  const approaches = new Map<Running, CrossingApproach>();
  const encroaching = new Map<Running, Segment>();
  for (const train of trains) {
    const path = head(train);
    const nextIndex = neighbor(board, path.index, path.to);
    const next = grid[nextIndex]?.type === "cross" ? onward(board, path) : null;
    const headIndex = train.history.length - 1;
    let behind = 0;
    const tail = (train.cars.length - 1) * CAR_GAP + CROSSING_CLEARANCE;
    // Reserve the entire length of the train, including the gaps between cars.
    for (let i = headIndex; i >= 0 && behind <= tail; i -= 1) {
      const piece = train.history[i];
      if (grid[piece.index]?.type === "cross" && !owners.has(piece.index))
        owners.set(piece.index, train);
      behind += i === headIndex ? train.progress : piece.length;
    }
    if (!next) {
      requests.delete(train.id);
      continue;
    }
    const untilStop = path.length - train.progress - CROSSING_STOP_DISTANCE;
    if (untilStop > distance) {
      requests.delete(train.id);
      continue;
    }
    approaches.set(train, { path, crossing: next.index, untilStop });
    if (path.length - train.progress < CROSSING_CLEARANCE) encroaching.set(train, next);
  }
  for (const [train, path] of encroaching) {
    if (!owners.has(path.index)) owners.set(path.index, train);
  }

  // For arrivals within the same frame, the closer train reached the stop line first.
  const arrivals = [...approaches].sort(([, a], [, b]) => a.untilStop - b.untilStop);
  for (const [train, approach] of arrivals) {
    const previous = requests.get(train.id);
    const path = pathKey(approach.path);
    if (previous?.path === path && previous.crossing === approach.crossing) {
      approach.order = previous.order;
    } else {
      approach.order = arrival.next++;
      requests.set(train.id, { path, crossing: approach.crossing, order: approach.order });
    }
  }
  arrivals.sort(([, a], [, b]) => a.order! - b.order!);
  for (const [train, { crossing }] of arrivals) {
    if (!owners.has(crossing)) owners.set(crossing, train);
  }
  return { owners, approaches, encroaching };
}

const NO_EVENTS: StepEvents = {
  movingEngines: new Set(),
  movingTrains: new Set(),
  stationArrivals: 0,
};

/**
 * Advances every train by `seconds` at `speed`. Pure: returns the new motion and simulation state.
 *
 * A held train stays still until no other train overlaps it. Collisions are ignored between
 * trains that overlap right now, so the other train can drive clear; every other pair collides
 * as usual.
 */
export function step(
  yard: Yard,
  motion: Motion,
  sim: SimState,
  seconds: number,
  speed: number,
): { motion: Motion; sim: SimState; events: StepEvents } {
  const distance = seconds * speed * SPEED;
  if (!(distance > 0) || !yard.trains.length) return { motion, sim, events: NO_EVENTS };
  const { board } = yard;
  const { grid, cols } = board;
  const trains: Running[] = yard.trains.map((train) => {
    const before = motion.get(train.id) ?? {
      history: toSegments(train.start.path),
      progress: train.start.progress,
      held: false,
    };
    return { id: train.id, cars: train.cars, before, ...before };
  });
  const occupied = trains.map((train) =>
    carPositionsOn(train.history, train.progress, train.cars, cols),
  );
  const overlapping = trains.map(() => new Set<number>());
  occupied.forEach((cars, i) => {
    for (let j = i + 1; j < occupied.length; j += 1) {
      if (!overlaps(cars, occupied[j])) continue;
      overlapping[i].add(j);
      overlapping[j].add(i);
    }
  });
  trains.forEach((train, i) => {
    if (train.held && !overlapping[i].size) train.held = false;
  });

  const ids = new Set(trains.map((train) => train.id));
  const stationStops = new Map([...sim.stationStops].filter(([id]) => ids.has(id)));
  const requests = new Map([...sim.crossingRequests].filter(([id]) => ids.has(id)));
  const arrival = { next: sim.crossingArrival };
  // Held trains neither reserve crossings nor queue for them, so the train they overlap can leave.
  const traffic =
    trains.length > 1
      ? crossingTraffic(
          board,
          trains.filter((train) => !train.held),
          requests,
          arrival,
          distance,
        )
      : null;

  const movingEngines = new Set<StockType>();
  const movingTrains = new Set<TrainId>();
  let stationArrivals = 0;
  trains.forEach((train, index) => {
    if (train.held) return;
    let path = head(train);
    const crossing = grid[path.index]?.type === "cross" ? path : null;
    const owner = crossing && traffic?.owners.get(crossing.index);
    const ownerPath = owner && (traffic?.encroaching.get(owner) ?? head(owner));
    if (
      owner &&
      ownerPath &&
      owner !== train &&
      ownerPath.index === crossing.index &&
      ownerPath.from % 2 !== crossing.from % 2
    )
      return;
    const key = pathKey(path);
    let stop = stationStops.get(train.id);
    if (stop && stop.path !== key) {
      // The train has left the platform, so it can stop there again next time round.
      stationStops.delete(train.id);
      stop = undefined;
    }
    if (stop && stop.remaining > 0) {
      stationStops.set(train.id, { ...stop, remaining: stop.remaining - seconds });
      return;
    }
    let progress = train.progress + distance;
    const approach = traffic?.approaches.get(train);
    if (approach && traffic?.owners.get(approach.crossing) !== train) {
      progress = train.progress + Math.max(0, approach.untilStop);
    }
    let next: Segment | null = null;
    const midpoint = path.length / 2;
    const arriving =
      grid[path.index]?.type === "station" &&
      !stop &&
      train.progress <= midpoint &&
      progress >= midpoint;
    if (arriving) {
      progress = midpoint;
    } else if (progress >= path.length) {
      next = onward(board, path);
      progress = next
        ? progress - path.length
        : Math.max(train.progress, path.length - Math.min(END_CLEARANCE, path.length / 2));
      if (next) path = next;
    } else if (path.length - progress < END_CLEARANCE && !onward(board, path)) {
      progress = Math.max(train.progress, path.length - Math.min(END_CLEARANCE, path.length / 2));
    }
    const candidate = position(path, progress, cols);
    const blocked = occupied.some(
      (cars: readonly CarPosition[], other) =>
        other !== index &&
        !overlapping[index].has(other) &&
        cars.some((car) => Math.hypot(candidate.x - car.x, candidate.y - car.y) < COLLISION),
    );
    if (blocked) return;
    const moved = next || progress > train.progress;
    if (moved) {
      for (const car of train.cars) if (isEngine(car.type)) movingEngines.add(car.type);
    }
    const history = next ? [...train.history, next] : [...train.history];
    train.progress = progress;
    if (arriving) {
      stationStops.set(train.id, { path: pathKey(path), remaining: STATION_STOP_SECONDS });
      stationArrivals += 1;
    }
    let remaining = (train.cars.length - 1) * CAR_GAP - progress;
    let keepFrom = history.length - 1;
    while (keepFrom > 0 && remaining > 0) {
      keepFrom -= 1;
      remaining -= history[keepFrom].length;
    }
    // A few previous pieces let a new car appear immediately when coupled.
    history.splice(0, Math.max(0, keepFrom - 2));
    train.history = history.length === train.history.length && !next ? train.history : history;
    occupied[index] = carPositionsOn(train.history, train.progress, train.cars, cols);
    if (moved) movingTrains.add(train.id);
  });

  const nextMotion = new Map<TrainId, TrainMotion>();
  for (const train of trains) {
    const { before, history, progress, held } = train;
    const unchanged =
      before.history === history && before.progress === progress && before.held === held;
    nextMotion.set(train.id, unchanged ? before : { history, progress, held });
  }
  return {
    motion: nextMotion,
    sim: { stationStops, crossingRequests: requests, crossingArrival: arrival.next },
    events: { movingEngines, movingTrains, stationArrivals },
  };
}
