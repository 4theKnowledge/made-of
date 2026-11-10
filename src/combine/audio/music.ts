/**
 * Three generative music tracks:
 *   - piano: D major chord loop with a melodic answer figure
 *   - chimes: D Kurd steel-tongue bell (random walk, phrases + rests)
 *   - drift: slow pad drones on the piano progression, ~every 6–8 s
 *
 * A single 120 ms scheduler loop reads the active track and dispatches to
 * the right tick function.
 */

import {
  getContext,
  midiToFreq,
  musicBusGain,
  playCreak,
  playHandpan,
  playPad,
  playPiano,
  startNoiseBed,
  type AudioCore,
} from "./core";

/** D Kurd steel-tongue scale: D3 | A3 Bb3 C4 D4 E4 F4 G4 A4 C5. */
const KURD = [
  146.83, 220.0, 233.08, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 523.25,
];

/** Chord progression in MIDI numbers: Dmaj7, Bm7, Gmaj7, A. */
const CHORDS: number[][] = [
  [38, 62, 66, 69, 73],
  [35, 59, 62, 66, 69],
  [31, 55, 59, 62, 66],
  [33, 57, 61, 64, 71],
];

/** High melody notes for the piano. */
const MEL = [74, 76, 78, 81, 83, 86];

interface MusicState {
  timer: ReturnType<typeof setInterval> | null;
  nextT: number;
  step: number;
  walk: number;
  phraseLeft: number;
  restLeft: number;
  chord: number;
  quiet: number;
  /** Supplied by callers so tracks can modulate density by how deep the
   *  player is into the game (same as the prototype's CB.chapter). */
  busyGetter: () => number;
  /** Rainfall's long-lived noise bed. Nulled when another track is active. */
  noiseBed: { stop: () => void } | null;
  /** Timestamp of the next distant piano accent for Rainfall. */
  rainNextAccentT: number;
}

const state: MusicState = {
  timer: null,
  nextT: 0,
  step: 0,
  walk: 4,
  phraseLeft: 0,
  restLeft: 0,
  chord: 0,
  quiet: 0,
  busyGetter: () => 0,
  noiseBed: null,
  rainNextAccentT: 0,
};

function tickChimes(core: AudioCore): void {
  const { ctx, musicBus } = core;
  const busy = state.busyGetter();
  const density = 0.5 + busy * 0.04;
  const BEAT = 0.78;
  while (state.nextT < ctx.currentTime + 0.4) {
    const t = state.nextT + (Math.random() - 0.5) * 0.03;
    if (state.step % 16 === 0) {
      playHandpan(core, KURD[0], t, 0.5, musicBus, 1.3);
    } else if (state.step % 16 === 8 && Math.random() < 0.6) {
      playHandpan(core, KURD[1], t, 0.35, musicBus, 1.2);
    }
    if (state.restLeft > 0) {
      state.restLeft--;
    } else {
      if (state.phraseLeft <= 0) {
        state.phraseLeft = 3 + Math.floor(Math.random() * 5);
      }
      const off = state.step % 2 === 1;
      if (Math.random() < (off ? density * 0.45 : density)) {
        const r = Math.random();
        state.walk +=
          r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.82 ? 2 : r < 0.94 ? -2 : 0;
        if (state.walk < 1) state.walk = 2;
        if (state.walk > KURD.length - 1) state.walk = KURD.length - 3;
        playHandpan(
          core,
          KURD[state.walk],
          t,
          (off ? 0.32 : 0.48) + Math.random() * 0.15,
          musicBus,
        );
        if (Math.random() < 0.12 && state.walk + 2 < KURD.length) {
          playHandpan(core, KURD[state.walk + 2], t + 0.02, 0.25, musicBus);
        }
        state.phraseLeft--;
        if (state.phraseLeft <= 0) {
          state.restLeft = 2 + Math.floor(Math.random() * 4);
        }
      }
    }
    state.step++;
    state.nextT += BEAT / 2;
  }
}

function tickPiano(core: AudioCore): void {
  const { ctx, musicBus } = core;
  const BEAT = 1.05;
  while (state.nextT < ctx.currentTime + 0.5) {
    const t = state.nextT + (Math.random() - 0.5) * 0.04;
    const b = state.step % 8;
    const C = CHORDS[state.chord];
    if (b === 0) {
      if (state.quiet > 0) state.quiet--;
      else if (Math.random() < 0.18) state.quiet = 1;
      // Low root to anchor it.
      playPiano(core, midiToFreq(C[0] + 12), t, 0.42, musicBus, 1.6);
      if (!state.quiet && Math.random() < 0.5) {
        playPiano(core, midiToFreq(C[2]), t + 0.03, 0.22, musicBus, 1.4);
      }
    } else if (!state.quiet) {
      const p = b % 2 === 0 ? 0.42 : 0.16;
      if (Math.random() < p) {
        playPiano(
          core,
          midiToFreq(C[1 + Math.floor(Math.random() * 4)]),
          t,
          0.2 + Math.random() * 0.12,
          musicBus,
          1.3,
        );
      }
      if (b === 4 && Math.random() < 0.35) {
        const m = MEL[Math.floor(Math.random() * MEL.length)];
        playPiano(core, midiToFreq(m), t + 0.05, 0.17, musicBus, 1.5);
        if (Math.random() < 0.4) {
          playPiano(
            core,
            midiToFreq(m - 3 + Math.floor(Math.random() * 2)),
            t + BEAT * 0.5,
            0.13,
            musicBus,
            1.5,
          );
        }
      }
    }
    state.step++;
    state.nextT += BEAT;
    if (state.step % 8 === 0) {
      state.chord =
        (state.chord + (Math.random() < 0.8 ? 1 : 2)) % CHORDS.length;
    }
  }
}

/** Hearth: slower than piano, a held low chord root plus the occasional
 *  mid or high piano note. Chord holds for two bars. A quiet wood-creak
 *  accent fires with low probability so the track doesn't feel sterile. */
function tickHearth(core: AudioCore): void {
  const { ctx, musicBus } = core;
  const BEAT = 1.6;
  while (state.nextT < ctx.currentTime + 0.6) {
    const t = state.nextT + (Math.random() - 0.5) * 0.04;
    const b = state.step % 8;
    const C = CHORDS[state.chord];
    if (b === 0) {
      // Low root, long and gentle — the hearth.
      playPiano(core, midiToFreq(C[0]), t, 0.5, musicBus, 2.4);
      if (Math.random() < 0.55) {
        playPiano(core, midiToFreq(C[2]), t + 0.05, 0.26, musicBus, 2.0);
      }
    } else if (b === 3 && Math.random() < 0.3) {
      playPiano(
        core,
        midiToFreq(C[1 + Math.floor(Math.random() * 3)]),
        t,
        0.22,
        musicBus,
        1.6,
      );
    } else if (b === 5 && Math.random() < 0.18) {
      playPiano(
        core,
        midiToFreq(C[2 + Math.floor(Math.random() * 3)] + 12),
        t,
        0.18,
        musicBus,
        1.4,
      );
    }
    // Rare wood-creak accent. Dry (not through reverb) so it reads "near".
    if (Math.random() < 0.05) {
      playCreak(core, t + 0.1, 0.12, musicBus);
    }
    state.step++;
    state.nextT += BEAT;
    // Chord moves every 2 bars (step % 16 === 0), slower than piano.
    if (state.step % 16 === 0) {
      state.chord = (state.chord + 1) % CHORDS.length;
    }
  }
}

/** Rainfall: continuous noise bed (lazily started once) plus a very distant
 *  piano chord-tone every ~14–20 s. The piano accent gives it a hint of
 *  musical shape so it isn't pure white noise. */
function tickRainfall(core: AudioCore): void {
  const { ctx, musicBus } = core;
  // Start the noise bed the first time we tick. Kept alive in state so
  // changing tracks / fading can tear it down cleanly.
  if (!state.noiseBed) {
    state.noiseBed = startNoiseBed(core, musicBus);
    state.rainNextAccentT = ctx.currentTime + 4;
  }
  while (state.rainNextAccentT < ctx.currentTime + 0.5) {
    const t = state.rainNextAccentT;
    const C = CHORDS[state.chord];
    // Route accents through the main music bus; the bus already has the
    // reverb send wired by the audio graph, so they come back wet and
    // distant.
    const tone = C[1 + Math.floor(Math.random() * 4)];
    playPiano(core, midiToFreq(tone), t, 0.14, musicBus, 2.4);
    state.step++;
    // Next accent in 14–20 s.
    state.rainNextAccentT = t + 14 + Math.random() * 6;
    // Advance chord slowly so successive accents don't lock on one note.
    if (state.step % 2 === 0) {
      state.chord = (state.chord + 1) % CHORDS.length;
    }
  }
}

function tickDrift(core: AudioCore): void {
  const { ctx, musicBus } = core;
  // One pad note every ~6 s, lasting ~9 s so they overlap into a wash.
  const BEAT = 6.2;
  const LEN = 9.5;
  while (state.nextT < ctx.currentTime + 1.5) {
    const t = state.nextT + (Math.random() - 0.5) * 0.4;
    const C = CHORDS[state.chord];
    // Low chord root sits underneath.
    playPad(core, midiToFreq(C[0]), t, 0.6, musicBus, LEN);
    // One upper chord tone, picked at random; sometimes two for a swell.
    const upper = C[1 + Math.floor(Math.random() * 4)];
    playPad(core, midiToFreq(upper), t + 0.4, 0.42, musicBus, LEN - 1);
    if (Math.random() < 0.3) {
      const second = C[1 + Math.floor(Math.random() * 4)];
      playPad(core, midiToFreq(second), t + 1.1, 0.28, musicBus, LEN - 1.6);
    }
    state.step++;
    state.nextT += BEAT;
    // Chord moves every two pad notes; piano and drift share the loop
    // feel without ever landing on the exact same beat.
    if (state.step % 2 === 0) {
      state.chord = (state.chord + 1) % CHORDS.length;
    }
  }
}

/** Start the current music track. No-op if already running or if `music`
 *  is "off". */
export function startMusic(opts?: { busyGetter?: () => number }): void {
  const core = getContext();
  if (!core) return;
  if (core.settings.music === "off") return;
  if (state.timer) return;
  if (opts?.busyGetter) state.busyGetter = opts.busyGetter;
  if (core.ctx.state === "suspended") {
    void core.ctx.resume().catch(() => {
      /* Safari rejects resume outside a gesture; next gesture retries. */
    });
  }
  restoreMusicBusGain();
  state.nextT = core.ctx.currentTime + 0.2;
  state.step = 0;
  state.walk = 4;
  state.phraseLeft = 0;
  state.restLeft = 0;
  state.chord = 0;
  state.quiet = 0;
  state.timer = setInterval(() => {
    if (!core.ctx) return;
    // Any track that isn't Rainfall should release the noise bed. This
    // runs each tick so switching tracks mid-session cleans up without a
    // dedicated handler.
    if (core.settings.music !== "rainfall" && state.noiseBed) {
      state.noiseBed.stop();
      state.noiseBed = null;
    }
    if (core.settings.music === "piano") tickPiano(core);
    else if (core.settings.music === "chimes") tickChimes(core);
    else if (core.settings.music === "drift") tickDrift(core);
    else if (core.settings.music === "hearth") tickHearth(core);
    else if (core.settings.music === "rainfall") tickRainfall(core);
  }, 120);
}

export function stopMusic(): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  if (state.noiseBed) {
    state.noiseBed.stop();
    state.noiseBed = null;
  }
}

/** Fade the music bus to silence over `seconds`, then stop scheduling. Returns
 *  the fade length so callers can time any follow-up suspend/teardown. Notes
 *  already in the Web Audio queue keep ringing; the fade on the bus silences
 *  them without clicking. */
export function fadeOutMusic(seconds = 0.08): number {
  const core = getContext();
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  if (state.noiseBed) {
    state.noiseBed.stop();
    state.noiseBed = null;
  }
  if (!core) return 0;
  const { ctx, musicBus } = core;
  const now = ctx.currentTime;
  musicBus.gain.cancelScheduledValues(now);
  musicBus.gain.setValueAtTime(musicBus.gain.value, now);
  musicBus.gain.linearRampToValueAtTime(0.0001, now + seconds);
  return seconds;
}

/** Restore the music bus gain for the current track. Call before resuming
 *  music after a fade-out. */
export function restoreMusicBusGain(): void {
  const core = getContext();
  if (!core) return;
  const { ctx, musicBus, settings } = core;
  const now = ctx.currentTime;
  musicBus.gain.cancelScheduledValues(now);
  musicBus.gain.setValueAtTime(musicBusGain(settings.music), now);
}

export function musicRunning(): boolean {
  return state.timer != null;
}
