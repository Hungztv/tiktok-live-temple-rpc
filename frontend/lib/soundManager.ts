/**
 * Bộ tổng hợp âm thanh Web Audio API thuần (SFX + BGM + TTS Player + Audio Ducking).
 * Không phụ thuộc bất kỳ file âm thanh bên ngoài nào.
 */

export type SoundAudioState = globalThis.AudioContextState | "uninitialized";
export type AudioContextState = SoundAudioState;

const BGM_CHILL_NOTES = [261.63, 329.63, 392.0, 493.88, 392.0, 329.63, 293.66, 349.23];
const BGM_FEVER_NOTES = [329.63, 392.0, 493.88, 523.25, 659.25, 523.25, 493.88, 392.0];

class SoundManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private ttsGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private freqBuffer: Uint8Array<ArrayBuffer> | null = null;

  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private bgmEnabled = true;
  private bgmMode: "chill" | "fever" | "boss" = "chill";
  private isDucking = false;
  private muted = false;

  private activeTtsSource: AudioBufferSourceNode | null = null;
  private fallbackTimer: number | null = null;
  private stateListeners = new Set<(state: AudioContextState) => void>();

  // ---------------------------------------------------------------- Khởi tạo & Autoplay
  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (this.ctx) return this.ctx;

    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const ctx = new Ctor();
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.85;
    this.masterGain.connect(ctx.destination);

    this.bgmGain = ctx.createGain();
    this.bgmGain.gain.value = 0.22;
    this.bgmGain.connect(this.masterGain);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.55;
    this.sfxGain.connect(this.masterGain);

    this.ttsGain = ctx.createGain();
    this.ttsGain.gain.value = 1.0;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.analyser.smoothingTimeConstant = 0.65;
    this.freqBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

    this.ttsGain.connect(this.analyser);
    this.analyser.connect(this.masterGain);

    ctx.addEventListener("statechange", () => {
      this.notifyState();
    });
    this.notifyState();
    return ctx;
  }

  public getState(): AudioContextState {
    if (!this.ctx) return "uninitialized";
    return this.ctx.state;
  }

  public onStateChange(cb: (state: AudioContextState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.getState());
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  private notifyState(): void {
    const st = this.getState();
    for (const cb of this.stateListeners) {
      cb(st);
    }
  }

  public async unlock(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    this.notifyState();
    if (this.bgmEnabled && this.bgmTimer === null && ctx.state === "running") {
      this.startBgmLoop();
    }
    return ctx.state === "running";
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 0.85, this.ctx.currentTime, 0.03);
    }
  }

  public setBgmEnabled(enabled: boolean): void {
    this.bgmEnabled = enabled;
    if (!enabled) {
      this.stopBgmLoop();
    } else if (this.ctx?.state === "running") {
      this.startBgmLoop();
    }
  }

  public setBgmMode(mode: "chill" | "fever" | "boss"): void {
    this.bgmMode = mode;
  }

  // ---------------------------------------------------------------- Audio Ducking (200ms)
  public duckBgm(): void {
    this.isDucking = true;
    if (!this.ctx || !this.bgmGain) return;
    const now = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setValueAtTime(this.bgmGain.gain.value, now);
    // Hạ âm lượng BGM xuống 30% của mức gốc (0.22 * 0.3 ≈ 0.066) trong 200ms
    this.bgmGain.gain.linearRampToValueAtTime(0.066, now + 0.2);
  }

  public restoreBgm(): void {
    this.isDucking = false;
    if (!this.ctx || !this.bgmGain) return;
    const now = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(now);
    this.bgmGain.gain.setValueAtTime(this.bgmGain.gain.value, now);
    // Nâng âm lượng BGM lại 100% mức gốc trong 200ms
    this.bgmGain.gain.linearRampToValueAtTime(0.22, now + 0.2);
  }

  // ---------------------------------------------------------------- BGM Synthesizer
  private startBgmLoop(): void {
    if (this.bgmTimer !== null || typeof window === "undefined") return;
    const tick = () => {
      if (!this.bgmEnabled || !this.ctx || this.ctx.state !== "running" || !this.bgmGain) {
        return;
      }
      const notes = this.bgmMode === "chill" ? BGM_CHILL_NOTES : BGM_FEVER_NOTES;
      const baseFreq = notes[this.bgmStep % notes.length];
      this.bgmStep += 1;

      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = this.bgmMode === "boss" ? "triangle" : "sine";
      osc.frequency.setValueAtTime(
        this.bgmMode === "boss" ? baseFreq * 0.75 : baseFreq,
        this.ctx.currentTime
      );
      const t = this.ctx.currentTime;
      const dur = this.bgmMode === "chill" ? 0.55 : 0.32;
      env.gain.setValueAtTime(0.001, t);
      env.gain.linearRampToValueAtTime(0.18, t + 0.04);
      env.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(env);
      env.connect(this.bgmGain);
      osc.start(t);
      osc.stop(t + dur + 0.02);

      const nextDelay = this.bgmMode === "chill" ? 650 : 340;
      this.bgmTimer = window.setTimeout(tick, nextDelay);
    };
    this.bgmTimer = window.setTimeout(tick, 100);
  }

  private stopBgmLoop(): void {
    if (this.bgmTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  // ---------------------------------------------------------------- Phân tích biên độ TTS (nhép miệng)
  public getSpeechAmplitude(): number {
    if (!this.analyser || !this.freqBuffer || !this.activeTtsSource) return 0;
    this.analyser.getByteFrequencyData(this.freqBuffer);
    let sum = 0;
    const len = Math.min(24, this.freqBuffer.length);
    for (let i = 0; i < len; i++) {
      sum += this.freqBuffer[i];
    }
    return Math.min(1, sum / (len * 140));
  }

  // ---------------------------------------------------------------- Phát TTS base64 hoặc Fallback
  public async playTtsSpeech(
    audioBase64: string,
    durationMs: number,
    onEnded: () => void
  ): Promise<{ isFallback: boolean }> {
    this.stopCurrentTts();
    const ctx = this.ensureContext();
    const unlocked = ctx && ctx.state === "running";

    this.duckBgm();

    const finish = () => {
      this.activeTtsSource = null;
      if (this.fallbackTimer !== null && typeof window !== "undefined") {
        window.clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }
      this.restoreBgm();
      onEnded();
    };

    if (!audioBase64 || !ctx || !unlocked || !this.ttsGain) {
      // Fallback: không có audio hoặc trình duyệt chưa mở khoá âm thanh -> hẹn giờ theo duration_ms
      this.fallbackTimer = window.setTimeout(finish, Math.max(500, durationMs));
      return { isFallback: true };
    }

    try {
      const binStr = atob(audioBase64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }
      const audioBuf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(this.ttsGain);
      this.activeTtsSource = src;
      src.onended = () => {
        if (this.activeTtsSource === src) {
          finish();
        }
      };
      src.start();
      return { isFallback: false };
    } catch {
      this.fallbackTimer = window.setTimeout(finish, Math.max(500, durationMs));
      return { isFallback: true };
    }
  }

  public stopCurrentTts(): void {
    if (this.activeTtsSource) {
      try {
        this.activeTtsSource.onended = null;
        this.activeTtsSource.stop();
      } catch {
        // bỏ qua nếu đã dừng
      }
      this.activeTtsSource = null;
    }
    if (this.fallbackTimer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.isDucking) {
      this.restoreBgm();
    }
  }

  // ---------------------------------------------------------------- Tổng hợp SFX
  private tone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = "sine",
    gainPeak = 0.25,
    delay = 0
  ): void {
    if (!this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    }
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(gainPeak, t + Math.min(0.02, duration * 0.2));
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  public playCast(): void {
    this.tone(420, 180, 0.16, "sine", 0.15);
  }

  public playCatch(rare = false): void {
    if (rare) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        this.tone(f, f * 1.02, 0.22, "triangle", 0.22, i * 0.07);
      });
    } else {
      this.tone(440, 660, 0.12, "sine", 0.16);
      this.tone(660, 880, 0.14, "sine", 0.16, 0.08);
    }
  }

  public playChestDouble(): void {
    [587.33, 739.99, 880, 1174.66, 1479.98].forEach((f, i) => {
      this.tone(f, f, 0.2, "triangle", 0.25, i * 0.06);
    });
  }

  public playTroll(): void {
    this.tone(360, 290, 0.18, "sawtooth", 0.16, 0);
    this.tone(280, 170, 0.28, "sawtooth", 0.16, 0.17);
  }

  public playBomb(): void {
    this.tone(160, 42, 0.4, "sawtooth", 0.35, 0);
  }

  public playElectricNet(): void {
    for (let i = 0; i < 4; i++) {
      this.tone(900 + i * 250, 350, 0.08, "square", 0.15, i * 0.05);
    }
  }

  public playUpgrade(): void {
    [440, 554.37, 659.25, 880].forEach((f, i) => {
      this.tone(f, f, 0.18, "sine", 0.22, i * 0.065);
    });
  }

  public playTrawler(): void {
    this.tone(196, 185, 0.55, "sawtooth", 0.26, 0);
    this.tone(246.94, 235, 0.55, "triangle", 0.22, 0.05);
  }

  public playLaser(): void {
    this.tone(1350, 260, 0.14, "sawtooth", 0.14);
  }

  public playBossAlert(): void {
    for (let i = 0; i < 3; i++) {
      this.tone(240, 520, 0.25, "sawtooth", 0.25, i * 0.32);
    }
  }

  public playBossHit(): void {
    this.tone(220, 90, 0.08, "square", 0.12);
  }

  public playGoldRain(): void {
    for (let i = 0; i < 8; i++) {
      const f = 1100 + (i % 4) * 240;
      this.tone(f, f * 1.15, 0.14, "sine", 0.18, i * 0.08);
    }
  }
}

export const soundManager = new SoundManager();
