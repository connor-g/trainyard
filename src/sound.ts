import type { EngineType } from "./catalog.ts";

/** A horn for each engine, and the station bell. */
export type CallType = EngineType | "station";

type Synth = (t: number, noise: number, rumble: number) => number;

interface RollingLoop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  volume: number;
}

declare global {
  // Older Safari versions only provide the prefixed constructor.
  var webkitAudioContext: typeof AudioContext | undefined;
}

const SILENT = 0.0001;
const TAU = Math.PI * 2;
const SAMPLE_RATE = 22050;
const RAIL_VOLUME = 0.31;

function envelope(time: number, start: number, attack: number, release: number) {
  const age = time - start;
  if (age < 0 || age > attack + release) return 0;
  return age < attack ? age / attack : Math.pow(1 - (age - attack) / release, 2);
}

function beat(time: number, period: number, attack: number, release: number) {
  return envelope(time % period, 0, attack, release);
}

function tone(frequency: number, time: number) {
  return Math.sin(TAU * frequency * time);
}

function railSound(t: number, noise: number, rumble: number) {
  const joint = beat(t, 0.5, 0.007, 0.12) + 0.65 * beat(t + 0.09, 0.5, 0.005, 0.085);
  return 0.13 * rumble + joint * (0.17 * noise + 0.34 * rumble + 0.05 * tone(380, t));
}

const rollingSounds = {
  rail: railSound,
  steam(t, noise, rumble) {
    const chuff = beat(t, 0.25, 0.022, 0.2);
    return chuff * (0.09 * noise + 0.6 * rumble + 0.08 * tone(66, t));
  },
  diesel(t, noise, rumble) {
    const throb = 0.72 + 0.28 * tone(8, t);
    return throb * (0.13 * tone(60, t) + 0.06 * tone(120, t) + 0.27 * rumble);
  },
  electric(t, noise, rumble) {
    const hum = 0.75 + 0.25 * tone(4, t);
    return hum * (0.085 * tone(120, t) + 0.055 * tone(240, t) + 0.14 * rumble);
  },
} satisfies Record<string, Synth>;

const calls = {
  steam(t, noise, rumble) {
    const first = envelope(t, 0, 0.045, 0.32);
    const second = envelope(t, 0.37, 0.055, 0.59);
    const pitch = t + 0.0008 * tone(5, t);
    const whistle = 0.2 * tone(440, pitch) + 0.14 * tone(554, pitch) + 0.09 * tone(660, pitch);
    return (first * 0.8 + second) * (whistle + 0.1 * noise + 0.22 * rumble);
  },
  diesel(t, noise, rumble) {
    const blast = envelope(t, 0, 0.065, 0.95);
    const chord = [175, 220, 262].reduce(
      (sum, note) =>
        sum + 0.14 * tone(note, t) + 0.036 * tone(note * 2, t) + 0.017 * tone(note * 3, t),
      0,
    );
    return blast * (chord + 0.12 * rumble);
  },
  electric(t, noise, rumble) {
    const first = envelope(t, 0, 0.035, 0.38);
    const second = envelope(t, 0.26, 0.038, 0.47);
    return (
      first * (0.24 * tone(392, t) + 0.1 * tone(784, t)) +
      second * (0.23 * tone(523, t) + 0.09 * tone(1046, t)) +
      0.07 * (first + second) * rumble
    );
  },
  station(t) {
    const ring = (time: number) =>
      envelope(time, 0, 0.012, 0.43) *
      (0.22 * tone(880, time) + 0.085 * tone(1320, time) + 0.045 * tone(2190, time));
    return ring(t) + ring(t - 0.19);
  },
} satisfies Record<CallType, Synth>;

function makeBuffer(context: BaseAudioContext, seconds: number, synth: Synth, loop = false) {
  const length = Math.round(SAMPLE_RATE * seconds);
  const buffer = context.createBuffer(1, length, SAMPLE_RATE);
  const samples = buffer.getChannelData(0);
  let seed = 67813;
  let rumble = 0;
  for (let i = 0; i < length; i += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    rumble += (noise - rumble) * 0.12;
    const blend = loop ? Math.min(1, i / 32, (length - i - 1) / 32) : 1;
    samples[i] = blend * synth(i / SAMPLE_RATE, noise, rumble);
  }
  return buffer;
}

/** Browsers start audio suspended until the page is used; a refused resume is retried on the next unlock. */
async function resume(context: AudioContext): Promise<void> {
  try {
    await context.resume();
  } catch {
    // The next unlock tries again.
  }
}

export class TrainSound {
  enabled = true;
  context: AudioContext | undefined;
  master: GainNode | undefined;
  loops = new Map<string, RollingLoop>();
  buffers = new Map<CallType, AudioBuffer>();
  horn: AudioBufferSourceNode | null = null;
  speed = 1;
  hidden = false;

  unlock(): void {
    if (!this.enabled || this.hidden) return;
    const AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        return;
      }
      const context = this.context;
      this.master = context.createGain();
      this.master.gain.value = 0.43;
      this.master.connect(context.destination);
      for (const [name, synth] of Object.entries(rollingSounds)) {
        const source = context.createBufferSource();
        source.buffer = makeBuffer(context, 2, synth, true);
        source.loop = true;
        const gain = context.createGain();
        gain.gain.value = SILENT;
        source.connect(gain);
        gain.connect(this.master);
        source.start();
        this.loops.set(name, { source, gain, volume: SILENT });
      }
    }
    if (this.context.state !== "running") void resume(this.context);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.unlock();
    this.updateMaster();
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!hidden) this.unlock();
    this.updateMaster();
  }

  updateMaster(): void {
    if (!this.master || !this.context) return;
    const audible = this.enabled && !this.hidden;
    this.master.gain.setTargetAtTime(audible ? 0.43 : 0, this.context.currentTime, 0.02);
    if (!audible) this.stopRolling();
  }

  update(moving: ReadonlySet<string> | null, speed: number): void {
    const context = this.context;
    if (!context) return;
    const active = this.enabled && !this.hidden && moving?.size ? moving : null;
    for (const [type, loop] of this.loops) {
      const volume =
        active && (type === "rail" || active.has(type))
          ? type === "rail"
            ? RAIL_VOLUME
            : 0.72 / Math.sqrt(active.size)
          : SILENT;
      if (loop.volume !== volume) {
        loop.gain.gain.setTargetAtTime(volume, context.currentTime, 0.055);
        loop.volume = volume;
      }
      if (this.speed !== speed)
        loop.source.playbackRate.setTargetAtTime(speed, context.currentTime, 0.07);
    }
    this.speed = speed;
  }

  stopRolling(): void {
    this.update(null, this.speed);
  }

  call(type: CallType): void {
    if (!this.enabled || this.hidden) return;
    this.unlock();
    const { context, master } = this;
    if (!context || !master) return;
    if (!this.buffers.has(type)) this.buffers.set(type, makeBuffer(context, 1.08, calls[type]));
    if (type !== "station" && this.horn) this.horn.stop();
    const horn = context.createBufferSource();
    horn.buffer = this.buffers.get(type) ?? null;
    horn.connect(master);
    horn.onended = () => {
      if (this.horn === horn) this.horn = null;
      horn.disconnect();
    };
    if (type !== "station") this.horn = horn;
    horn.start();
  }
}
