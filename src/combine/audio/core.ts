/**
 * Audio core: a tiny Web Audio graph (master → compressor → speakers) with
 * a reverb convolver and two sends (music bus, effects bus). Two voices —
 * felt piano and handpan — synthesise notes live, no samples.
 *
 * The context is created lazily on first use because browsers block audio
 * until a user gesture. Call `ensureContext()` from the first pointerdown
 * handler.
 *
 * Ports SND from legacy/made-of.html lines 3978–4109. Numbers are kept
 * byte-for-byte so the port sounds like the prototype.
 */

/** Snapshot of the sound settings the audio graph reads from. */
export interface AudioSettings {
  music: "piano" | "handpan" | "off";
  sfx: boolean;
  /** 0..1. The prototype's localStorage stores 0..100; translate at the
   *  settings boundary. */
  vol: number;
}

export interface AudioCore {
  ctx: AudioContext;
  master: GainNode;
  musicBus: GainNode;
  fxBus: GainNode;
  verb: ConvolverNode;
  /** Current settings. Mutated by `applySettings`. */
  settings: AudioSettings;
  /** Call to apply new settings to the live graph. */
  applySettings: (next: AudioSettings) => void;
}

let singleton: AudioCore | null = null;

/** Create (or return) the shared audio graph. Returns null on browsers
 *  without Web Audio. Always safe to call from a user gesture handler. */
export function ensureContext(settings: AudioSettings): AudioCore | null {
  if (singleton) {
    singleton.applySettings(settings);
    return singleton;
  }
  if (typeof window === "undefined") return null;
  type AC = typeof AudioContext;
  const WebkitWin = window as unknown as {
    AudioContext?: AC;
    webkitAudioContext?: AC;
  };
  const AC = WebkitWin.AudioContext ?? WebkitWin.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  comp.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 0.9 * clamp01(settings.vol);
  master.connect(comp);

  const verb = ctx.createConvolver();
  verb.buffer = makeReverbIR(ctx, 3.4);
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  verb.connect(wet);
  wet.connect(master);

  const musicBus = ctx.createGain();
  musicBus.gain.value = settings.music === "piano" ? 0.2 : 0.16;
  musicBus.connect(master);
  musicBus.connect(verb);

  // Effects sit well under the music: quieter, with the top end rounded
  // off and more room sound than the music.
  const fxBus = ctx.createGain();
  fxBus.gain.value = 0.11;
  const fxSoft = ctx.createBiquadFilter();
  fxSoft.type = "lowpass";
  fxSoft.frequency.value = 1800;
  fxSoft.Q.value = 0.3;
  fxBus.connect(fxSoft);
  fxSoft.connect(master);
  const fxRoom = ctx.createGain();
  fxRoom.gain.value = 1.4;
  fxSoft.connect(fxRoom);
  fxRoom.connect(verb);

  const core: AudioCore = {
    ctx,
    master,
    musicBus,
    fxBus,
    verb,
    settings: { ...settings },
    applySettings(next) {
      core.settings = { ...next };
      master.gain.value = 0.9 * clamp01(next.vol);
      musicBus.gain.value = next.music === "piano" ? 0.2 : 0.16;
    },
  };
  singleton = core;
  return core;
}

/** Resume a suspended context (iOS keeps it suspended until a gesture). */
export function resume(core: AudioCore): void {
  if (core.ctx.state === "suspended") {
    void core.ctx.resume();
  }
}

/** Stop everything and release the context (visibility change, teardown). */
export function suspend(core: AudioCore): void {
  if (core.ctx.state === "running") {
    void core.ctx.suspend();
  }
}

/** True if there's a live audio graph. */
export function hasContext(): boolean {
  return singleton != null;
}

export function getContext(): AudioCore | null {
  return singleton;
}

/* ========================================================================
 * Voices
 * ====================================================================== */

/** Handpan strike: fundamental + octave + compound fifth, each ringing out
 *  at its own rate, with a short low "hand thump" at the attack. */
export function playHandpan(
  core: AudioCore,
  freq: number,
  t: number,
  vel: number,
  bus: AudioNode,
  len = 1,
): void {
  const { ctx } = core;
  const out = ctx.createGain();
  out.gain.value = vel;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = Math.min(5200, freq * 9);
  lp.Q.value = 0.4;
  out.connect(lp);
  lp.connect(bus);
  const partials: Array<[number, number, number]> = [
    [1, 1, 2.6],
    [2, 0.42, 1.3],
    [3, 0.16, 0.55],
    [1.0035, 0.22, 2.2],
  ];
  for (const [m, g, dec] of partials) {
    const o = ctx.createOscillator();
    const e = ctx.createGain();
    o.type = "sine";
    o.frequency.value = freq * m;
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(g, t + 0.006);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dec * len);
    o.connect(e);
    e.connect(out);
    o.start(t);
    o.stop(t + dec * len + 0.05);
  }
  // Low thump at the attack.
  const th = ctx.createOscillator();
  const tg = ctx.createGain();
  th.type = "sine";
  th.frequency.setValueAtTime(freq * 0.5, t);
  th.frequency.exponentialRampToValueAtTime(freq * 0.35, t + 0.08);
  tg.gain.setValueAtTime(0.0001, t);
  tg.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  th.connect(tg);
  tg.connect(out);
  th.start(t);
  th.stop(t + 0.15);
}

/** Felt piano key: a gentle hammer, overtones that fade first, and a tone
 *  that darkens as it rings. */
export function playPiano(
  core: AudioCore,
  freq: number,
  t: number,
  vel: number,
  bus: AudioNode,
  len = 1,
): void {
  const { ctx } = core;
  const out = ctx.createGain();
  out.gain.value = vel;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.3;
  lp.frequency.setValueAtTime(Math.min(4200, freq * 7), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, freq * 1.6), t + 1.8 * len);
  out.connect(lp);
  lp.connect(bus);
  const partials: Array<[number, number, number]> = [
    [1, 1, 4.2],
    [2, 0.3, 2.4],
    [3, 0.1, 1.3],
    [4, 0.04, 0.8],
    [1.0018, 0.35, 3.6],
  ];
  for (const [m, g, dec] of partials) {
    const o = ctx.createOscillator();
    const e = ctx.createGain();
    o.type = m === 1 ? "triangle" : "sine";
    o.frequency.value = freq * m;
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(g, t + 0.018);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dec * len);
    o.connect(e);
    e.connect(out);
    o.start(t);
    o.stop(t + dec * len + 0.05);
  }
}

/** Play one note with the voice that matches the current music track. */
export function strike(
  core: AudioCore,
  freq: number,
  t: number,
  vel: number,
  bus: AudioNode,
  len = 1,
): void {
  if (core.settings.music === "piano") {
    playPiano(core, freq, t, vel * 0.8, bus, len);
  } else {
    playHandpan(core, freq, t, vel, bus, len);
  }
}

/** A soft noise whoosh for the crumble effect: a band-passed burst that
 *  sweeps 900 → 250 Hz over 350 ms. */
export function playHush(core: AudioCore, t: number, vel: number): void {
  const { ctx, fxBus } = core;
  const len = Math.floor(ctx.sampleRate * 0.4);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  s.buffer = b;
  f.type = "bandpass";
  f.frequency.setValueAtTime(900, t);
  f.frequency.exponentialRampToValueAtTime(250, t + 0.35);
  f.Q.value = 0.8;
  g.gain.value = vel;
  s.connect(f);
  f.connect(g);
  g.connect(fxBus);
  s.start(t);
}

/* ========================================================================
 * Helpers
 * ====================================================================== */

/** MIDI → Hz using A4 = 440. */
export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function makeReverbIR(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
  }
  return ir;
}
