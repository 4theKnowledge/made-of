/**
 * Audio core: a tiny Web Audio graph (master → compressor → speakers) with
 * a reverb convolver and two sends (music bus, effects bus). Three voices —
 * felt piano, chimes (steel-tongue bell), and a slow pad — synthesise
 * notes live, no samples.
 *
 * The context is created lazily on first use because browsers block audio
 * until a user gesture. Call `ensureContext()` from the first pointerdown
 * handler.
 *
 */

/** Snapshot of the sound settings the audio graph reads from. */
export interface AudioSettings {
  music: "piano" | "chimes" | "drift" | "hearth" | "rainfall" | "off";
  /** Which sfx voice palette to use. `"off"` silences all effects — the
   *  pack name doubles as the on/off switch, so a boolean isn't needed. */
  sfxPack: "classic" | "wood" | "chime" | "off";
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
  /** The fxBus→verb send gain. `openVerb` ramps this to put big sfx in a
   *  bigger room briefly. Default 1.4. */
  fxRoomSend: GainNode;
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
  musicBus.gain.value = musicBusGain(settings.music);
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
    fxRoomSend: fxRoom,
    settings: { ...settings },
    applySettings(next) {
      core.settings = { ...next };
      master.gain.value = 0.9 * clamp01(next.vol);
      musicBus.gain.value = musicBusGain(next.music);
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

/** Briefly duck the music bus so a sfx can land legibly over the music.
 *  Ramps musicBus.gain down by `amountDb`, holds for `holdMs`, then ramps
 *  back to the per-track baseline via `musicBusGain(track)` over `releaseMs`.
 *  No-op when music is "off" — nothing to duck.
 *
 *  Overlapping ducks (closely-spaced sfx) compose cleanly: each call cancels
 *  the previous schedule from `now` onwards and restarts from the current
 *  gain value, so you never get a pump when a second sfx fires inside the
 *  first duck's release window. */
export function duck(
  core: AudioCore,
  amountDb: number,
  holdMs: number,
  releaseMs: number,
): void {
  if (core.settings.music === "off") return;
  const { ctx, musicBus } = core;
  const now = ctx.currentTime;
  const baseline = musicBusGain(core.settings.music);
  // dB → linear. amountDb is negative (e.g. -4 = ducked 4 dB); the helper
  // accepts the magnitude for readability.
  const duckedGain = baseline * Math.pow(10, -Math.abs(amountDb) / 20);
  musicBus.gain.cancelScheduledValues(now);
  // Grab the gain value *at the moment the first sfx fires* so an overlapping
  // duck doesn't pump back up to baseline between hits.
  const current = musicBus.gain.value;
  musicBus.gain.setValueAtTime(current, now);
  musicBus.gain.linearRampToValueAtTime(Math.min(current, duckedGain), now + 0.02);
  musicBus.gain.setValueAtTime(Math.min(current, duckedGain), now + 0.02 + holdMs / 1000);
  musicBus.gain.linearRampToValueAtTime(
    baseline,
    now + 0.02 + holdMs / 1000 + releaseMs / 1000,
  );
}

/** Briefly open the fxBus→verb send so a big moment (long fuse chain, big
 *  unlock) sits in a larger room. `mult` multiplies the current send gain
 *  (default 1.4); the send returns to default after `holdMs` via a short
 *  linear ramp. Composes with overlapping calls the same way `duck` does. */
export function openVerb(core: AudioCore, mult: number, holdMs: number): void {
  const { ctx, fxRoomSend } = core;
  const now = ctx.currentTime;
  const baseline = 1.4;
  const peak = baseline * mult;
  fxRoomSend.gain.cancelScheduledValues(now);
  const current = fxRoomSend.gain.value;
  fxRoomSend.gain.setValueAtTime(current, now);
  fxRoomSend.gain.linearRampToValueAtTime(Math.max(current, peak), now + 0.03);
  fxRoomSend.gain.linearRampToValueAtTime(baseline, now + 0.03 + holdMs / 1000);
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

/** Play one note with the voice that matches the current music track.
 *  Drift's pad voice is too slow for feedback effects, so sfx under drift
 *  still use the chimes voice. */
export function strike(
  core: AudioCore,
  freq: number,
  t: number,
  vel: number,
  bus: AudioNode,
  len = 1,
): void {
  if (core.settings.music === "piano" || core.settings.music === "hearth") {
    playPiano(core, freq, t, vel * 0.8, bus, len);
  } else {
    playHandpan(core, freq, t, vel, bus, len);
  }
}

/** Slow pad voice for the drift track: two detuned triangle oscillators
 *  through a lowpass that opens over ~2 s then closes, producing a long
 *  breathy swell. Used for sustained chord drones, never for feedback. */
export function playPad(
  core: AudioCore,
  freq: number,
  t: number,
  vel: number,
  bus: AudioNode,
  len = 8,
): void {
  const { ctx } = core;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(vel, t + 1.8);
  out.gain.setValueAtTime(vel, t + len * 0.55);
  out.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.6;
  lp.frequency.setValueAtTime(Math.max(260, freq * 1.4), t);
  lp.frequency.exponentialRampToValueAtTime(Math.min(2400, freq * 5), t + len * 0.4);
  lp.frequency.exponentialRampToValueAtTime(Math.max(260, freq * 1.5), t + len);
  out.connect(lp);
  lp.connect(bus);
  // Two detuned triangles an octave apart give the pad its slow beat.
  const partials: Array<[number, number]> = [
    [1, 0.6],
    [1.0046, 0.55],
    [2, 0.18],
  ];
  for (const [m, g] of partials) {
    const o = ctx.createOscillator();
    const e = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = freq * m;
    e.gain.value = g;
    o.connect(e);
    e.connect(out);
    o.start(t);
    o.stop(t + len + 0.1);
  }
}

/** Short dry wood-knock: a sine with a fast exponential decay plus a tiny
 *  click transient, routed through a highpass so it reads as "tapped" not
 *  "bowed". Deliberately dry (no reverb send from caller — pass fxBus
 *  directly and skip the fxRoom) so it sits close to the listener and
 *  doesn't smear on busy chains. */
export function playKnock(
  core: AudioCore,
  freq: number,
  t: number,
  vel: number,
  bus: AudioNode,
  len = 0.2,
): void {
  const { ctx } = core;
  const out = ctx.createGain();
  out.gain.value = vel;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 180;
  hp.Q.value = 0.5;
  out.connect(hp);
  hp.connect(bus);

  // Body: sine at the target freq with a ~80–180 ms decay, sized by len.
  const o = ctx.createOscillator();
  const e = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, t);
  // Tiny pitch drop at the start makes it read as a damped wooden strike
  // rather than a bell tone.
  o.frequency.exponentialRampToValueAtTime(freq * 0.88, t + 0.03);
  e.gain.setValueAtTime(0.0001, t);
  e.gain.exponentialRampToValueAtTime(1, t + 0.004);
  e.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(e);
  e.connect(out);
  o.start(t);
  o.stop(t + len + 0.02);

  // Click transient: a 20 ms noise burst through a narrow bandpass at ~2 kHz
  // to give the knock its "wooden" edge.
  const nLen = Math.floor(ctx.sampleRate * 0.02);
  const nb = ctx.createBuffer(1, nLen, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
  const ns = ctx.createBufferSource();
  const nf = ctx.createBiquadFilter();
  const ng = ctx.createGain();
  ns.buffer = nb;
  nf.type = "bandpass";
  nf.frequency.value = 2000;
  nf.Q.value = 1.6;
  ng.gain.value = 0.35;
  ns.connect(nf);
  nf.connect(ng);
  ng.connect(out);
  ns.start(t);
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

/** Short soft wood-creak accent for the Hearth track: a quiet band-passed
 *  noise burst centred low (~180 Hz) that wobbles down a touch. Deliberately
 *  dry (routes to the bus the caller picks, not the reverb) so it reads as
 *  "near" rather than "in the room". */
export function playCreak(core: AudioCore, t: number, vel: number, bus: AudioNode): void {
  const { ctx } = core;
  const len = Math.floor(ctx.sampleRate * 0.5);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  s.buffer = b;
  f.type = "bandpass";
  f.frequency.setValueAtTime(220, t);
  f.frequency.exponentialRampToValueAtTime(140, t + 0.35);
  f.Q.value = 2.4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vel, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  s.connect(f);
  f.connect(g);
  g.connect(bus);
  s.start(t);
}

/** Long-lived noise bed for Rainfall. Returns a stop handle so callers can
 *  tear it down on track change / fade. Uses a looping noise buffer through
 *  a lowpass whose cutoff drifts 300 ↔ 1200 Hz on a slow sine LFO, so the
 *  rain "breathes" instead of sitting as flat hiss. */
export function startNoiseBed(
  core: AudioCore,
  bus: AudioNode,
): { stop: () => void } {
  const { ctx } = core;
  // 2 s loop of pink-ish noise (filtered white): long enough that the loop
  // point is not audible; short enough that the GC isn't holding on to a
  // huge buffer for the whole session.
  const loopSec = 2;
  const frames = Math.floor(ctx.sampleRate * loopSec);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Cheap pink-ish noise via a running average of a few white samples;
  // takes the edge off the high end so it reads as rain rather than hiss.
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < frames; i++) {
    const w = Math.random() * 2 - 1;
    a = 0.99 * a + 0.01 * w;
    b = 0.9 * b + 0.1 * w;
    c = 0.5 * c + 0.5 * w;
    d[i] = (a * 2 + b + c * 0.5) / 3.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 0.6;
  lp.frequency.value = 600;

  // LFO on the cutoff. A ~7 s sine between 300 and 1200 Hz.
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 1 / 7;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 450; // amplitude ±450 Hz around 750 Hz midpoint
  lp.frequency.setValueAtTime(750, ctx.currentTime);
  lfo.connect(lfoGain);
  lfoGain.connect(lp.frequency);

  const out = ctx.createGain();
  out.gain.value = 1;

  src.connect(lp);
  lp.connect(out);
  out.connect(bus);

  src.start();
  lfo.start();

  return {
    stop: () => {
      try {
        src.stop();
        lfo.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
      lp.disconnect();
      lfo.disconnect();
      lfoGain.disconnect();
      out.disconnect();
    },
  };
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

/** Per-track music bus gain. Drift's pad voice is already sustained and
 *  wet, so it needs the least gain to sit at the same perceived level. */
export function musicBusGain(track: AudioSettings["music"]): number {
  if (track === "piano") return 0.2;
  if (track === "drift") return 0.13;
  if (track === "hearth") return 0.18;
  // Rainfall is a continuous noise bed; it has to sit well below the
  // chord-based voices or it dominates and masks everything.
  if (track === "rainfall") return 0.08;
  return 0.16;
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
