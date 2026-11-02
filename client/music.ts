// Original generative background music: light Japanese jazz / city pop, synthesized live with Web Audio.
// FM Rhodes comping, walking bass, brushed swing drums, a sparse vibraphone melody and vinyl crackle.
// Nothing is sampled or downloaded, so there are no audio files and no licensing to worry about.

const BPM = 84;
const BEAT = 60 / BPM;
const SWING = 0.64; // share of each beat taken by the on-beat eighth

interface Chord {
  bass: number; // MIDI note
  voicing: number[]; // rootless voicing, MIDI notes
}

const CH: Record<string, Chord> = {
  Fmaj9: { bass: 41, voicing: [57, 60, 64, 67] },
  E7b9: { bass: 40, voicing: [56, 62, 65, 71] },
  Am9: { bass: 45, voicing: [60, 64, 67, 71] },
  Gm9: { bass: 43, voicing: [58, 62, 65, 69] },
  C13: { bass: 48, voicing: [58, 64, 69, 74] },
  Dm9: { bass: 38, voicing: [53, 57, 60, 64] },
  G13: { bass: 43, voicing: [53, 59, 64, 69] },
  Cmaj9: { bass: 48, voicing: [52, 55, 59, 62] },
  A7alt: { bass: 45, voicing: [55, 61, 65, 70] },
};

// Two chords per bar. A: IVmaj7 - III7 - vi7 - v7 I7 (the J-pop favourite). B: ii - V - I - VI.
const A = [["Fmaj9", "Fmaj9"], ["E7b9", "E7b9"], ["Am9", "Am9"], ["Gm9", "C13"]];
const B = [["Dm9", "Dm9"], ["G13", "G13"], ["Cmaj9", "Cmaj9"], ["A7alt", "A7alt"]];
const FORM = [...A, ...A, ...B, ...A];

const PENTATONIC = [72, 74, 76, 79, 81, 84, 86, 88]; // C major pentatonic, upper register

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private ctx: AudioContext | null = null;
  private bus!: GainNode;
  private out!: GainNode;
  private echo!: DelayNode;
  private noise!: AudioBuffer;
  private crackle: AudioBufferSourceNode | null = null;
  private timer = 0;
  private nextTime = 0;
  private step = 0; // eighth notes since start
  private melodyIndex = 3;
  intensity = 0; // 0 calm, 1 rush hour
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("chefio.music") === "0";
    } catch {
      // Storage blocked: default to music on.
    }
  }

  /** Call from a user gesture (browsers block audio until then). */
  start() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;

    // Warm, slightly lo-fi master: low-pass, gentle compression, quiet level.
    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.2;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    const warm = ctx.createBiquadFilter();
    warm.type = "lowpass";
    warm.frequency.value = 5200;
    this.bus = ctx.createGain();
    this.bus.connect(warm).connect(comp).connect(this.out).connect(ctx.destination);

    // Dotted-eighth echo for the melody.
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = BEAT * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = "lowpass";
    echoTone.frequency.value = 2400;
    this.echo.connect(echoTone).connect(feedback).connect(this.echo);
    echoTone.connect(this.bus);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.startCrackle();

    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  toggle() {
    this.muted = !this.muted;
    try {
      localStorage.setItem("chefio.music", this.muted ? "0" : "1");
    } catch {
      // Not remembered, but still toggled.
    }
    if (this.ctx) this.out.gain.setTargetAtTime(this.muted ? 0 : 0.2, this.ctx.currentTime, 0.3);
    return this.muted;
  }

  stop() {
    clearInterval(this.timer);
    this.crackle?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  private startCrackle() {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.04; // hiss
      if (Math.random() < 0.0006) d[i] = (Math.random() * 2 - 1) * 0.9; // pops
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    src.connect(hp).connect(g).connect(this.bus);
    src.start();
    this.crackle = src;
  }

  // Look-ahead scheduler: queue every eighth note that starts in the next 120 ms.
  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      const onBeat = this.step % 2 === 0;
      this.nextTime += BEAT * (onBeat ? SWING : 1 - SWING);
      this.step++;
    }
  }

  private chordAt(step: number): Chord {
    const bar = Math.floor(step / 8) % FORM.length;
    const half = step % 8 < 4 ? 0 : 1;
    return CH[FORM[bar][half]];
  }

  private playStep(step: number, t: number) {
    const s = step % 8; // eighth within the bar
    const chord = this.chordAt(step);
    const next = this.chordAt(step + 4 - (s % 4)); // chord at the next half-bar
    const busy = this.intensity;

    // Walking bass on every beat, with a chromatic approach into the next chord.
    if (s % 2 === 0) {
      const beat = s / 2;
      const notes = [chord.bass, chord.bass + 7, chord.bass + (beat === 2 ? 0 : 12), next.bass + (Math.random() < 0.5 ? 1 : -1)];
      const note = beat === 2 ? chord.bass : notes[beat];
      this.bass(note, t, BEAT * 0.85);
    }

    // Rhodes comping: downbeat, plus the classic city-pop anticipation on the "and" of 2 and 4.
    if (s === 0) this.rhodesChord(chord.voicing, t, BEAT * 1.4, 0.8);
    if (s === 3 || s === 7) this.rhodesChord(next.voicing, t, BEAT * 1.1, 0.65);
    if (busy > 0.5 && s === 5) this.rhodesChord(chord.voicing, t, BEAT * 0.4, 0.45);

    // Brushed drums.
    this.hat(t, s % 2 === 1 ? 0.55 : 0.32);
    if (busy > 0.5 && s % 2 === 1 && Math.random() < 0.5) this.hat(t + BEAT * 0.18, 0.25);
    if (s === 0 || (s === 5 && Math.random() < 0.35)) this.kick(t, s === 0 ? 0.9 : 0.5);
    if (s === 2 || s === 6) this.brush(t);

    // Sparse vibraphone melody: a gentle random walk on the pentatonic scale.
    const chance = 0.14 + busy * 0.12;
    if (Math.random() < chance) {
      this.melodyIndex = Math.max(0, Math.min(PENTATONIC.length - 1, this.melodyIndex + Math.round((Math.random() - 0.5) * 4)));
      this.vibe(PENTATONIC[this.melodyIndex], t, BEAT * (Math.random() < 0.3 ? 1.5 : 0.6));
    }
  }

  // ----- Instruments -----

  private env(gain: GainNode, t: number, peak: number, attack: number, decayTo: number, decay: number, end: number) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, decayTo), t + attack + decay);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
  }

  private rhodesChord(notes: number[], t: number, dur: number, vel: number) {
    notes.forEach((n, i) => this.rhodes(n, t + i * 0.008, dur, vel * (0.85 + Math.random() * 0.25)));
  }

  // FM electric piano: a sine carrier with a decaying modulator for the bell-like "tine".
  private rhodes(midi: number, t: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const f = mtof(midi);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const amp = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f;
    modGain.gain.setValueAtTime(f * 1.8 * vel, t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.6);
    mod.connect(modGain).connect(car.frequency);
    const end = t + dur + 0.5;
    this.env(amp, t, 0.07 * vel, 0.006, 0.03 * vel, 0.9, end);
    car.connect(amp).connect(this.bus);
    car.start(t);
    mod.start(t);
    car.stop(end);
    mod.stop(end);
  }

  private bass(midi: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = mtof(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    const amp = ctx.createGain();
    this.env(amp, t, 0.22, 0.01, 0.12, dur * 0.6, t + dur);
    osc.connect(lp).connect(amp).connect(this.bus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private vibe(midi: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.value = mtof(midi);
    const tremolo = ctx.createOscillator();
    tremolo.frequency.value = 5.5;
    const tremGain = ctx.createGain();
    tremGain.gain.value = 0.012;
    const amp = ctx.createGain();
    this.env(amp, t, 0.045, 0.01, 0.02, dur, t + dur + 0.6);
    tremolo.connect(tremGain).connect(amp.gain);
    osc.connect(amp);
    amp.connect(this.bus);
    amp.connect(this.echo);
    const end = t + dur + 0.7;
    osc.start(t);
    tremolo.start(t);
    osc.stop(end);
    tremolo.stop(end);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, length: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const amp = ctx.createGain();
    this.env(amp, t, peak, 0.004, peak * 0.3, length * 0.5, t + length);
    src.connect(filter).connect(amp).connect(this.bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + length + 0.02);
  }

  private hat(t: number, vel: number) {
    this.noiseHit(t, "highpass", 7500, 0.05 * vel, 0.07);
  }

  private brush(t: number) {
    this.noiseHit(t, "bandpass", 2200, 0.06, 0.22);
  }

  private kick(t: number, vel: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const amp = ctx.createGain();
    this.env(amp, t, 0.28 * vel, 0.004, 0.05, 0.12, t + 0.3);
    osc.connect(amp).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.32);
  }
}
