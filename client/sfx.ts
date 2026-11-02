// Tiny synthesized sound effects (Web Audio), so there are no audio files to load.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("chefio.muted") === "1";
    } catch {
      // Storage blocked: default to sound on.
    }
    // Browsers only start audio after a user gesture.
    const unlock = () => {
      this.ensure();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  toggle() {
    this.muted = !this.muted;
    try {
      localStorage.setItem("chefio.muted", this.muted ? "1" : "0");
    } catch {
      // Not remembered, but still toggled.
    }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  private ensure() {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  private tone(freq: number, dur: number, type: OscillatorType = "square", vol = 0.2, slideTo?: number, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, freq: number, vol = 0.2, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noiseBuffer || this.muted) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  pick() {
    this.tone(520, 0.08, "square", 0.12, 880);
  }
  drop() {
    this.tone(420, 0.1, "triangle", 0.18, 220);
  }
  chop() {
    this.noise(0.06, 2400, 0.35);
    this.tone(180, 0.05, "square", 0.1);
  }
  miss() {
    this.tone(160, 0.12, "sawtooth", 0.12, 90);
  }
  sizzle() {
    this.noise(0.18, 6000, 0.08);
  }
  scrub() {
    this.noise(0.05, 1200 + Math.random() * 800, 0.15);
  }
  ding() {
    this.tone(1320, 0.25, "triangle", 0.25);
    this.tone(1760, 0.35, "triangle", 0.2, undefined, 0.09);
  }
  bell() {
    this.tone(990, 0.18, "square", 0.08);
    this.tone(1480, 0.22, "square", 0.06, undefined, 0.06);
  }
  buzz() {
    this.tone(140, 0.4, "sawtooth", 0.18, 70);
  }
  combo(n: number) {
    const base = 660 * Math.pow(1.12, Math.min(n, 8));
    this.tone(base, 0.1, "square", 0.12);
    this.tone(base * 1.5, 0.14, "square", 0.1, undefined, 0.07);
  }
  rush() {
    for (let i = 0; i < 3; i++) this.tone(880, 0.12, "square", 0.14, 660, i * 0.18);
  }
  success() {
    [660, 880, 1100].forEach((f, i) => this.tone(f, 0.12, "triangle", 0.18, undefined, i * 0.07));
  }
  fail() {
    this.tone(300, 0.18, "square", 0.14, 150);
  }
  peek() {
    this.tone(700, 0.06, "sine", 0.12, 1000);
  }
}
