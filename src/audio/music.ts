const STORAGE_VOL_KEY = 'geogame_music_vol';
const STORAGE_MUTE_KEY = 'geogame_music_mute';

// D Dorian retro strategy melody & bassline (MIDI note numbers)
const MELODY_NOTES = [
  62, 65, 69, 72, 69, 67, 65, 64,
  62, 69, 74, 72, 69, 65, 67, 69,
  65, 69, 72, 76, 74, 72, 69, 67,
  65, 64, 62, 60, 62, 65, 64, 62,
];

const BASS_NOTES = [
  38, 38, 45, 45, 41, 41, 43, 43,
  38, 38, 50, 45, 41, 41, 43, 45,
  41, 41, 48, 48, 43, 43, 45, 45,
  41, 40, 38, 36, 38, 41, 40, 38,
];

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class RetroMusicController {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private timerId: number | null = null;
  private stepIdx = 0;
  private volume = 0.35;
  private muted = false;

  constructor() {
    try {
      const savedVol = localStorage.getItem(STORAGE_VOL_KEY);
      if (savedVol !== null) {
        const parsed = Number(savedVol);
        if (!Number.isNaN(parsed)) this.volume = Math.max(0, Math.min(1, parsed));
      }
      const savedMute = localStorage.getItem(STORAGE_MUTE_KEY);
      if (savedMute !== null) {
        this.muted = savedMute === '1';
      }
    } catch {
      // Ignore storage errors in restricted/headless contexts
    }
  }

  getVolume(): number {
    return this.volume;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.volume > 0 && this.muted) {
      this.muted = false;
    }
    this.persist();
    this.syncGain();
  }

  setMuted(mute: boolean): void {
    this.muted = mute;
    this.persist();
    this.syncGain();
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  ensureStarted(): void {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
      this.syncGain();
      this.startLoop();
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_VOL_KEY, String(this.volume));
      localStorage.setItem(STORAGE_MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // Ignore
    }
  }

  private syncGain(): void {
    if (!this.masterGain || !this.ctx) return;
    const effective = this.muted ? 0 : this.volume * 0.22;
    this.masterGain.gain.setTargetAtTime(effective, this.ctx.currentTime, 0.04);
  }

  private startLoop(): void {
    if (this.timerId !== null) return;
    const stepMs = 340;
    this.timerId = window.setInterval(() => {
      this.playStep();
    }, stepMs);
  }

  private playStep(): void {
    if (!this.ctx || !this.masterGain || this.muted || this.volume <= 0.001) return;
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    const idx = this.stepIdx % MELODY_NOTES.length;
    this.stepIdx++;

    // Lead chiptune voice (filtered triangle)
    const leadOsc = this.ctx.createOscillator();
    const leadGain = this.ctx.createGain();
    leadOsc.type = 'triangle';
    leadOsc.frequency.setValueAtTime(midiToHz(MELODY_NOTES[idx]), now);
    leadGain.gain.setValueAtTime(0.001, now);
    leadGain.gain.linearRampToValueAtTime(0.32, now + 0.03);
    leadGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    leadOsc.connect(leadGain);
    leadGain.connect(this.masterGain);
    leadOsc.start(now);
    leadOsc.stop(now + 0.31);

    // Warm pulse bass voice every 2 steps
    if (idx % 2 === 0) {
      const bassOsc = this.ctx.createOscillator();
      const bassFilter = this.ctx.createBiquadFilter();
      const bassGain = this.ctx.createGain();
      bassOsc.type = 'square';
      bassOsc.frequency.setValueAtTime(midiToHz(BASS_NOTES[idx]), now);
      bassFilter.type = 'lowpass';
      bassFilter.frequency.setValueAtTime(360, now);
      bassGain.gain.setValueAtTime(0.001, now);
      bassGain.gain.linearRampToValueAtTime(0.22, now + 0.02);
      bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
      bassOsc.connect(bassFilter);
      bassFilter.connect(bassGain);
      bassGain.connect(this.masterGain);
      bassOsc.start(now);
      bassOsc.stop(now + 0.64);
    }
  }
}
